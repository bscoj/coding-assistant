from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import unified_diff
from pathlib import Path
from typing import Any, Literal

from langchain_core.tools import tool
from mlflow.genai.agent_server import get_request_headers


PROJECT_ROOT = Path(__file__).resolve().parent.parent
APPROVAL_PREFIX = "APPROVE_WRITE:"
APPROVAL_SERVER_LABEL = "local-filesystem"
STAGED_WRITE_MARKER = "__staged_write_request__"
_FILE_READ_CACHE: dict[str, Any] = {}
_TOOL_ACTIVITY_CACHE: dict[str, Any] = {}
_TASK_STATE_CACHE: dict[str, Any] = {}
_WORKSPACE_INDEX_CACHE: dict[str, dict[str, Any]] = {}
_RUN_SCRIPT_PATTERN = re.compile(
    r"""(?ix)
    (?:
        \b(?:bash|sh|python|python3|node|pwsh|powershell)\s+
        |
        (?<![\w./-])
    )
    (
        \.?\.?/[\w./-]+(?:\.(?:sh|py|ps1|js|ts|mjs|cjs))?
        |
        [\w./-]+/(?:[\w./-]+)(?:\.(?:sh|py|ps1|js|ts|mjs|cjs))?
    )
    """
)


def _safe_state_path(env_name: str, default_name: str) -> Path:
    configured = os.getenv(env_name)
    candidate = Path(configured) if configured else (PROJECT_ROOT / ".local" / default_name)
    if not candidate.is_absolute():
        candidate = (PROJECT_ROOT / candidate).resolve()
    candidate.parent.mkdir(parents=True, exist_ok=True)
    return candidate


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def workspace_root() -> Path:
    header_root = get_request_headers().get("x-codex-workspace-root")
    root = Path(header_root or os.getenv("FILES_WORKSPACE_ROOT", str(PROJECT_ROOT)))
    if not root.is_absolute():
        root = (PROJECT_ROOT / root).resolve()
    return root.resolve()


def staged_write_store_path() -> Path:
    return _safe_state_path("FILES_STAGED_WRITES_PATH", "staged_writes.json")


def file_read_cache_path() -> Path:
    return _safe_state_path("FILES_READ_CACHE_PATH", "file_read_cache.json")


def tool_activity_cache_path() -> Path:
    return _safe_state_path("FILES_TOOL_ACTIVITY_PATH", "tool_activity.json")


def task_state_path() -> Path:
    return _safe_state_path("FILES_TASK_STATE_PATH", "task_state.json")


def max_read_bytes() -> int:
    return int(os.getenv("FILES_MAX_READ_BYTES", "40000"))


def max_read_lines() -> int:
    return int(os.getenv("FILES_MAX_READ_LINES", "160"))


def max_search_results() -> int:
    return int(os.getenv("FILES_MAX_SEARCH_RESULTS", "25"))


def max_tool_output_chars() -> int:
    return int(os.getenv("FILES_MAX_TOOL_OUTPUT_CHARS", "12000"))


def max_search_line_chars() -> int:
    return int(os.getenv("FILES_MAX_SEARCH_LINE_CHARS", "320"))


def max_indexed_files() -> int:
    return int(os.getenv("FILES_MAX_INDEXED_FILES", "25000"))


def writes_enabled() -> bool:
    return os.getenv("FILES_WRITE_ENABLED", "true").lower() not in {"0", "false", "no"}


def _normalize_glob(glob: str | None) -> str | None:
    if glob is None:
        return None
    value = glob.strip()
    return value or None


def _user_requested_repo_wide_search() -> bool:
    summary = (_latest_user_request_summary() or "").lower()
    phrases = (
        "whole repo",
        "entire repo",
        "entire repository",
        "whole repository",
        "across the repo",
        "across the repository",
        "search everything",
        "search the repo",
        "search the repository",
        "all files",
    )
    return any(phrase in summary for phrase in phrases)


def _is_overly_broad_glob(glob: str | None) -> bool:
    normalized = _normalize_glob(glob)
    if normalized is None:
        return False
    broad_literals = {"*", "*.*", "**", "**/*", "**/*.*", "./**/*", "./**/*.*"}
    if normalized in broad_literals:
        return True
    if "**" not in normalized:
        return False
    # Treat recursive globs without a meaningful path prefix or extension filter as too broad.
    has_path_prefix = "/" in normalized.replace("./", "", 1)
    has_extension_filter = "." in normalized.split("/")[-1].replace("*", "")
    return not has_path_prefix and not has_extension_filter


def _search_scope_error(glob: str | None) -> str:
    requested = glob or "(none)"
    return (
        f"Refusing broad search scope for glob {requested!r}. "
        "Narrow the search first: use workspace_overview() to inspect the repo, "
        "find_files_by_name() to locate likely files, or search_files() with a scoped path/glob "
        "such as 'src/**/*.ts', 'agent_server/**/*.py', or a specific subdirectory. "
        "Repo-wide wildcard searches should only be used when the user explicitly requests them."
    )


def _resolve_path(path: str) -> Path:
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = workspace_root() / candidate
    resolved = candidate.resolve()
    root = workspace_root()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"Path {resolved} is outside workspace root {root}")
    return resolved


def _resolve_path_with_root(path: str, root: Path) -> Path:
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()
    normalized_root = root.resolve()
    if resolved != normalized_root and normalized_root not in resolved.parents:
        raise ValueError(f"Path {resolved} is outside workspace root {normalized_root}")
    return resolved


def _read_text(path: Path) -> str:
    size = path.stat().st_size
    if size > max_read_bytes():
        raise ValueError(
            f"File is too large to read directly ({size} bytes). Limit is {max_read_bytes()} bytes."
        )
    return path.read_text(encoding="utf-8")


def _truncate_line(line: str, limit: int | None = None) -> str:
    max_chars = limit or max_search_line_chars()
    if len(line) <= max_chars:
        return line
    return line[:max_chars] + " ... [truncated]"


def _truncate_output(text: str, limit: int | None = None) -> str:
    max_chars = limit or max_tool_output_chars()
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n... [tool output truncated; narrow the search or read a smaller range]"


def _load_staged_writes() -> dict[str, dict]:
    path = staged_write_store_path()
    try:
        exists = path.exists()
    except OSError:
        return {}
    if not exists:
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_staged_writes(data: dict[str, dict]) -> None:
    try:
        staged_write_store_path().write_text(
            json.dumps(data, indent=2, ensure_ascii=True, sort_keys=True), encoding="utf-8"
        )
    except OSError:
        # If the preferred local state directory is unavailable, fail open for state persistence
        # instead of breaking the user flow.
        return


def _load_file_read_cache() -> dict[str, Any]:
    return dict(_FILE_READ_CACHE)


def _save_file_read_cache(data: dict[str, Any]) -> None:
    _FILE_READ_CACHE.clear()
    _FILE_READ_CACHE.update(data)


def _load_tool_activity_cache() -> dict[str, Any]:
    return dict(_TOOL_ACTIVITY_CACHE)


def _save_tool_activity_cache(data: dict[str, Any]) -> None:
    _TOOL_ACTIVITY_CACHE.clear()
    _TOOL_ACTIVITY_CACHE.update(data)


def _load_task_state_cache() -> dict[str, Any]:
    return dict(_TASK_STATE_CACHE)


def _save_task_state_cache(data: dict[str, Any]) -> None:
    _TASK_STATE_CACHE.clear()
    _TASK_STATE_CACHE.update(data)


def _conversation_scope_id() -> str:
    headers = get_request_headers()
    return (
        headers.get("x-databricks-conversation-id")
        or headers.get("x-codex-conversation-id")
        or "default"
    )


def _read_cache_key(path: Path, start_line: int, end_line: int) -> str:
    scope = _conversation_scope_id()
    root = str(workspace_root())
    digest = hashlib.sha256(
        f"{scope}:{root}:{path}:{start_line}:{end_line}".encode("utf-8")
    ).hexdigest()[:24]
    return digest


def _tool_activity_scope_key() -> str:
    scope = _conversation_scope_id()
    root = str(workspace_root())
    return hashlib.sha256(f"{scope}:{root}".encode("utf-8")).hexdigest()[:24]


def _task_scope_key() -> str:
    scope = _conversation_scope_id()
    root = str(workspace_root())
    return hashlib.sha256(f"task:{scope}:{root}".encode("utf-8")).hexdigest()[:24]


def _lookup_cached_read(path: Path, start_line: int, end_line: int) -> dict[str, Any] | None:
    cache = _load_file_read_cache()
    key = _read_cache_key(path, start_line, end_line)
    record = cache.get(key)
    if not isinstance(record, dict):
        return None
    try:
        stat = path.stat()
    except FileNotFoundError:
        return None
    if (
        record.get("mtime_ns") != stat.st_mtime_ns
        or record.get("size") != stat.st_size
        or record.get("scope") != _conversation_scope_id()
        or record.get("workspace_root") != str(workspace_root())
    ):
        return None
    return record


def _remember_file_read(
    path: Path,
    start_line: int,
    end_line: int,
    line_count: int,
    content: str,
) -> None:
    cache = _load_file_read_cache()
    key = _read_cache_key(path, start_line, end_line)
    stat = path.stat()
    cache[key] = {
        "scope": _conversation_scope_id(),
        "workspace_root": str(workspace_root()),
        "path": str(path.relative_to(workspace_root())),
        "start_line": start_line,
        "end_line": end_line,
        "line_count": line_count,
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest()[:16],
        "last_read_at": utc_now(),
    }
    if len(cache) > 500:
        items = sorted(
            (
                (cache_key, value)
                for cache_key, value in cache.items()
                if isinstance(value, dict)
            ),
            key=lambda item: item[1].get("last_read_at", ""),
        )
        cache = {cache_key: cache[cache_key] for cache_key, _ in items[-400:]}
    _save_file_read_cache(cache)


def _cached_read_message(record: dict[str, Any]) -> str:
    return (
        f"Already read {record['path']} lines {record['start_line']}-{record['end_line']} "
        f"in this conversation. Reuse that context instead of rereading unless you need "
        "different lines or suspect the file changed. "
        f"Cached snippet: {record['line_count']} lines, content hash {record['content_sha256']}."
    )


def _recent_reads(limit: int = 12) -> list[dict[str, Any]]:
    scope = _conversation_scope_id()
    current_root = str(workspace_root())
    cache = _load_file_read_cache()
    records = [
        value
        for value in cache.values()
        if isinstance(value, dict)
        and value.get("scope") == scope
        and value.get("workspace_root") == current_root
    ]
    records.sort(key=lambda item: item.get("last_read_at", ""), reverse=True)
    return records[:limit]


def _record_tool_activity(kind: Literal["search", "code_search"], payload: dict[str, Any]) -> None:
    cache = _load_tool_activity_cache()
    scope_key = _tool_activity_scope_key()
    bucket = cache.get(scope_key)
    if not isinstance(bucket, dict):
        bucket = {"searches": []}
    searches = bucket.get("searches")
    if not isinstance(searches, list):
        searches = []
    entry = {
        "kind": kind,
        "recorded_at": utc_now(),
        **payload,
    }
    searches.append(entry)
    bucket["searches"] = searches[-40:]
    bucket["scope"] = _conversation_scope_id()
    bucket["workspace_root"] = str(workspace_root())
    cache[scope_key] = bucket
    if len(cache) > 200:
        items = sorted(
            (
                (cache_key, value)
                for cache_key, value in cache.items()
                if isinstance(value, dict)
            ),
            key=lambda item: max(
                [search.get("recorded_at", "") for search in item[1].get("searches", [])]
                or [""]
            ),
        )
        cache = {cache_key: cache[cache_key] for cache_key, _ in items[-150:]}
    _save_tool_activity_cache(cache)


def _recent_searches(limit: int = 8) -> list[dict[str, Any]]:
    cache = _load_tool_activity_cache()
    bucket = cache.get(_tool_activity_scope_key())
    if not isinstance(bucket, dict):
        return []
    searches = bucket.get("searches")
    if not isinstance(searches, list):
        return []
    items = [item for item in searches if isinstance(item, dict)]
    items.sort(key=lambda item: item.get("recorded_at", ""), reverse=True)
    return items[:limit]


def _latest_user_text(request_messages: list[dict] | None) -> str | None:
    texts = [text.strip() for text in _approval_texts(request_messages) if text.strip()]
    if not texts:
        return None
    return texts[-1]


def _is_continuation_request(text: str) -> bool:
    normalized = text.strip().lower()
    continuation_literals = {
        "continue",
        "keep going",
        "go on",
        "keep exploring",
        "look again",
        "try again",
        "continue exploring",
        "keep looking",
    }
    if normalized in continuation_literals:
        return True
    return any(
        phrase in normalized
        for phrase in (
            "keep going",
            "continue exploring",
            "look deeper",
            "keep looking",
            "dig deeper",
        )
    )


def _is_exploration_request(text: str) -> bool:
    normalized = text.strip().lower()
    phrases = (
        "explore repo",
        "explore the repo",
        "explore this repo",
        "understand repo",
        "understand the repo",
        "look through the repo",
        "inspect the repo",
        "inspect repo",
        "understand this project",
        "understand the project",
        "understand the codebase",
        "walk through the repo",
        "walk me through the repo",
        "figure out how",
        "how this works",
        "how it works",
        "get familiar with",
    )
    return any(phrase in normalized for phrase in phrases)


def _trim_task_objective(text: str) -> str:
    compact = " ".join(text.replace("\n", " ").split()).strip()
    return compact[:280]


def record_task_request(request_messages: list[dict] | None) -> None:
    latest_user_text = _latest_user_text(request_messages)
    if not latest_user_text:
        return

    cache = _load_task_state_cache()
    scope_key = _task_scope_key()
    current = cache.get(scope_key)
    if not isinstance(current, dict):
        current = {}

    is_continuation = _is_continuation_request(latest_user_text)
    previous_objective = str(current.get("objective", "")).strip()
    objective = previous_objective if is_continuation and previous_objective else _trim_task_objective(latest_user_text)

    previous_mode = str(current.get("mode", "task"))
    mode = "exploration" if (_is_exploration_request(latest_user_text) or (is_continuation and previous_mode == "exploration")) else "task"

    cache[scope_key] = {
        "objective": objective,
        "mode": mode,
        "workspace_root": str(workspace_root()),
        "last_user_turn": _trim_task_objective(latest_user_text),
        "updated_at": utc_now(),
    }
    if len(cache) > 200:
        items = sorted(
            (
                (cache_key, value)
                for cache_key, value in cache.items()
                if isinstance(value, dict)
            ),
            key=lambda item: item[1].get("updated_at", ""),
        )
        cache = {cache_key: cache[cache_key] for cache_key, _ in items[-150:]}
    _save_task_state_cache(cache)


def _current_task_state() -> dict[str, Any] | None:
    cache = _load_task_state_cache()
    state = cache.get(_task_scope_key())
    return state if isinstance(state, dict) else None


def build_task_scratchpad_block() -> str | None:
    state = _current_task_state()
    if not state:
        return None

    objective = str(state.get("objective", "")).strip()
    mode = str(state.get("mode", "task")).strip() or "task"
    if not objective:
        return None

    recent_reads = _recent_reads(limit=6)
    recent_search_items = _recent_searches(limit=4)
    unique_paths: list[str] = []
    for item in recent_reads:
        path = item.get("path")
        if isinstance(path, str) and path not in unique_paths:
            unique_paths.append(path)

    sections = [
        f"Objective: {objective}",
        f"Mode: {mode}",
    ]
    if unique_paths:
        sections.append("Files already inspected:\n" + "\n".join(f"- {path}" for path in unique_paths[:6]))
    if recent_search_items:
        search_lines = []
        for item in recent_search_items[:4]:
            query = str(item.get("query", "")).strip()
            if not query:
                continue
            details = query
            if item.get("path"):
                details += f" in {item['path']}"
            search_lines.append(f"- {details}")
        if search_lines:
            sections.append("Recent search focus:\n" + "\n".join(search_lines))

    if mode == "exploration":
        if len(unique_paths) < 3:
            next_step = (
                "Keep exploring before answering. Read a few more high-signal files such as README/docs, "
                "config, and likely entrypoints so you can give one coherent summary instead of stopping early."
            )
        else:
            next_step = (
                "Keep chaining investigation until you can explain the repo clearly. Synthesize what you found, "
                "note any real gaps, and only stop once you have a coherent answer or a concrete blocker."
            )
    else:
        next_step = (
            "Use the inspected files first. Read more only if a concrete gap remains, then answer decisively."
        )
    sections.append(f"Next step: {next_step}")
    return "Active task scratchpad\n\n" + "\n\n".join(sections)


def build_tool_memory_block() -> str | None:
    recent_reads = _recent_reads(limit=6)
    recent_search_items = _recent_searches(limit=6)
    if not recent_reads and not recent_search_items:
        return (
            "Tool workflow guidance\n\n"
            "Minimize redundant tool use. Before rereading files, prefer recent_file_reads(). "
            "Start with workspace_overview(), then find_files_by_name(), then targeted search_files() "
            "or search_code_blocks(). Avoid rereading the same file range unless you need different lines "
            "or suspect the file changed."
        )

    sections = [
        "Tool workflow guidance:\n"
        "- Minimize redundant tool use.\n"
        "- Prefer recent_file_reads() before rereading files.\n"
        "- Prefer workspace_overview(), then find_files_by_name(), then targeted search_files() or search_code_blocks().\n"
        "- Do not reread the same file range unless you need different lines or suspect the file changed."
    ]
    if recent_reads:
        lines = [
            f"- {item['path']} lines {item['start_line']}-{item['end_line']} (hash {item['content_sha256']})"
            for item in recent_reads
        ]
        sections.append("Recent file reads:\n" + "\n".join(lines))
    if recent_search_items:
        lines = []
        for item in recent_search_items:
            details = item.get("query", "")
            if item.get("path"):
                details += f" in {item['path']}"
            if item.get("glob"):
                details += f" glob={item['glob']}"
            if item.get("match_count") is not None:
                details += f" matches={item['match_count']}"
            lines.append(f"- {item.get('kind', 'search')}: {details.strip()}")
        sections.append("Recent searches:\n" + "\n".join(lines))
    return "Tool memory\n\n" + "\n\n".join(sections)


def _scan_workspace(root: Path) -> dict:
    files: list[dict] = []
    extensions: dict[str, int] = {}
    top_dirs: dict[str, int] = {}
    important_files: list[str] = []
    indexed_limit = max_indexed_files()
    skipped_dirs = {
        ".git",
        ".venv",
        "node_modules",
        "dist",
        "build",
        ".next",
        "coverage",
        ".mypy_cache",
        ".pytest_cache",
        "__pycache__",
        "target",
        ".turbo",
    }
    important_names = {
        "package.json",
        "pyproject.toml",
        "requirements.txt",
        "Cargo.toml",
        "go.mod",
        "README.md",
        "Makefile",
        "vite.config.ts",
        "tsconfig.json",
        "databricks.yml",
    }
    truncated = False
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if dirname not in skipped_dirs and not dirname.startswith(".git")
        ]
        current_dir = Path(dirpath)
        for filename in filenames:
            path = current_dir / filename
            rel = path.relative_to(root)
            ext = path.suffix.lower() or "[no_ext]"
            extensions[ext] = extensions.get(ext, 0) + 1
            top = rel.parts[0] if rel.parts else "."
            top_dirs[top] = top_dirs.get(top, 0) + 1
            if path.name in important_names:
                important_files.append(str(rel))
            files.append(
                {
                    "path": str(rel),
                    "name": path.name,
                    "extension": ext,
                    "size": path.stat().st_size,
                }
            )
            if len(files) >= indexed_limit:
                truncated = True
                break
        if truncated:
            break
    return {
        "generated_at": utc_now(),
        "root": str(root),
        "file_count": len(files),
        "truncated": truncated,
        "extensions": dict(sorted(extensions.items(), key=lambda item: (-item[1], item[0]))[:20]),
        "top_level_dirs": dict(sorted(top_dirs.items(), key=lambda item: (-item[1], item[0]))[:20]),
        "important_files": sorted(important_files)[:50],
        "files": files,
    }


def build_workspace_index(force_refresh: bool = False) -> dict:
    current_root = str(workspace_root())
    cached = _WORKSPACE_INDEX_CACHE.get(current_root)
    if isinstance(cached, dict) and not force_refresh:
        return cached
    index = _scan_workspace(Path(current_root))
    _WORKSPACE_INDEX_CACHE[current_root] = index
    return index


def _top_matches(paths: list[str], keywords: tuple[str, ...], limit: int = 8) -> list[str]:
    lowered_keywords = tuple(keyword.lower() for keyword in keywords)
    ranked: list[tuple[int, str]] = []
    for path in paths:
        lowered = path.lower()
        score = sum(1 for keyword in lowered_keywords if keyword in lowered)
        if score:
            ranked.append((score, path))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    output: list[str] = []
    seen: set[str] = set()
    for _, path in ranked:
        if path in seen:
            continue
        seen.add(path)
        output.append(path)
        if len(output) >= limit:
            break
    return output


def _read_small_text(path: Path, max_bytes: int = 40000) -> str:
    try:
        if not path.is_file() or path.stat().st_size > max_bytes:
            return ""
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _extract_yaml_section_keys(text: str, section_name: str) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    in_section = False
    section_indent = 0
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if not in_section:
            if stripped == f"{section_name}:":
                in_section = True
                section_indent = indent
            continue
        if indent <= section_indent:
            break
        if indent == section_indent + 2 and stripped.endswith(":"):
            key = stripped[:-1].strip().strip("'\"")
            if key and key not in seen:
                seen.add(key)
                keys.append(key)
    return keys[:12]


def _extract_workflow_name(text: str, fallback: str) -> str:
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("name:"):
            value = line.split(":", 1)[1].strip().strip("'\"")
            return value or fallback
        break
    return fallback


def _extract_uses_values(text: str) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or not line.startswith("uses:"):
            continue
        value = line.split(":", 1)[1].strip().strip("'\"")
        if value and value not in seen:
            seen.add(value)
            values.append(value)
    return values[:20]


def _extract_run_commands(text: str) -> list[str]:
    commands: list[str] = []
    seen: set[str] = set()
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or not line.startswith("run:"):
            continue
        command = " ".join(line.split(":", 1)[1].strip().split())
        if not command:
            continue
        compact = _truncate_line(command, 140)
        if compact not in seen:
            seen.add(compact)
            commands.append(compact)
    return commands[:12]


def _extract_script_paths_from_commands(commands: list[str]) -> list[str]:
    scripts: list[str] = []
    seen: set[str] = set()
    for command in commands:
        for match in _RUN_SCRIPT_PATTERN.finditer(command):
            candidate = match.group(1).strip().strip("'\"")
            normalized = candidate[2:] if candidate.startswith("./") else candidate
            normalized = normalized.lstrip("/")
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            scripts.append(normalized)
    return scripts[:20]


def _classify_ci_systems(paths: list[str]) -> list[str]:
    systems: list[str] = []
    lowered = [path.lower() for path in paths]

    def add(name: str, predicate: bool) -> None:
        if predicate and name not in systems:
            systems.append(name)

    add("github_actions", any(path.startswith(".github/workflows/") for path in lowered))
    add("gitlab_ci", any(path == ".gitlab-ci.yml" or path.startswith(".gitlab/") for path in lowered))
    add("circleci", any(path.startswith(".circleci/") for path in lowered))
    add("jenkins", any(path.endswith("jenkinsfile") for path in lowered))
    add("azure_pipelines", any("azure-pipelines" in path for path in lowered))
    add("buildkite", any(path.startswith(".buildkite/") for path in lowered))
    add("bitbucket_pipelines", any(path == "bitbucket-pipelines.yml" for path in lowered))
    return systems


def _ordered_unique(items: list[str], limit: int = 20) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        output.append(item)
        if len(output) >= limit:
            break
    return output


def _workflow_summary(root: Path, rel_path: str) -> dict[str, Any]:
    text = _read_small_text(root / rel_path)
    uses_values = _extract_uses_values(text)
    local_workflows = [value[2:] for value in uses_values if value.startswith("./.github/workflows/")]
    local_actions = [
        value[2:]
        for value in uses_values
        if value.startswith("./") and not value.startswith("./.github/workflows/")
    ]
    external_actions = [value for value in uses_values if not value.startswith("./")]
    run_commands = _extract_run_commands(text)
    scripts = _extract_script_paths_from_commands(run_commands)
    triggers = _extract_yaml_section_keys(text, "on")
    jobs = _extract_yaml_section_keys(text, "jobs")
    return {
        "path": rel_path,
        "name": _extract_workflow_name(text, Path(rel_path).stem),
        "triggers": triggers[:8],
        "jobs": jobs[:10],
        "local_reusable_workflows": local_workflows[:6],
        "local_actions": local_actions[:6],
        "referenced_scripts": scripts[:8],
        "notable_run_commands": run_commands[:5],
        "external_actions": external_actions[:6],
    }


def _existing_repo_paths(root: Path, relative_paths: list[str]) -> tuple[list[str], list[str]]:
    existing: list[str] = []
    missing: list[str] = []
    for rel_path in _ordered_unique(relative_paths, limit=40):
        try:
            target = _resolve_path_with_root(rel_path, root)
        except ValueError:
            missing.append(rel_path)
            continue
        if target.exists():
            existing.append(rel_path)
        else:
            missing.append(rel_path)
    return existing, missing


def _ci_risks(
    workflow_summaries: list[dict[str, Any]],
    missing_local_references: list[str],
    manifest_files: list[str],
) -> list[str]:
    risks: list[str] = []
    if missing_local_references:
        risks.append(
            "Some workflow-local references do not exist in the repo: "
            + ", ".join(missing_local_references[:6])
        )
    if workflow_summaries and not manifest_files:
        risks.append(
            "CI workflows are present, but obvious build/test manifests were not detected from filenames."
        )
    if len(workflow_summaries) >= 5:
        risks.append(
            "There are several workflow files. Start from the failing workflow and follow only its referenced scripts or reusable workflows."
        )
    if any(summary["local_reusable_workflows"] for summary in workflow_summaries):
        risks.append(
            "Reusable workflows are in play, so failures may be defined one layer away from the top-level workflow file."
        )
    if any(summary["local_actions"] for summary in workflow_summaries):
        risks.append(
            "Local GitHub Actions are referenced. Check their action.yml and implementation files before assuming the issue is in workflow YAML."
        )
    return risks[:5]


def _keyword_file_hits(root: Path, pattern: str, limit: int = 12) -> list[str]:
    rg = shutil.which("rg")
    if not rg:
        return []
    result = subprocess.run(
        [
            rg,
            "-l",
            "-i",
            "-m",
            "1",
            "--glob",
            "!.git",
            "--glob",
            "!node_modules",
            "--glob",
            "!dist",
            "--glob",
            "!build",
            "--glob",
            "!.next",
            pattern,
            str(root),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode not in {0, 1}:
        return []
    output: list[str] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rel = str(Path(line).resolve().relative_to(root))
        except Exception:
            continue
        output.append(rel)
        if len(output) >= limit:
            break
    return output


def _stack_signals(root: Path, paths: list[str]) -> dict[str, list[str]]:
    signals: dict[str, list[str]] = {}

    def add_signal(name: str, hits: list[str]) -> None:
        if hits:
            signals[name] = hits[:6]

    add_signal("mlflow", _keyword_file_hits(root, r"\bmlflow\b"))
    add_signal("databricks", _keyword_file_hits(root, r"\bdatabricks\b|\bdbutils\b"))
    add_signal("pyspark", _keyword_file_hits(root, r"\bpyspark\b|\bspark\."))
    add_signal("scikit-learn", _keyword_file_hits(root, r"\bsklearn\b"))
    add_signal("xgboost", _keyword_file_hits(root, r"\bxgboost\b"))
    add_signal("lightgbm", _keyword_file_hits(root, r"\blightgbm\b"))
    add_signal("pytorch", _keyword_file_hits(root, r"\btorch\b|\bpytorch\b|\blightning\b"))
    add_signal("tensorflow", _keyword_file_hits(root, r"\btensorflow\b|\bkeras\b"))
    add_signal("feature-store", _keyword_file_hits(root, r"\bfeature store\b|\bfeature_store\b"))

    if any(path.endswith(".ipynb") for path in paths):
        notebook_hits = [path for path in paths if path.endswith(".ipynb")][:6]
        add_signal("notebooks", notebook_hits)

    if any(path.endswith(".sql") for path in paths):
        sql_hits = [path for path in paths if path.endswith(".sql")][:6]
        add_signal("sql", sql_hits)

    return signals


def _ml_risks(
    stack_signals: dict[str, list[str]],
    training_files: list[str],
    evaluation_files: list[str],
    inference_files: list[str],
    data_files: list[str],
    test_files: list[str],
    notebook_files: list[str],
) -> list[str]:
    risks: list[str] = []
    if training_files and not evaluation_files:
        risks.append("Training code is visible, but offline evaluation or validation entrypoints are not obvious yet.")
    if inference_files and not test_files:
        risks.append("Inference or serving code exists, but test coverage is not obvious from filenames.")
    if data_files and not training_files:
        risks.append("Data or feature pipelines are visible, but the model training entrypoint is not obvious yet.")
    if notebook_files and len(notebook_files) >= max(3, len(training_files)):
        risks.append("A lot of the workflow appears notebook-heavy, which can hide production logic and make reproducibility harder.")
    if training_files and "mlflow" not in stack_signals:
        risks.append("Model training is present, but MLflow usage was not detected in a quick scan.")
    if training_files and "databricks" in stack_signals and "pyspark" not in stack_signals:
        risks.append("Databricks signals are present, but Spark usage is not obvious. Double-check whether large data prep happens elsewhere.")
    return risks[:5]


def _approval_texts(request_messages: list[dict] | None) -> list[str]:
    if not request_messages:
        return []
    texts: list[str] = []
    for item in request_messages:
        if item.get("role") != "user":
            continue
        content = item.get("content")
        if isinstance(content, str):
            texts.append(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    texts.append(part["text"])
    return texts


def _latest_user_request_summary() -> str | None:
    texts = [text.strip() for text in _approval_texts(_CONTEXT.request_messages) if text.strip()]
    if not texts:
        return None
    latest = texts[-1].replace("\n", " ").strip()
    return latest[:220]


def _change_risk_level(changes: list[dict]) -> str:
    if any(change.get("mode") in {"overwrite", "create"} for change in changes):
        return "medium"
    if len(changes) >= 4:
        return "medium"
    return "low"


def is_staged_write_marker(text: str) -> bool:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return False
    return payload.get("type") == STAGED_WRITE_MARKER


def parse_staged_write_marker(text: str) -> dict:
    payload = json.loads(text)
    if payload.get("type") != STAGED_WRITE_MARKER:
        raise ValueError("Not a staged write marker")
    return payload


def detect_approval_response(request_messages: list[dict] | None) -> tuple[str | None, bool | None]:
    if not request_messages:
        return None, None
    for item in request_messages:
        item_type = item.get("type")
        if item_type == "mcp_approval_response":
            request_id = item.get("approval_request_id") or item.get("id") or item.get("call_id")
            approved = item.get("approve")
            if isinstance(request_id, str) and isinstance(approved, bool):
                return request_id, approved
        if item_type == "function_call_output":
            request_id = item.get("call_id") or item.get("id")
            output = item.get("output")
            if isinstance(output, str):
                try:
                    parsed = json.loads(output)
                except json.JSONDecodeError:
                    continue
                approved = parsed.get("__approvalStatus__")
                if isinstance(request_id, str) and isinstance(approved, bool):
                    return request_id, approved
    return None, None


@dataclass(slots=True)
class FilesystemToolContext:
    request_messages: list[dict] | None = None


_CONTEXT = FilesystemToolContext()


def set_filesystem_tool_context(request_messages: list[dict] | None) -> None:
    _CONTEXT.request_messages = request_messages


def clear_filesystem_tool_context() -> None:
    _CONTEXT.request_messages = None


def _has_user_approval(operation_id: str) -> bool:
    approval_token = f"{APPROVAL_PREFIX}{operation_id}"
    return any(approval_token in text for text in _approval_texts(_CONTEXT.request_messages))


def _make_diff(old_text: str, new_text: str, path_label: str) -> str:
    diff = unified_diff(
        old_text.splitlines(),
        new_text.splitlines(),
        fromfile=f"{path_label} (current)",
        tofile=f"{path_label} (proposed)",
        lineterm="",
    )
    lines = list(diff)
    return "\n".join(lines[:400])


def _stage_operation(operation: dict) -> str:
    operation_id = f"write_{uuid.uuid4().hex[:12]}"
    staged = _load_staged_writes()
    operation.setdefault("workspace_root", str(workspace_root()))
    staged[operation_id] = {
        **operation,
        "operation_id": operation_id,
        "created_at": utc_now(),
    }
    _save_staged_writes(staged)
    return operation_id


def _build_marker(operation_id: str, tool_name: str, summary: str, changes: list[dict]) -> str:
    rationale = _latest_user_request_summary()
    current_root = str(workspace_root())
    compact_changes = [
        {
            "path": change.get("path"),
            "mode": change.get("mode"),
            "content_bytes": len(str(change.get("content", "")).encode("utf-8")),
            "preview": _truncate_output(str(change.get("preview", "")), 3000),
        }
        for change in changes
    ]
    return json.dumps(
        {
            "type": STAGED_WRITE_MARKER,
            "request_id": operation_id,
            "tool_name": tool_name,
            "server_label": APPROVAL_SERVER_LABEL,
            "summary": summary,
            "rationale": rationale,
            "risk_level": _change_risk_level(changes),
            "workspace_root": current_root,
            "changes": compact_changes,
            "instruction": "Requires explicit user approval before applying these file changes.",
        },
        ensure_ascii=True,
    )


def approval_payload_for_staged_write(operation_id: str, marker: dict | None = None) -> dict:
    staged = _load_staged_writes()
    operation = staged.get(operation_id) or {}
    changes = operation.get("changes")
    if not isinstance(changes, list):
        changes = (marker or {}).get("changes", [])
    return {
        "summary": operation.get("summary") or (marker or {}).get("summary"),
        "rationale": (marker or {}).get("rationale"),
        "riskLevel": (marker or {}).get("risk_level"),
        "workspaceRoot": operation.get("workspace_root") or (marker or {}).get("workspace_root"),
        "instruction": (marker or {}).get("instruction"),
        "changes": [
            {
                "path": change.get("path"),
                "mode": change.get("mode"),
                "content": change.get("content"),
                "preview": change.get("preview"),
            }
            for change in changes
            if isinstance(change, dict)
        ],
    }


def _run_git(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(workspace_root()), *args],
        capture_output=True,
        text=True,
        check=False,
    )


def _git_repo_available() -> bool:
    result = _run_git(["rev-parse", "--show-toplevel"])
    return result.returncode == 0


@tool
def git_repo_summary(max_commits: int = 8) -> str:
    """Summarize the current git repo state for the selected workspace: branch, changed files, and recent commits."""
    if not _git_repo_available():
        return "The selected workspace is not a git repository."

    commit_limit = max(1, min(max_commits, 20))
    branch_result = _run_git(["branch", "--show-current"])
    status_result = _run_git(["status", "--short"])
    diff_stat_result = _run_git(["diff", "--stat"])
    staged_stat_result = _run_git(["diff", "--cached", "--stat"])
    commits_result = _run_git(["log", f"-n{commit_limit}", "--oneline", "--decorate"])

    summary = {
        "workspace_root": str(workspace_root()),
        "branch": branch_result.stdout.strip() or "(detached)",
        "status": [line for line in status_result.stdout.splitlines() if line.strip()][:80],
        "unstaged_diff_stat": [line for line in diff_stat_result.stdout.splitlines() if line.strip()][:40],
        "staged_diff_stat": [line for line in staged_stat_result.stdout.splitlines() if line.strip()][:40],
        "recent_commits": [line for line in commits_result.stdout.splitlines() if line.strip()][:commit_limit],
    }
    return json.dumps(summary, indent=2, ensure_ascii=True)


@tool
def list_files(path: str = ".", recursive: bool = False) -> str:
    """List files or directories within the configured workspace root."""
    base = _resolve_path(path)
    if not base.exists():
        return f"Path not found: {base}"
    entries: list[str] = []
    if base.is_file():
        return str(base)
    if recursive:
        for child in sorted(base.rglob("*")):
            entries.append(str(child.relative_to(workspace_root())))
    else:
        for child in sorted(base.iterdir()):
            entries.append(str(child.relative_to(workspace_root())))
    return "\n".join(entries[:500]) or "(empty directory)"


@tool
def workspace_overview(force_refresh: bool = False) -> str:
    """Return a cached structural overview of the workspace to help the agent understand the repo."""
    index = build_workspace_index(force_refresh=force_refresh)
    summary = {
        "root": index["root"],
        "generated_at": index["generated_at"],
        "file_count": index["file_count"],
        "truncated": index.get("truncated", False),
        "extensions": index["extensions"],
        "top_level_dirs": index["top_level_dirs"],
        "important_files": index["important_files"][:20],
    }
    return json.dumps(summary, indent=2, ensure_ascii=True)


@tool
def ml_repo_overview(force_refresh: bool = False) -> str:
    """Return a compact ML-oriented map of the workspace: training, evaluation, inference, configs, stack signals, and likely risks."""
    index = build_workspace_index(force_refresh=force_refresh)
    root = Path(index["root"])
    paths = [file_info["path"] for file_info in index["files"] if isinstance(file_info, dict)]

    config_files = _top_matches(
        paths,
        (
            "pyproject.toml",
            "requirements.txt",
            "environment.yml",
            "conda.yml",
            "databricks.yml",
            "mlflow",
            "config",
            ".yaml",
            ".yml",
            ".json",
        ),
    )
    training_files = _top_matches(
        paths,
        (
            "train",
            "trainer",
            "fit",
            "finetune",
            "fine_tune",
            "model",
            "pipeline",
        ),
    )
    evaluation_files = _top_matches(
        paths,
        (
            "eval",
            "evaluate",
            "metric",
            "validation",
            "benchmark",
            "test_model",
        ),
    )
    inference_files = _top_matches(
        paths,
        (
            "predict",
            "score",
            "infer",
            "inference",
            "serve",
            "serving",
            "endpoint",
            "batch",
        ),
    )
    data_files = _top_matches(
        paths,
        (
            "feature",
            "features",
            "dataset",
            "datasets",
            "preprocess",
            "prep",
            "transform",
            "etl",
            "data",
        ),
    )
    orchestration_files = _top_matches(
        paths,
        (
            "job",
            "workflow",
            "dag",
            "bundle",
            "pipeline",
            "deploy",
            "serving",
            "endpoint",
        ),
    )
    test_files = _top_matches(
        paths,
        (
            "test",
            "tests",
            "spec",
            "integration",
            "smoke",
            "regression",
        ),
    )
    notebook_files = [path for path in paths if path.endswith(".ipynb")][:8]
    stack_signals = _stack_signals(root, paths)

    summary = {
        "root": index["root"],
        "file_count": index["file_count"],
        "top_level_dirs": index["top_level_dirs"],
        "important_files": index["important_files"][:12],
        "ml_stack_signals": stack_signals,
        "likely_training_entrypoints": training_files,
        "likely_evaluation_entrypoints": evaluation_files,
        "likely_inference_or_serving_entrypoints": inference_files,
        "likely_data_or_feature_pipelines": data_files,
        "likely_orchestration_or_deployment_files": orchestration_files,
        "likely_test_files": test_files,
        "notebooks": notebook_files,
        "config_files": config_files,
        "likely_risks_or_gaps": _ml_risks(
            stack_signals=stack_signals,
            training_files=training_files,
            evaluation_files=evaluation_files,
            inference_files=inference_files,
            data_files=data_files,
            test_files=test_files,
            notebook_files=notebook_files,
        ),
    }
    return json.dumps(summary, indent=2, ensure_ascii=True)


@tool
def ci_repo_overview(force_refresh: bool = False) -> str:
    """Return a compact CI/CD-oriented map of the workspace: workflow files, referenced scripts/actions, manifests, and likely failure points."""
    index = build_workspace_index(force_refresh=force_refresh)
    root = Path(index["root"])
    paths = [file_info["path"] for file_info in index["files"] if isinstance(file_info, dict)]

    workflow_files = _ordered_unique(
        [
            path
            for path in paths
            if path.startswith(".github/workflows/")
            or path == ".gitlab-ci.yml"
            or path.startswith(".circleci/")
            or path.endswith("Jenkinsfile")
            or "azure-pipelines" in path
            or path == "bitbucket-pipelines.yml"
            or path.startswith(".buildkite/")
        ],
        limit=20,
    )
    local_action_files = _ordered_unique(
        [
            path
            for path in paths
            if path.startswith(".github/actions/") and Path(path).name in {"action.yml", "action.yaml"}
        ],
        limit=12,
    )
    manifest_files = _top_matches(
        paths,
        (
            "package.json",
            "pnpm-lock.yaml",
            "yarn.lock",
            "bun.lock",
            "pyproject.toml",
            "requirements",
            "poetry.lock",
            "uv.lock",
            "dockerfile",
            "docker-compose",
            "makefile",
            "gradle",
            "pom.xml",
            "cargo.toml",
            "go.mod",
            ".nvmrc",
            ".tool-versions",
        ),
        limit=16,
    )

    workflow_summaries = [
        _workflow_summary(root, rel_path)
        for rel_path in workflow_files[:8]
    ]
    referenced_local_paths = _ordered_unique(
        [
            ref
            for summary in workflow_summaries
            for ref in (
                list(summary["local_reusable_workflows"])
                + list(summary["local_actions"])
                + list(summary["referenced_scripts"])
            )
        ],
        limit=30,
    )
    existing_local_references, missing_local_references = _existing_repo_paths(
        root,
        referenced_local_paths,
    )
    recommended_first_reads = _ordered_unique(
        workflow_files[:4]
        + existing_local_references[:8]
        + local_action_files[:4]
        + manifest_files[:6],
        limit=16,
    )

    summary = {
        "root": index["root"],
        "file_count": index["file_count"],
        "ci_systems_detected": _classify_ci_systems(paths),
        "workflow_files": workflow_files[:12],
        "local_action_files": local_action_files[:8],
        "build_or_test_manifests": manifest_files,
        "workflow_summaries": workflow_summaries,
        "referenced_local_paths": existing_local_references[:16],
        "missing_local_references": missing_local_references[:12],
        "recommended_first_reads": recommended_first_reads,
        "likely_risks_or_gaps": _ci_risks(
            workflow_summaries=workflow_summaries,
            missing_local_references=missing_local_references,
            manifest_files=manifest_files,
        ),
    }
    return json.dumps(summary, indent=2, ensure_ascii=True)


@tool
def find_files_by_name(query: str, limit: int = 20) -> str:
    """Find files by partial name/path using the cached workspace index."""
    index = build_workspace_index(force_refresh=False)
    needle = query.lower().strip()
    matches = [
        file_info["path"]
        for file_info in index["files"]
        if needle in file_info["path"].lower() or needle in file_info["name"].lower()
    ]
    return "\n".join(matches[:limit]) if matches else "No matching files found."


@tool
def recent_file_reads(limit: int = 12) -> str:
    """Show recently read file ranges for this conversation so you can reuse them instead of rereading."""
    records = _recent_reads(limit=max(1, min(limit, 50)))
    if not records:
        return "No file ranges have been read yet in this conversation."
    lines = []
    for record in records:
        lines.append(
            f"{record['path']} lines {record['start_line']}-{record['end_line']} "
            f"(read {record['last_read_at']}, hash {record['content_sha256']})"
        )
    return "\n".join(lines)


@tool
def search_files(query: str, path: str = ".", glob: str | None = None) -> str:
    """Search for text in files under the workspace root. Returns matching file paths and lines."""
    base = _resolve_path(path)
    normalized_glob = _normalize_glob(glob)
    if _is_overly_broad_glob(normalized_glob) and not _user_requested_repo_wide_search():
        return _search_scope_error(normalized_glob)
    rg = shutil.which("rg")
    if rg:
        cmd = [rg, "-n", "--hidden", "--glob", "!.git", query, str(base)]
        if normalized_glob:
            cmd.extend(["-g", normalized_glob])
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        output = result.stdout.strip()
        match_count = len(output.splitlines()) if output else 0
        _record_tool_activity(
            "search",
            {
                "query": query,
                "path": str(base.relative_to(workspace_root())) if base != workspace_root() else ".",
                "glob": normalized_glob,
                "match_count": match_count,
            },
        )
        if not output:
            return "No matches found."
        lines = [_truncate_line(line) for line in output.splitlines()[: max_search_results()]]
        return _truncate_output("\n".join(lines))

    matches: list[str] = []
    for file_path in sorted(base.rglob("*")):
        if not file_path.is_file():
            continue
        if normalized_glob and not file_path.match(normalized_glob):
            continue
        try:
            text = _read_text(file_path)
        except Exception:
            continue
        for idx, line in enumerate(text.splitlines(), start=1):
            if query in line:
                rel = file_path.relative_to(workspace_root())
                matches.append(_truncate_line(f"{rel}:{idx}:{line}"))
                if len(matches) >= max_search_results():
                    _record_tool_activity(
                        "search",
                        {
                            "query": query,
                            "path": str(base.relative_to(workspace_root())) if base != workspace_root() else ".",
                            "glob": normalized_glob,
                            "match_count": len(matches),
                        },
                    )
                    return _truncate_output("\n".join(matches))
    _record_tool_activity(
        "search",
        {
            "query": query,
            "path": str(base.relative_to(workspace_root())) if base != workspace_root() else ".",
            "glob": normalized_glob,
            "match_count": len(matches),
        },
    )
    return _truncate_output("\n".join(matches)) if matches else "No matches found."


@tool
def search_code_blocks(
    query: str,
    path: str = ".",
    glob: str | None = None,
    context_lines: int = 4,
    max_matches: int = 5,
) -> str:
    """Search for keywords and return surrounding code blocks/snippets instead of full-file reads."""
    base = _resolve_path(path)
    normalized_glob = _normalize_glob(glob)
    context = max(1, min(context_lines, 40))
    max_hits = max(1, min(max_matches, 20))
    if _is_overly_broad_glob(normalized_glob) and not _user_requested_repo_wide_search():
        return _search_scope_error(normalized_glob)
    rg = shutil.which("rg")
    if rg:
        cmd = [rg, "-n", "--hidden", "--glob", "!.git", "-C", str(context), query, str(base)]
        if normalized_glob:
            cmd.extend(["-g", normalized_glob])
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        output = result.stdout.strip()
        blocks = output.split("\n--\n") if output else []
        _record_tool_activity(
            "code_search",
            {
                "query": query,
                "path": str(base.relative_to(workspace_root())) if base != workspace_root() else ".",
                "glob": normalized_glob,
                "match_count": len(blocks),
            },
        )
        if not output:
            return "No matching code blocks found."
        compact_blocks = [
            "\n".join(_truncate_line(line) for line in block.splitlines())
            for block in blocks[:max_hits]
        ]
        return _truncate_output("\n--\n".join(compact_blocks))

    blocks: list[str] = []
    for file_path in sorted(base.rglob("*")):
        if not file_path.is_file():
            continue
        if normalized_glob and not file_path.match(normalized_glob):
            continue
        try:
            text = _read_text(file_path)
        except Exception:
            continue
        lines = text.splitlines()
        for idx, line in enumerate(lines, start=1):
            if query not in line:
                continue
            start = max(1, idx - context)
            end = min(len(lines), idx + context)
            snippet = "\n".join(
                _truncate_line(f"{line_no}: {lines[line_no - 1]}")
                for line_no in range(start, end + 1)
            )
            rel = file_path.relative_to(workspace_root())
            blocks.append(f"{rel}:{idx}\n{snippet}")
            if len(blocks) >= max_hits:
                _record_tool_activity(
                    "code_search",
                    {
                        "query": query,
                        "path": str(base.relative_to(workspace_root())) if base != workspace_root() else ".",
                        "glob": normalized_glob,
                        "match_count": len(blocks),
                    },
                )
                return _truncate_output("\n--\n".join(blocks))
    _record_tool_activity(
        "code_search",
        {
            "query": query,
            "path": str(base.relative_to(workspace_root())) if base != workspace_root() else ".",
            "glob": normalized_glob,
            "match_count": len(blocks),
        },
    )
    return _truncate_output("\n--\n".join(blocks)) if blocks else "No matching code blocks found."


@tool
def read_file(path: str, start_line: int = 1, end_line: int = 200, force_reread: bool = False) -> str:
    """Read a text file within the workspace root. Avoid rereading the same range unless you need different lines or set force_reread=true."""
    target = _resolve_path(path)
    if not target.exists():
        return f"File not found: {target}"
    if target.is_dir():
        return f"Path is a directory, not a file: {target}"
    if not force_reread:
        cached = _lookup_cached_read(target, start_line, end_line)
        if cached is not None:
            return _cached_read_message(cached)
    text = _read_text(target)
    lines = text.splitlines()
    start = max(start_line, 1)
    end = min(max(end_line, start), len(lines))
    requested_end = end
    max_end = min(start + max_read_lines() - 1, len(lines))
    end = min(end, max_end)
    snippet = lines[start - 1 : end]
    numbered = [_truncate_line(f"{i}: {line}") for i, line in enumerate(snippet, start=start)]
    output = "\n".join(numbered) or "(empty file)"
    if requested_end > end:
        output += (
            f"\n... [read truncated at {max_read_lines()} lines; request a narrower range "
            f"or continue at line {end + 1}]"
        )
    output = _truncate_output(output)
    _remember_file_read(target, start, end, len(snippet), output)
    return output


@tool
def stage_file_write(
    path: str,
    content: str,
    mode: Literal["create", "overwrite"] = "overwrite",
) -> str:
    """Stage a file create/overwrite operation. The user must explicitly approve it in chat before it can be applied."""
    if not writes_enabled():
        return "File writes are disabled by configuration."

    target = _resolve_path(path)
    exists = target.exists()
    if mode == "create" and exists:
        return f"Refusing to create {target}: file already exists."
    if mode == "overwrite" and not exists:
        return f"Refusing to overwrite {target}: file does not exist."
    if exists and target.is_dir():
        return f"Refusing to write {target}: path is a directory."

    current_text = _read_text(target) if exists else ""
    diff_text = _make_diff(current_text, content, str(target.relative_to(workspace_root())))
    preview = diff_text or "(new file contents stored; no textual diff available)"
    rel_path = str(target.relative_to(workspace_root()))
    operation_id = _stage_operation(
        {
            "kind": "change_set",
            "tool_name": "write_file",
            "summary": f"{mode} {rel_path}",
            "workspace_root": str(workspace_root()),
            "changes": [
                {
                    "path": rel_path,
                    "absolute_path": str(target),
                    "mode": mode,
                    "content": content,
                    "preview": preview,
                }
            ],
        }
    )
    return _build_marker(
        operation_id=operation_id,
        tool_name="write_file",
        summary=f"{mode} {rel_path}",
        changes=[
            {
                "path": rel_path,
                "mode": mode,
                "content": content,
                "preview": preview,
            }
        ],
    )


@tool
def stage_patch_edit(
    path: str,
    search_text: str,
    replace_text: str,
    replace_all: bool = False,
) -> str:
    """Stage an exact-text patch edit for a file. Preferred over raw overwrite for code edits."""
    target = _resolve_path(path)
    if not target.exists() or target.is_dir():
        return f"File not found: {target}"
    current_text = _read_text(target)
    occurrences = current_text.count(search_text)
    if occurrences == 0:
        return f"Search text not found in {target}"
    if occurrences > 1 and not replace_all:
        return (
            f"Search text appears {occurrences} times in {target}. "
            "Set replace_all=true or provide more specific search text."
        )
    new_text = current_text.replace(search_text, replace_text) if replace_all else current_text.replace(search_text, replace_text, 1)
    preview = _make_diff(current_text, new_text, str(target.relative_to(workspace_root())))
    rel_path = str(target.relative_to(workspace_root()))
    operation_id = _stage_operation(
        {
            "kind": "change_set",
            "tool_name": "patch_edit",
            "summary": f"Patch edit {rel_path}",
            "workspace_root": str(workspace_root()),
            "changes": [
                {
                    "path": rel_path,
                    "absolute_path": str(target),
                    "mode": "patch",
                    "content": new_text,
                    "preview": preview,
                }
            ],
        }
    )
    return _build_marker(
        operation_id=operation_id,
        tool_name="patch_edit",
        summary=f"Patch edit {rel_path}",
        changes=[
            {
                "path": rel_path,
                "mode": "patch",
                "content": new_text,
                "preview": preview,
            }
        ],
    )


def _prepare_change(change: dict) -> dict:
    change_type = change.get("type", "patch")
    path = str(change.get("path", "")).strip()
    if not path:
        raise ValueError("Each change must include a path")
    target = _resolve_path(path)
    rel_path = str(target.relative_to(workspace_root()))
    if change_type in {"create", "overwrite"}:
        content = str(change.get("content", ""))
        exists = target.exists()
        if change_type == "create" and exists:
            raise ValueError(f"Cannot create {rel_path}; file already exists")
        if change_type == "overwrite" and (not exists or target.is_dir()):
            raise ValueError(f"Cannot overwrite {rel_path}; file does not exist")
        current_text = _read_text(target) if exists and target.is_file() else ""
        preview = _make_diff(current_text, content, rel_path) or "(new file contents stored; no textual diff available)"
        return {
            "path": rel_path,
            "absolute_path": str(target),
            "mode": change_type,
            "content": content,
            "preview": preview,
        }
    if change_type == "patch":
        if not target.exists() or target.is_dir():
            raise ValueError(f"Cannot patch {rel_path}; file does not exist")
        current_text = _read_text(target)
        search_text = str(change.get("search_text", ""))
        replace_text = str(change.get("replace_text", ""))
        replace_all = bool(change.get("replace_all", False))
        occurrences = current_text.count(search_text)
        if occurrences == 0:
            raise ValueError(f"Search text not found in {rel_path}")
        if occurrences > 1 and not replace_all:
            raise ValueError(f"Search text appears {occurrences} times in {rel_path}; use replace_all or narrower text")
        new_text = current_text.replace(search_text, replace_text) if replace_all else current_text.replace(search_text, replace_text, 1)
        preview = _make_diff(current_text, new_text, rel_path)
        return {
            "path": rel_path,
            "absolute_path": str(target),
            "mode": "patch",
            "content": new_text,
            "preview": preview,
        }
    raise ValueError(f"Unsupported change type: {change_type}")


@tool
def stage_change_plan(changes_json: str, summary: str = "Grouped file changes") -> str:
    """Stage a grouped multi-file change plan for one approval action."""
    try:
        raw_changes = json.loads(changes_json)
    except json.JSONDecodeError as exc:
        return f"Invalid JSON: {exc}"
    if not isinstance(raw_changes, list) or not raw_changes:
        return "changes_json must be a non-empty JSON array."
    try:
        changes = [_prepare_change(change) for change in raw_changes if isinstance(change, dict)]
    except ValueError as exc:
        return str(exc)
    operation_id = _stage_operation(
        {
            "kind": "change_set",
            "tool_name": "change_plan",
            "summary": summary,
            "changes": changes,
        }
    )
    return _build_marker(
        operation_id=operation_id,
        tool_name="change_plan",
        summary=summary,
        changes=[
            {
                "path": change["path"],
                "mode": change["mode"],
                "content": change["content"],
                "preview": change["preview"],
            }
            for change in changes
        ],
    )


@tool
def apply_staged_write(operation_id: str) -> str:
    """Apply a previously staged file write after the user explicitly approves it in chat."""
    if not writes_enabled():
        return "File writes are disabled by configuration."
    if not _has_user_approval(operation_id):
        return (
            f"Write {operation_id} is not approved yet. "
            "Use the approval controls in the UI before applying these changes."
        )
    staged = _load_staged_writes()
    operation = staged.get(operation_id)
    if not operation:
        return f"No staged write found for {operation_id}"
    return apply_staged_write_by_approval_id(operation_id)


@tool
def show_staged_write(operation_id: str) -> str:
    """Show the currently staged write operation and its diff preview."""
    staged = _load_staged_writes()
    operation = staged.get(operation_id)
    if not operation:
        return f"No staged write found for {operation_id}"
    payload = {
        "operation_id": operation_id,
        "summary": operation.get("summary"),
        "tool_name": operation.get("tool_name"),
        "created_at": operation["created_at"],
        "approved": _has_user_approval(operation_id),
        "changes": [
            {
                "path": change["path"],
                "mode": change["mode"],
                "preview": change["preview"],
            }
            for change in operation.get("changes", [])
        ],
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


def apply_staged_write_by_approval_id(operation_id: str) -> str:
    staged = _load_staged_writes()
    operation = staged.get(operation_id)
    if not operation:
        raise ValueError(f"No staged write found for {operation_id}")
    operation_root = Path(str(operation.get("workspace_root") or workspace_root())).resolve()
    applied_paths: list[str] = []
    for change in operation.get("changes", []):
        absolute_path = str(change.get("absolute_path", "")).strip()
        target = (
            _resolve_path_with_root(absolute_path, operation_root)
            if absolute_path
            else _resolve_path_with_root(change["path"], operation_root)
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(change["content"], encoding="utf-8")
        applied_paths.append(str(target.relative_to(operation_root)))
    staged.pop(operation_id, None)
    _save_staged_writes(staged)
    return (
        f"Allowed. Applied file changes in {operation_root} to: "
        f"{', '.join(applied_paths)}"
    )


FILESYSTEM_TOOLS = [
    workspace_overview,
    ml_repo_overview,
    ci_repo_overview,
    find_files_by_name,
    recent_file_reads,
    git_repo_summary,
    list_files,
    search_files,
    search_code_blocks,
    read_file,
    stage_file_write,
    stage_patch_edit,
    stage_change_plan,
    apply_staged_write,
    show_staged_write,
]
