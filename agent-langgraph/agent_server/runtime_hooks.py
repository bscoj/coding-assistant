from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any

from langchain_core.tools import BaseTool, StructuredTool

from agent_server.filesystem_tools import PROJECT_ROOT

logger = logging.getLogger(__name__)

HOOK_CONFIG_PATHS = (
    ".coding-buddy/hooks.json",
    ".coding-buddy/hooks.local.json",
)
DEFAULT_EVENT_LOG_PATH = PROJECT_ROOT / ".local" / "runtime_hook_events.jsonl"
MAX_BLOCK_CHARS = 6_000
MAX_EVENT_VALUE_CHARS = 1_600


def runtime_hooks_enabled() -> bool:
    return os.getenv("RUNTIME_HOOKS_ENABLED", "true").lower() not in {"0", "false", "no"}


def runtime_hook_event_log_path() -> Path:
    configured = os.getenv("RUNTIME_HOOK_EVENT_LOG_PATH")
    path = Path(configured) if configured else DEFAULT_EVENT_LOG_PATH
    if not path.is_absolute():
        path = (PROJECT_ROOT / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _compact_value(value: Any) -> Any:
    if isinstance(value, str):
        compact = " ".join(value.split()).strip()
        if len(compact) <= MAX_EVENT_VALUE_CHARS:
            return compact
        return compact[:MAX_EVENT_VALUE_CHARS] + " ... [truncated]"
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, list):
        return [_compact_value(item) for item in value[:12]]
    if isinstance(value, tuple):
        return [_compact_value(item) for item in value[:12]]
    if isinstance(value, dict):
        compact: dict[str, Any] = {}
        for index, (key, child) in enumerate(value.items()):
            if index >= 20:
                compact["__truncated__"] = True
                break
            compact[str(key)] = _compact_value(child)
        return compact
    return _compact_value(str(value))


def _load_hook_config(workspace_root: str | Path | None) -> dict[str, list[dict[str, Any]]]:
    if not workspace_root:
        return {}
    root = Path(workspace_root).resolve()
    merged: dict[str, list[dict[str, Any]]] = {}
    for relative_path in HOOK_CONFIG_PATHS:
        candidate = root / relative_path
        if not candidate.exists():
            continue
        try:
            payload = json.loads(candidate.read_text(encoding="utf-8"))
        except Exception:
            logger.exception("Failed to load runtime hook config from %s", candidate)
            continue
        hooks = payload.get("hooks")
        if not isinstance(hooks, dict):
            continue
        for event_name, entries in hooks.items():
            if not isinstance(entries, list):
                continue
            merged.setdefault(str(event_name), []).extend(
                entry for entry in entries if isinstance(entry, dict)
            )
    return merged


def _resolve_instruction_path(workspace_root: Path, relative_path: str) -> Path | None:
    stripped = relative_path.strip()
    if not stripped:
        return None
    candidate = Path(stripped)
    if not candidate.is_absolute():
        candidate = (workspace_root / candidate).resolve()
    else:
        candidate = candidate.resolve()
    normalized_root = workspace_root.resolve()
    if candidate != normalized_root and normalized_root not in candidate.parents:
        return None
    return candidate


def build_runtime_hook_blocks(
    workspace_root: str | Path | None,
    event_name: str,
) -> list[str]:
    if not runtime_hooks_enabled() or not workspace_root:
        return []
    root = Path(workspace_root).resolve()
    blocks: list[str] = []
    for entry in _load_hook_config(root).get(event_name, []):
        entry_type = str(entry.get("type") or "").strip().lower()
        if entry_type in {"instruction_text", "text"}:
            content = str(entry.get("content") or "").strip()
            if content:
                blocks.append(f"Runtime hook instructions ({event_name})\n\n{content[:MAX_BLOCK_CHARS]}")
        elif entry_type in {"instruction_file", "file"}:
            relative_path = str(entry.get("path") or "").strip()
            resolved = _resolve_instruction_path(root, relative_path)
            if resolved is None or not resolved.exists():
                continue
            try:
                content = resolved.read_text(encoding="utf-8").strip()
            except Exception:
                logger.exception("Failed to read runtime hook instruction file %s", resolved)
                continue
            if content:
                blocks.append(
                    f"Runtime hook instructions ({event_name}) from {resolved.relative_to(root)}\n\n"
                    f"{content[:MAX_BLOCK_CHARS]}"
                )
    return blocks


def emit_runtime_hook_event(
    workspace_root: str | Path | None,
    event_name: str,
    payload: dict[str, Any] | None = None,
) -> None:
    if not runtime_hooks_enabled():
        return
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event_name,
        "workspace_root": str(Path(workspace_root).resolve()) if workspace_root else None,
        "payload": _compact_value(payload or {}),
    }
    try:
        with runtime_hook_event_log_path().open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=True) + "\n")
    except Exception:
        logger.exception("Failed to append runtime hook event.")


def wrap_tools_with_runtime_hooks(
    tools: list[BaseTool],
    workspace_root: str | Path | None,
) -> list[BaseTool]:
    if not runtime_hooks_enabled():
        return tools
    normalized_root = str(Path(workspace_root).resolve()) if workspace_root else None
    wrapped: list[BaseTool] = []

    for base_tool in tools:
        if not isinstance(base_tool, StructuredTool):
            wrapped.append(base_tool)
            continue

        def _build_sync(tool: StructuredTool):
            def _wrapped(**kwargs: Any) -> Any:
                started = perf_counter()
                emit_runtime_hook_event(
                    normalized_root,
                    "PreToolUse",
                    {"tool_name": tool.name, "arguments": kwargs},
                )
                try:
                    result = tool.func(**kwargs) if tool.func else None
                except Exception as exc:
                    emit_runtime_hook_event(
                        normalized_root,
                        "PostToolUseFailure",
                        {
                            "tool_name": tool.name,
                            "arguments": kwargs,
                            "error": str(exc),
                            "duration_ms": round((perf_counter() - started) * 1000, 1),
                        },
                    )
                    raise
                emit_runtime_hook_event(
                    normalized_root,
                    "PostToolUse",
                    {
                        "tool_name": tool.name,
                        "arguments": kwargs,
                        "result": result,
                        "duration_ms": round((perf_counter() - started) * 1000, 1),
                    },
                )
                return result

            return _wrapped

        def _build_async(tool: StructuredTool):
            async def _wrapped(**kwargs: Any) -> Any:
                started = perf_counter()
                emit_runtime_hook_event(
                    normalized_root,
                    "PreToolUse",
                    {"tool_name": tool.name, "arguments": kwargs},
                )
                try:
                    result = await tool.coroutine(**kwargs) if tool.coroutine else None
                except Exception as exc:
                    emit_runtime_hook_event(
                        normalized_root,
                        "PostToolUseFailure",
                        {
                            "tool_name": tool.name,
                            "arguments": kwargs,
                            "error": str(exc),
                            "duration_ms": round((perf_counter() - started) * 1000, 1),
                        },
                    )
                    raise
                emit_runtime_hook_event(
                    normalized_root,
                    "PostToolUse",
                    {
                        "tool_name": tool.name,
                        "arguments": kwargs,
                        "result": result,
                        "duration_ms": round((perf_counter() - started) * 1000, 1),
                    },
                )
                return result

            return _wrapped

        wrapped.append(
            StructuredTool.from_function(
                func=_build_sync(base_tool) if base_tool.func else None,
                coroutine=_build_async(base_tool) if base_tool.coroutine else None,
                name=base_tool.name,
                description=base_tool.description,
                return_direct=base_tool.return_direct,
                args_schema=base_tool.args_schema,
                infer_schema=False,
                response_format=getattr(base_tool, "response_format", "content"),
            )
        )

    return wrapped
