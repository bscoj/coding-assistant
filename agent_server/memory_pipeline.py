from __future__ import annotations

import json
import logging
import math
import os
import re
from dataclasses import asdict
from typing import Any

from agent_server.memory_models import (
    FactStatusChange,
    FactUpsert,
    MemoryState,
    MemoryUpdatePayload,
    PinnedTurnUpsert,
    TaskJournal,
)
from agent_server.memory_models import StoredMessage
from agent_server.memory_store import get_memory_store, normalize_item
from agent_server.sql_memory_store import extract_tables

logger = logging.getLogger(__name__)

DEFAULT_THRESHOLD_MESSAGES = 10
DEFAULT_RECENT_MESSAGES = 12
DEFAULT_WORK_THRESHOLD_MESSAGES = 12
DEFAULT_WORK_RECENT_MESSAGES = 28
DEFAULT_RAW_THRESHOLD_MESSAGES = 20
DEFAULT_RAW_RECENT_MESSAGES = 140
DEFAULT_MIN_FACT_CONFIDENCE = 0.65
DEFAULT_MAX_SUMMARY_WORDS = 450
DEFAULT_WORK_MAX_SUMMARY_WORDS = 1000
DEFAULT_RAW_MAX_SUMMARY_WORDS = 1600
DEFAULT_MEMORY_MODE = "work"
DEFAULT_TOOL_SUMMARY_MAX_CHARS = 1200
DEFAULT_WORKING_SET_FALLBACK_MESSAGES = 24
DEFAULT_PROMPT_SOFT_TOKEN_LIMIT = 50000
DEFAULT_PROMPT_HARD_TOKEN_LIMIT = 70000
DEFAULT_PROMPT_TARGET_TOKEN_LIMIT = 36000
DEFAULT_COMPACT_RECENT_MESSAGES = 12
DEFAULT_WORK_COMPACT_RECENT_MESSAGES = 14
DEFAULT_RAW_COMPACT_RECENT_MESSAGES = 22
DEFAULT_MIN_COMPACT_RECENT_MESSAGES = 8
DEFAULT_COMPACT_RECENT_CONTEXT_CHARS = 2200
DEFAULT_COMPACT_TOOL_MEMORY_CHARS = 1200

CODE_FENCE_PATTERN = re.compile(r"```(?P<lang>[A-Za-z0-9_+-]*)\n(?P<code>.*?)(?:```|$)", re.S)
PATH_PATTERN = re.compile(
    r"(?<![\w/])(?:"
    r"(?:[A-Za-z0-9._-]+/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?"
    r"|"
    r"[A-Za-z0-9_.-]+\.(?:py|ts|tsx|js|jsx|sql|yaml|yml|json|toml|md|sh|txt|ipynb)"
    r")(?![\w/])"
)
ERROR_LINE_PATTERN = re.compile(
    r"(?im)^(?:traceback.*|.*(?:error|exception|failed|failure|permission denied|typeerror|valueerror|filenotfounderror).*)$"
)


def memory_enabled() -> bool:
    return os.getenv("MEMORY_ENABLED", "true").lower() not in {"0", "false", "no"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid integer for %s=%s. Using default %s.", name, raw, default)
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Invalid float for %s=%s. Using default %s.", name, raw, default)
        return default


def normalize_memory_mode(mode: str | None = None) -> str:
    raw = (mode or os.getenv("MEMORY_MODE", DEFAULT_MEMORY_MODE)).strip().lower()
    if raw in {"balanced", "standard", "default", "lean"}:
        return "lean"
    if raw == "work":
        return "work"
    if raw == "raw":
        return "raw"
    logger.warning("Invalid MEMORY_MODE=%s. Using %s.", raw, DEFAULT_MEMORY_MODE)
    return DEFAULT_MEMORY_MODE


def recent_messages_limit(mode: str | None = None) -> int:
    normalized = normalize_memory_mode(mode)
    if normalized == "work":
        return _env_int("MEMORY_WORK_RECENT_MESSAGES", DEFAULT_WORK_RECENT_MESSAGES)
    if normalized == "raw":
        return _env_int("MEMORY_RAW_RECENT_MESSAGES", DEFAULT_RAW_RECENT_MESSAGES)
    return _env_int("MEMORY_RECENT_MESSAGES", DEFAULT_RECENT_MESSAGES)


def summarize_threshold_messages(mode: str | None = None) -> int:
    normalized = normalize_memory_mode(mode)
    if normalized == "work":
        return _env_int(
            "MEMORY_WORK_SUMMARY_THRESHOLD_MESSAGES",
            DEFAULT_WORK_THRESHOLD_MESSAGES,
        )
    if normalized == "raw":
        return _env_int(
            "MEMORY_RAW_SUMMARY_THRESHOLD_MESSAGES",
            DEFAULT_RAW_THRESHOLD_MESSAGES,
        )
    return _env_int("MEMORY_SUMMARY_THRESHOLD_MESSAGES", DEFAULT_THRESHOLD_MESSAGES)


def max_summary_words(mode: str | None = None) -> int:
    normalized = normalize_memory_mode(mode)
    if normalized == "work":
        return _env_int("MEMORY_WORK_MAX_SUMMARY_WORDS", DEFAULT_WORK_MAX_SUMMARY_WORDS)
    if normalized == "raw":
        return _env_int("MEMORY_RAW_MAX_SUMMARY_WORDS", DEFAULT_RAW_MAX_SUMMARY_WORDS)
    return _env_int("MEMORY_MAX_SUMMARY_WORDS", DEFAULT_MAX_SUMMARY_WORDS)


def min_fact_confidence() -> float:
    return _env_float("MEMORY_MIN_FACT_CONFIDENCE", DEFAULT_MIN_FACT_CONFIDENCE)


def tool_summary_max_chars() -> int:
    return _env_int("MEMORY_TOOL_SUMMARY_MAX_CHARS", DEFAULT_TOOL_SUMMARY_MAX_CHARS)


def _dedupe_compact_list(values: list[Any], limit: int) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for raw in values:
        value = " ".join(str(raw).split()).strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(value[:240])
        if len(output) >= limit:
            break
    return output


def working_set_fallback_messages(mode: str | None = None) -> int:
    return min(
        recent_messages_limit(mode),
        _env_int(
            "MEMORY_WORKING_SET_FALLBACK_MESSAGES",
            DEFAULT_WORKING_SET_FALLBACK_MESSAGES,
        ),
    )


def prompt_soft_token_limit() -> int:
    return _env_int("MEMORY_PROMPT_SOFT_TOKEN_LIMIT", DEFAULT_PROMPT_SOFT_TOKEN_LIMIT)


def prompt_hard_token_limit() -> int:
    return _env_int("MEMORY_PROMPT_HARD_TOKEN_LIMIT", DEFAULT_PROMPT_HARD_TOKEN_LIMIT)


def prompt_target_token_limit() -> int:
    return _env_int("MEMORY_PROMPT_TARGET_TOKEN_LIMIT", DEFAULT_PROMPT_TARGET_TOKEN_LIMIT)


def compact_recent_messages_limit(mode: str | None = None) -> int:
    normalized = normalize_memory_mode(mode)
    if normalized == "work":
        return _env_int(
            "MEMORY_WORK_COMPACT_RECENT_MESSAGES",
            DEFAULT_WORK_COMPACT_RECENT_MESSAGES,
        )
    if normalized == "raw":
        return _env_int(
            "MEMORY_RAW_COMPACT_RECENT_MESSAGES",
            DEFAULT_RAW_COMPACT_RECENT_MESSAGES,
        )
    return _env_int("MEMORY_COMPACT_RECENT_MESSAGES", DEFAULT_COMPACT_RECENT_MESSAGES)


def min_compact_recent_messages() -> int:
    return _env_int(
        "MEMORY_MIN_COMPACT_RECENT_MESSAGES",
        DEFAULT_MIN_COMPACT_RECENT_MESSAGES,
    )


def compact_recent_context_chars() -> int:
    return _env_int(
        "MEMORY_COMPACT_RECENT_CONTEXT_CHARS",
        DEFAULT_COMPACT_RECENT_CONTEXT_CHARS,
    )


def compact_tool_memory_chars() -> int:
    return _env_int(
        "MEMORY_COMPACT_TOOL_MEMORY_CHARS",
        DEFAULT_COMPACT_TOOL_MEMORY_CHARS,
    )


def _extract_paths(text: str, limit: int = 12) -> list[str]:
    values: list[str] = []
    for match in PATH_PATTERN.finditer(text):
        candidate = match.group(0).strip("`'\"()[]{}.,:;")
        if len(candidate) > 180:
            continue
        values.append(candidate)
    return _dedupe_compact_list(values, limit)


def _interesting_code_line(code: str) -> str:
    for raw_line in code.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(("#", "//", "--", "/*", "*")):
            continue
        return line[:160]
    return ""


def _describe_code_block(language: str, code: str) -> str:
    lowered_language = (language or "code").strip().lower()
    if lowered_language == "sql":
        tables = extract_tables(code)
        if tables:
            return f"sql query using {', '.join(tables[:3])}"
        return "sql query"

    patterns = [
        (re.compile(r"(?m)^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)"), "python function"),
        (re.compile(r"(?m)^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)"), "class"),
        (re.compile(r"(?m)^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)"), "function"),
        (
            re.compile(
                r"(?m)^\s*(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\("
            ),
            "variable function",
        ),
        (
            re.compile(r"(?im)^\s*create(?:\s+or\s+replace)?\s+view\s+([A-Za-z0-9_.-]+)"),
            "view definition",
        ),
        (
            re.compile(r"(?im)^\s*create(?:\s+or\s+replace)?\s+table\s+([A-Za-z0-9_.-]+)"),
            "table definition",
        ),
    ]
    for pattern, label in patterns:
        match = pattern.search(code)
        if match:
            return f"{label} {match.group(1)}"

    first_line = _interesting_code_line(code)
    if first_line:
        return f"{lowered_language or 'code'}: {first_line}"
    return lowered_language or "code"


def _compact_excerpt(text: str, limit: int = 220) -> str:
    compact = " ".join(text.split()).strip()
    if len(compact) <= limit:
        return compact
    return compact[:limit].rstrip() + " ..."


def _derive_structured_memory_signals(
    messages: list[StoredMessage],
    conversation_id: str,
    repo: str | None,
) -> tuple[TaskJournal, list[PinnedTurnUpsert]]:
    objective = ""
    status = "planning"
    files_inspected: list[str] = []
    files_changed: list[str] = []
    generated_code_artifacts: list[str] = []
    known_errors: list[str] = []
    pins: list[PinnedTurnUpsert] = []

    for message in messages:
        item = json.loads(message.content_json)
        text = item_text(item).strip()
        lowered = text.lower()
        if message.role == "user" and text:
            objective = _compact_excerpt(text, 260)
            if any(token in lowered for token in ("debug", "error", "failing", "broken")):
                status = "debugging"
            elif any(token in lowered for token in ("implement", "build", "add", "change", "update", "fix")):
                status = "implementing"
            elif any(token in lowered for token in ("explore", "inspect", "understand", "look at", "figure out")):
                status = "exploring"

        paths = _extract_paths(text, limit=16)
        if paths:
            files_inspected.extend(paths)
            if any(token in lowered for token in ("write", "written", "update", "updated", "create", "created", "apply", "applied", "patch", "edit")):
                files_changed.extend(paths)

        for raw_error in ERROR_LINE_PATTERN.findall(text):
            excerpt = _compact_excerpt(raw_error, 220)
            if not excerpt:
                continue
            known_errors.append(excerpt)
            pins.append(
                PinnedTurnUpsert(
                    turn_index=message.turn_index,
                    kind="error",
                    summary=excerpt[:280],
                    content_excerpt=_compact_excerpt(text, 360),
                )
            )

        for match in CODE_FENCE_PATTERN.finditer(text):
            language = (match.group("lang") or "code").strip().lower()
            code = (match.group("code") or "").strip()
            if not code:
                continue
            descriptor = _describe_code_block(language, code)
            generated_code_artifacts.append(descriptor)
            pins.append(
                PinnedTurnUpsert(
                    turn_index=message.turn_index,
                    kind="code",
                    summary=descriptor[:280],
                    content_excerpt=code[:380].strip(),
                )
            )
            if language == "sql":
                files_inspected.extend(extract_tables(code))

    return (
        TaskJournal(
            conversation_id=conversation_id,
            objective=objective,
            repo=repo,
            status=status,
            files_inspected=_dedupe_compact_list(files_inspected, 10),
            files_changed=_dedupe_compact_list(files_changed, 8),
            generated_code_artifacts=_dedupe_compact_list(generated_code_artifacts, 8),
            key_decisions=[],
            open_questions=[],
            known_errors=_dedupe_compact_list(known_errors, 8),
            next_steps=[],
            updated_at="",
        ),
        pins,
    )


def _merge_task_journal(base: TaskJournal, derived: TaskJournal) -> TaskJournal:
    status = base.status
    if base.status == "planning" and derived.status != "planning":
        status = derived.status
    return TaskJournal(
        conversation_id=base.conversation_id,
        objective=base.objective or derived.objective,
        repo=base.repo or derived.repo,
        status=status,
        files_inspected=_dedupe_compact_list(
            [*base.files_inspected, *derived.files_inspected], 8
        ),
        files_changed=_dedupe_compact_list([*base.files_changed, *derived.files_changed], 8),
        generated_code_artifacts=_dedupe_compact_list(
            [*base.generated_code_artifacts, *derived.generated_code_artifacts], 8
        ),
        key_decisions=_dedupe_compact_list(base.key_decisions, 8),
        open_questions=_dedupe_compact_list(base.open_questions, 8),
        known_errors=_dedupe_compact_list([*base.known_errors, *derived.known_errors], 8),
        next_steps=_dedupe_compact_list(base.next_steps, 8),
        updated_at=base.updated_at,
    )


def _merge_pinned_turns(
    generated: list[PinnedTurnUpsert], derived: list[PinnedTurnUpsert]
) -> list[PinnedTurnUpsert]:
    merged = list(generated)
    seen = {(pin.turn_index, pin.kind, pin.summary.lower()) for pin in generated}
    for pin in derived:
        key = (pin.turn_index, pin.kind, pin.summary.lower())
        if key in seen:
            continue
        seen.add(key)
        merged.append(pin)
    return merged


def empty_task_journal(conversation_id: str, repo: str | None = None) -> TaskJournal:
    return TaskJournal(
        conversation_id=conversation_id,
        objective="",
        repo=repo,
        status="planning",
        files_inspected=[],
        files_changed=[],
        generated_code_artifacts=[],
        key_decisions=[],
        open_questions=[],
        known_errors=[],
        next_steps=[],
        updated_at="",
    )


def normalize_task_journal(
    conversation_id: str,
    repo: str | None,
    raw: dict[str, Any] | None,
    existing: TaskJournal | None = None,
) -> TaskJournal:
    base = existing or empty_task_journal(conversation_id, repo=repo)
    raw = raw or {}
    def _journal_list(key: str, fallback: list[str]) -> list[str]:
        if key in raw and isinstance(raw.get(key), list):
            return _dedupe_compact_list(raw.get(key) or [], 8 if key not in {"generated_code_artifacts", "open_questions", "known_errors", "next_steps"} else 6)
        return fallback

    objective = " ".join(str(raw.get("objective") or base.objective or "").split()).strip()[:320]
    status = str(raw.get("status") or base.status or "planning").strip().lower()
    if status not in {"planning", "exploring", "implementing", "debugging", "reviewing"}:
        status = base.status or "planning"
    return TaskJournal(
        conversation_id=conversation_id,
        objective=objective,
        repo=repo or raw.get("repo") or base.repo,
        status=status,
        files_inspected=_journal_list("files_inspected", base.files_inspected),
        files_changed=_journal_list("files_changed", base.files_changed),
        generated_code_artifacts=_journal_list(
            "generated_code_artifacts", base.generated_code_artifacts
        ),
        key_decisions=_journal_list("key_decisions", base.key_decisions),
        open_questions=_journal_list("open_questions", base.open_questions),
        known_errors=_journal_list("known_errors", base.known_errors),
        next_steps=_journal_list("next_steps", base.next_steps),
        updated_at=base.updated_at,
    )


def memory_model():
    from databricks_langchain import ChatDatabricks

    return ChatDatabricks(
        endpoint=os.getenv(
            "MEMORY_MODEL_ENDPOINT",
            os.getenv("AGENT_MODEL_ENDPOINT", "databricks-gpt-5-2"),
        )
    )


def memory_runtime_config() -> dict[str, Any]:
    mode = normalize_memory_mode()
    return {
        "enabled": memory_enabled(),
        "mode": mode,
        "db_path": os.getenv("MEMORY_DB_PATH", ".local/conversation_memory.db"),
        "summary_threshold_messages": summarize_threshold_messages(mode),
        "recent_messages": recent_messages_limit(mode),
        "min_fact_confidence": min_fact_confidence(),
        "max_summary_words": max_summary_words(mode),
        "memory_model_endpoint": os.getenv(
            "MEMORY_MODEL_ENDPOINT",
            os.getenv("AGENT_MODEL_ENDPOINT", "databricks-gpt-5-2"),
        ),
    }


def item_text(item: dict[str, Any]) -> str:
    content = item.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict):
                if isinstance(part.get("text"), str):
                    parts.append(part["text"])
                elif part.get("type") == "output_text" and isinstance(part.get("text"), str):
                    parts.append(part["text"])
                elif part.get("type") == "input_text" and isinstance(part.get("text"), str):
                    parts.append(part["text"])
        if parts:
            return "\n".join(parts)
    return json.dumps(content if content is not None else item, ensure_ascii=True)


def _truncate_for_summary(text: str, limit: int | None = None) -> str:
    max_chars = limit or tool_summary_max_chars()
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n... [truncated for memory summary]"


def _compact_tool_value(value: Any) -> Any:
    if isinstance(value, str):
        if len(value) > 500:
            return {
                "omitted_chars": len(value),
                "preview": value[:240],
                "note": "large tool argument omitted from memory summary",
            }
        return value
    if isinstance(value, list):
        return [_compact_tool_value(item) for item in value[:20]]
    if isinstance(value, dict):
        compact: dict[str, Any] = {}
        for key, child in value.items():
            if key in {"content", "preview", "changes_json", "search_text", "replace_text"}:
                compact[key] = _compact_tool_value(child)
            elif isinstance(child, (dict, list)):
                compact[key] = _compact_tool_value(child)
            else:
                compact[key] = child
        return compact
    return value


def summary_safe_item_text(item: dict[str, Any]) -> str:
    role = item.get("role")
    if role == "tool":
        return _truncate_for_summary(item_text(item))

    tool_calls = item.get("tool_calls")
    if isinstance(tool_calls, list):
        compact_calls = []
        for call in tool_calls[:8]:
            if not isinstance(call, dict):
                continue
            function = call.get("function")
            arguments = function.get("arguments") if isinstance(function, dict) else None
            try:
                parsed_args = json.loads(arguments) if isinstance(arguments, str) else arguments
            except json.JSONDecodeError:
                parsed_args = arguments
            compact_calls.append(
                {
                    "id": call.get("id"),
                    "type": call.get("type"),
                    "name": function.get("name") if isinstance(function, dict) else None,
                    "arguments": _compact_tool_value(parsed_args),
                }
            )
        return json.dumps({"assistant_tool_calls": compact_calls}, ensure_ascii=True)

    return _truncate_for_summary(item_text(item), 4000)


def _extract_assistant_text(item: dict[str, Any]) -> str | None:
    text = item_text(item).strip()
    if not text or text == "tool call":
        return None
    return text


def model_safe_item(item: dict[str, Any]) -> dict[str, Any] | None:
    role = item.get("role")
    if role not in {"system", "user", "assistant"}:
        return None

    if role == "tool":
        return None

    if role == "assistant":
        # Do not replay raw tool protocol messages back into the chat-completions
        # model. OpenAI-compatible providers require strict assistant/tool ordering,
        # and persisted tool-call history can violate that ordering across turns.
        if item.get("tool_calls"):
            text = _extract_assistant_text(item)
            if not text:
                return None
            return {"role": "assistant", "content": text}

        text = _extract_assistant_text(item)
        if text is not None:
            return {"role": "assistant", "content": text}

    return item


def render_messages(messages: list[StoredMessage]) -> str:
    rendered: list[str] = []
    for msg in messages:
        item = json.loads(msg.content_json)
        rendered.append(f"[{msg.turn_index}] {msg.role}: {summary_safe_item_text(item)}")
    return "\n\n".join(rendered)


def _render_task_journal(journal: TaskJournal | None) -> str | None:
    if journal is None:
        return None

    sections: list[str] = []
    if journal.objective:
        sections.append(f"Objective: {journal.objective}")
    if journal.repo:
        sections.append(f"Repo: {journal.repo}")
    if journal.status:
        sections.append(f"Status: {journal.status}")

    list_sections = [
        ("Files inspected", journal.files_inspected),
        ("Files changed", journal.files_changed),
        ("Generated code artifacts", journal.generated_code_artifacts),
        ("Key decisions", journal.key_decisions),
        ("Open questions", journal.open_questions),
        ("Known errors", journal.known_errors),
        ("Next steps", journal.next_steps),
    ]
    for title, values in list_sections:
        if values:
            sections.append(title + ":\n" + "\n".join(f"- {value}" for value in values))

    if not sections:
        return None
    return "Active task journal:\n" + "\n\n".join(sections)


def _render_pinned_turns(state: MemoryState) -> str | None:
    if not state.pinned_turns:
        return None
    lines = []
    for pin in state.pinned_turns[-8:]:
        detail = pin.summary.strip()
        excerpt = pin.content_excerpt.strip()
        if excerpt:
            lines.append(f"- turn {pin.turn_index} [{pin.kind}]: {detail}")
            lines.append(f"  excerpt: {excerpt}")
        else:
            lines.append(f"- turn {pin.turn_index} [{pin.kind}]: {detail}")
    return "Pinned high-value turns:\n" + "\n".join(lines)


def _recent_items_from_stored_messages(messages: list[StoredMessage]) -> list[dict[str, Any]]:
    recent_items: list[dict[str, Any]] = []
    for msg in messages:
        if msg.role == "system":
            continue
        safe_item = model_safe_item(json.loads(msg.content_json))
        if safe_item is not None:
            recent_items.append(safe_item)
    return recent_items


def _recent_text_excerpts(
    messages: list[StoredMessage],
    *,
    role: str,
    limit: int,
    max_chars: int,
) -> list[str]:
    excerpts: list[str] = []
    for message in messages:
        if message.role != role:
            continue
        item = json.loads(message.content_json)
        if role == "assistant":
            text = _extract_assistant_text(item) or ""
        else:
            text = item_text(item).strip()
        excerpt = _compact_excerpt(text, max_chars)
        if excerpt:
            excerpts.append(excerpt)
    return _dedupe_compact_list(excerpts[-limit:], limit)


def _render_compacted_recent_context(
    messages: list[StoredMessage],
    repo: str | None,
    *,
    aggressive: bool,
) -> str | None:
    if not messages:
        return None

    conversation_id = messages[-1].conversation_id
    journal, pins = _derive_structured_memory_signals(messages, conversation_id, repo)
    char_limit = compact_recent_context_chars()
    if aggressive:
        char_limit = max(900, math.floor(char_limit * 0.7))

    sections: list[str] = []
    if journal.objective:
        sections.append(f"Objective carried from compacted recent turns: {journal.objective}")
    if journal.status and journal.status != "planning":
        sections.append(f"Recent working status: {journal.status}")
    if journal.files_inspected:
        sections.append("Files or tables referenced:\n" + "\n".join(f"- {value}" for value in journal.files_inspected[:6]))
    if journal.files_changed:
        sections.append("Files changed or requested:\n" + "\n".join(f"- {value}" for value in journal.files_changed[:5]))
    if journal.generated_code_artifacts:
        sections.append(
            "Generated code or queries to preserve:\n"
            + "\n".join(f"- {value}" for value in journal.generated_code_artifacts[:5])
        )
    if journal.known_errors:
        sections.append("Errors and failures seen:\n" + "\n".join(f"- {value}" for value in journal.known_errors[:5]))

    recent_user_asks = _recent_text_excerpts(
        messages,
        role="user",
        limit=2 if aggressive else 3,
        max_chars=180 if aggressive else 220,
    )
    if recent_user_asks:
        sections.append("Recent user asks:\n" + "\n".join(f"- {value}" for value in recent_user_asks))

    recent_assistant_outputs = _recent_text_excerpts(
        messages,
        role="assistant",
        limit=2 if aggressive else 3,
        max_chars=180 if aggressive else 220,
    )
    if recent_assistant_outputs:
        sections.append(
            "Recent assistant outputs:\n"
            + "\n".join(f"- {value}" for value in recent_assistant_outputs)
        )

    code_pins = [pin for pin in pins if pin.kind == "code"][: 2 if aggressive else 3]
    if code_pins:
        rendered = []
        for pin in code_pins:
            detail = pin.summary.strip()
            excerpt = _compact_excerpt(pin.content_excerpt or "", 150 if aggressive else 210)
            if excerpt:
                rendered.append(f"- {detail}: {excerpt}")
            else:
                rendered.append(f"- {detail}")
        sections.append("Pinned code details from compacted turns:\n" + "\n".join(rendered))

    if not sections:
        return None

    block = (
        "Compacted recent working context\n\n"
        + "\n\n".join(sections)
        + "\n\nUse this only as a compressed bridge for older recent turns; prefer the remaining raw recent messages if there is any conflict."
    )
    if len(block) <= char_limit:
        return block
    return block[:char_limit].rstrip() + " ..."


def _compact_tool_memory_block(tool_memory_block: str | None) -> str | None:
    if not tool_memory_block:
        return None
    limit = compact_tool_memory_chars()
    if len(tool_memory_block) <= limit:
        return tool_memory_block
    return (
        tool_memory_block[:limit].rstrip()
        + "\n... [tool working set compacted for prompt budget]"
    )


def build_memory_block(state: MemoryState, mode: str | None = None) -> str | None:
    sections: list[str] = []
    journal_block = _render_task_journal(state.task_journal)
    if journal_block:
        sections.append(journal_block)
    pinned_block = _render_pinned_turns(state)
    if pinned_block:
        sections.append(pinned_block)
    if state.facts:
        fact_lines = [f"- {fact.kind}: {fact.content}" for fact in state.facts]
        sections.append("Active facts:\n" + "\n".join(fact_lines))
    if state.summary_text.strip() and normalize_memory_mode(mode) != "raw":
        sections.append("Rolling summary:\n" + state.summary_text.strip())
    if not sections:
        return None
    sections.append(
        "Use this memory as supporting context. If there is any conflict, prioritize the recent raw turns and the current user message."
    )
    return "Conversation memory\n\n" + "\n\n".join(sections)


def _optimized_message_parts(
    request_input: list[Any],
    state: MemoryState | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    current_items = [normalize_item(item) for item in request_input]
    system_items = [item for item in current_items if item.get("role") == "system"]
    if state is not None:
        recent_items = _recent_items_from_stored_messages(state.recent_messages)
    else:
        recent_items = []
        for item in current_items:
            if item.get("role") == "system":
                continue
            safe_item = model_safe_item(item)
            if safe_item is not None:
                recent_items.append(safe_item)
    return current_items, system_items, recent_items


def _system_context_blocks(
    state: MemoryState | None = None,
    memory_mode: str | None = None,
    user_profile_block: str | None = None,
    repo_instruction_blocks: list[str] | None = None,
    context_pack_blocks: list[str] | None = None,
    hook_instruction_blocks: list[str] | None = None,
    tool_memory_block: str | None = None,
    skill_blocks: list[str] | None = None,
    workflow_blocks: list[str] | None = None,
    response_style_block: str | None = None,
    task_scratchpad_block: str | None = None,
) -> list[tuple[str, list[str]]]:
    blocks: list[tuple[str, list[str]]] = []
    if user_profile_block:
        blocks.append(("user_profile", [user_profile_block]))
    if repo_instruction_blocks:
        blocks.append(("repo_instructions", list(repo_instruction_blocks)))
    if context_pack_blocks:
        blocks.append(("repo_context_pack", list(context_pack_blocks)))
    if hook_instruction_blocks:
        blocks.append(("runtime_hook_instructions", list(hook_instruction_blocks)))
    if skill_blocks:
        blocks.append(("skills", list(skill_blocks)))
    if workflow_blocks:
        blocks.append(("workflow_playbooks", list(workflow_blocks)))
    if response_style_block:
        blocks.append(("response_style", [response_style_block]))
    if task_scratchpad_block:
        blocks.append(("task_scratchpad", [task_scratchpad_block]))
    if tool_memory_block:
        blocks.append(("tool_memory", [tool_memory_block]))
    memory_block = build_memory_block(state, memory_mode) if state is not None else None
    if memory_block:
        blocks.append(("conversation_memory", [memory_block]))
    return blocks


def _estimate_text_tokens(text: str) -> int:
    compact = text.strip()
    if not compact:
        return 0
    return max(1, math.ceil(len(compact) / 4))


def _message_budget_text(item: dict[str, Any]) -> str:
    text = item_text(item)
    if text and text != "null":
        return text
    return json.dumps(item, ensure_ascii=True)


def _budget_entry_from_text_blocks(name: str, blocks: list[str]) -> dict[str, Any]:
    item_count = len(blocks)
    char_count = sum(len(block) for block in blocks)
    estimated_tokens = sum(_estimate_text_tokens(block) + 4 for block in blocks if block.strip())
    return {
        "name": name,
        "kind": "system_block",
        "item_count": item_count,
        "char_count": char_count,
        "estimated_tokens": estimated_tokens,
    }


def _budget_entry_from_messages(
    name: str,
    items: list[dict[str, Any]],
    source: str,
) -> dict[str, Any]:
    role_counts: dict[str, int] = {}
    char_count = 0
    estimated_tokens = 0
    for item in items:
        role = str(item.get("role") or "unknown")
        role_counts[role] = role_counts.get(role, 0) + 1
        body = _message_budget_text(item)
        char_count += len(body)
        estimated_tokens += _estimate_text_tokens(body) + 4
    return {
        "name": name,
        "kind": "message_context",
        "item_count": len(items),
        "char_count": char_count,
        "estimated_tokens": estimated_tokens,
        "source": source,
        "role_counts": role_counts,
    }


def _build_prompt_budget_from_parts(
    current_items: list[dict[str, Any]],
    system_items: list[dict[str, Any]],
    context_blocks: list[tuple[str, list[str]]],
    recent_items: list[dict[str, Any]],
    *,
    has_memory_state: bool,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    if system_items:
        entries.append(
            _budget_entry_from_messages(
                "request_system_items",
                system_items,
                source="request_input",
            )
        )
    for name, blocks in context_blocks:
        if blocks:
            entries.append(_budget_entry_from_text_blocks(name, blocks))
    if recent_items:
        entries.append(
            _budget_entry_from_messages(
                "recent_message_context",
                recent_items,
                source="memory_state_recent_messages" if has_memory_state else "request_input",
            )
        )

    optimized_role_counts: dict[str, int] = {}
    optimized_message_count = 0
    for item in system_items:
        role = str(item.get("role") or "unknown")
        optimized_role_counts[role] = optimized_role_counts.get(role, 0) + 1
        optimized_message_count += 1
    for _, blocks in context_blocks:
        optimized_role_counts["system"] = optimized_role_counts.get("system", 0) + len(blocks)
        optimized_message_count += len(blocks)
    for item in recent_items:
        role = str(item.get("role") or "unknown")
        optimized_role_counts[role] = optimized_role_counts.get(role, 0) + 1
        optimized_message_count += 1

    total_estimated_tokens = sum(entry["estimated_tokens"] for entry in entries)
    total_chars = sum(entry["char_count"] for entry in entries)
    top_entries = sorted(entries, key=lambda entry: entry["estimated_tokens"], reverse=True)[:5]

    payload = {
        "estimate_method": "chars_div_4_plus_message_overhead",
        "total_estimated_prompt_tokens": total_estimated_tokens,
        "total_char_count": total_chars,
        "optimized_message_count": optimized_message_count,
        "optimized_role_counts": optimized_role_counts,
        "entries": entries,
        "top_entries": top_entries,
        "has_memory_state": has_memory_state,
        "request_item_count": len(current_items),
    }
    if extra:
        payload.update(extra)
    return payload


def _compose_optimized_messages(
    current_items: list[dict[str, Any]],
    system_items: list[dict[str, Any]],
    context_blocks: list[tuple[str, list[str]]],
    recent_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    optimized: list[dict[str, Any]] = [item for item in system_items]
    for _, blocks in context_blocks:
        for block in blocks:
            optimized.append({"role": "system", "content": block})
    optimized.extend(recent_items)
    return optimized if optimized else current_items


def build_prompt_budget_breakdown(
    request_input: list[Any],
    state: MemoryState | None = None,
    memory_mode: str | None = None,
    user_profile_block: str | None = None,
    repo_instruction_blocks: list[str] | None = None,
    context_pack_blocks: list[str] | None = None,
    hook_instruction_blocks: list[str] | None = None,
    tool_memory_block: str | None = None,
    skill_blocks: list[str] | None = None,
    workflow_blocks: list[str] | None = None,
    response_style_block: str | None = None,
    task_scratchpad_block: str | None = None,
) -> dict[str, Any]:
    current_items, system_items, recent_items = _optimized_message_parts(
        request_input,
        state,
    )
    context_blocks = _system_context_blocks(
        state=state,
        memory_mode=memory_mode,
        user_profile_block=user_profile_block,
        repo_instruction_blocks=repo_instruction_blocks,
        context_pack_blocks=context_pack_blocks,
        hook_instruction_blocks=hook_instruction_blocks,
        tool_memory_block=tool_memory_block,
        skill_blocks=skill_blocks,
        workflow_blocks=workflow_blocks,
        response_style_block=response_style_block,
        task_scratchpad_block=task_scratchpad_block,
    )
    return _build_prompt_budget_from_parts(
        current_items,
        system_items,
        context_blocks,
        recent_items,
        has_memory_state=state is not None,
    )


def build_optimized_messages_with_budget(
    request_input: list[Any],
    state: MemoryState | None = None,
    memory_mode: str | None = None,
    user_profile_block: str | None = None,
    repo_instruction_blocks: list[str] | None = None,
    context_pack_blocks: list[str] | None = None,
    hook_instruction_blocks: list[str] | None = None,
    tool_memory_block: str | None = None,
    skill_blocks: list[str] | None = None,
    workflow_blocks: list[str] | None = None,
    response_style_block: str | None = None,
    task_scratchpad_block: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    current_items, system_items, recent_items = _optimized_message_parts(request_input, state)
    base_context_blocks = _system_context_blocks(
        state=state,
        memory_mode=memory_mode,
        user_profile_block=user_profile_block,
        repo_instruction_blocks=repo_instruction_blocks,
        context_pack_blocks=context_pack_blocks,
        hook_instruction_blocks=hook_instruction_blocks,
        tool_memory_block=tool_memory_block,
        skill_blocks=skill_blocks,
        workflow_blocks=workflow_blocks,
        response_style_block=response_style_block,
        task_scratchpad_block=task_scratchpad_block,
    )
    budget = _build_prompt_budget_from_parts(
        current_items,
        system_items,
        base_context_blocks,
        recent_items,
        has_memory_state=state is not None,
        extra={
            "compaction": {
                "applied": False,
                "soft_limit_tokens": prompt_soft_token_limit(),
                "hard_limit_tokens": prompt_hard_token_limit(),
                "target_tokens": prompt_target_token_limit(),
            }
        },
    )

    if state is None:
        return _compose_optimized_messages(current_items, system_items, base_context_blocks, recent_items), budget

    stored_recent_messages = [msg for msg in state.recent_messages if msg.role != "system"]
    if not stored_recent_messages:
        return _compose_optimized_messages(current_items, system_items, base_context_blocks, recent_items), budget

    soft_limit = prompt_soft_token_limit()
    hard_limit = prompt_hard_token_limit()
    target_tokens = prompt_target_token_limit()
    keep_recent = min(compact_recent_messages_limit(memory_mode), len(stored_recent_messages))
    min_recent = min(min_compact_recent_messages(), len(stored_recent_messages))
    if budget["total_estimated_prompt_tokens"] <= soft_limit or keep_recent >= len(stored_recent_messages):
        return _compose_optimized_messages(current_items, system_items, base_context_blocks, recent_items), budget

    def _build_compacted_candidate(
        recent_keep: int,
        *,
        aggressive: bool,
        compact_tool_memory: bool,
    ) -> tuple[list[tuple[str, list[str]]], list[dict[str, Any]], dict[str, Any]] | None:
        if recent_keep >= len(stored_recent_messages):
            return None
        dropped_messages = stored_recent_messages[:-recent_keep]
        kept_messages = stored_recent_messages[-recent_keep:]
        compacted_recent_block = _render_compacted_recent_context(
            dropped_messages,
            state.task_journal.repo if state.task_journal else None,
            aggressive=aggressive,
        )
        compacted_context_blocks = _system_context_blocks(
            state=state,
            memory_mode=memory_mode,
            user_profile_block=user_profile_block,
            repo_instruction_blocks=repo_instruction_blocks,
            context_pack_blocks=context_pack_blocks,
            hook_instruction_blocks=hook_instruction_blocks,
            tool_memory_block=(
                _compact_tool_memory_block(tool_memory_block)
                if compact_tool_memory
                else tool_memory_block
            ),
            skill_blocks=skill_blocks,
            workflow_blocks=workflow_blocks,
            response_style_block=response_style_block,
            task_scratchpad_block=task_scratchpad_block,
        )
        if compacted_recent_block:
            inserted = False
            augmented_blocks: list[tuple[str, list[str]]] = []
            for name, blocks in compacted_context_blocks:
                augmented_blocks.append((name, list(blocks)))
                if name == "conversation_memory":
                    augmented_blocks.append(
                        ("compacted_recent_context", [compacted_recent_block])
                    )
                    inserted = True
            if not inserted:
                augmented_blocks.append(("compacted_recent_context", [compacted_recent_block]))
            compacted_context_blocks = augmented_blocks

        compacted_recent_items = _recent_items_from_stored_messages(kept_messages)
        compacted_budget = _build_prompt_budget_from_parts(
            current_items,
            system_items,
            compacted_context_blocks,
            compacted_recent_items,
            has_memory_state=True,
            extra={
                "compaction": {
                    "applied": True,
                    "soft_limit_tokens": soft_limit,
                    "hard_limit_tokens": hard_limit,
                    "target_tokens": target_tokens,
                    "strategy": "hard" if aggressive else "soft",
                    "dropped_recent_messages": len(dropped_messages),
                    "kept_recent_messages": len(kept_messages),
                    "compacted_tool_memory": compact_tool_memory,
                }
            },
        )
        return compacted_context_blocks, compacted_recent_items, compacted_budget

    candidate = _build_compacted_candidate(
        keep_recent,
        aggressive=False,
        compact_tool_memory=False,
    )
    if candidate is None:
        return _compose_optimized_messages(current_items, system_items, base_context_blocks, recent_items), budget

    compacted_context_blocks, compacted_recent_items, compacted_budget = candidate
    if compacted_budget["total_estimated_prompt_tokens"] <= hard_limit:
        return (
            _compose_optimized_messages(
                current_items,
                system_items,
                compacted_context_blocks,
                compacted_recent_items,
            ),
            compacted_budget,
        )

    aggressive_keep = max(min_recent, min(keep_recent - 4, max(min_recent, len(stored_recent_messages) // 2)))
    aggressive_candidate = _build_compacted_candidate(
        aggressive_keep,
        aggressive=True,
        compact_tool_memory=True,
    )
    if aggressive_candidate is None:
        return (
            _compose_optimized_messages(
                current_items,
                system_items,
                compacted_context_blocks,
                compacted_recent_items,
            ),
            compacted_budget,
        )

    aggressive_context_blocks, aggressive_recent_items, aggressive_budget = aggressive_candidate
    selected_context_blocks = aggressive_context_blocks
    selected_recent_items = aggressive_recent_items
    selected_budget = aggressive_budget

    if (
        compacted_budget["total_estimated_prompt_tokens"] <= target_tokens
        or compacted_budget["total_estimated_prompt_tokens"]
        < aggressive_budget["total_estimated_prompt_tokens"]
    ):
        selected_context_blocks = compacted_context_blocks
        selected_recent_items = compacted_recent_items
        selected_budget = compacted_budget

    return (
        _compose_optimized_messages(
            current_items,
            system_items,
            selected_context_blocks,
            selected_recent_items,
        ),
        selected_budget,
    )


def build_optimized_messages(
    request_input: list[Any],
    state: MemoryState | None = None,
    memory_mode: str | None = None,
    user_profile_block: str | None = None,
    repo_instruction_blocks: list[str] | None = None,
    context_pack_blocks: list[str] | None = None,
    hook_instruction_blocks: list[str] | None = None,
    tool_memory_block: str | None = None,
    skill_blocks: list[str] | None = None,
    workflow_blocks: list[str] | None = None,
    response_style_block: str | None = None,
    task_scratchpad_block: str | None = None,
) -> list[dict[str, Any]]:
    optimized, _ = build_optimized_messages_with_budget(
        request_input,
        state=state,
        memory_mode=memory_mode,
        user_profile_block=user_profile_block,
        repo_instruction_blocks=repo_instruction_blocks,
        context_pack_blocks=context_pack_blocks,
        hook_instruction_blocks=hook_instruction_blocks,
        tool_memory_block=tool_memory_block,
        skill_blocks=skill_blocks,
        workflow_blocks=workflow_blocks,
        response_style_block=response_style_block,
        task_scratchpad_block=task_scratchpad_block,
    )
    return optimized


def assistant_outputs_to_items(outputs: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for output in outputs:
        item = normalize_item(output)
        if item.get("type") == "message" and "role" not in item:
            item["role"] = "assistant"
        normalized.append(item)
    return normalized


async def _invoke_text(system_prompt: str, human_prompt: str) -> str:
    from langchain_core.messages import HumanMessage, SystemMessage

    llm = memory_model()
    response = await llm.ainvoke(
        [SystemMessage(content=system_prompt), HumanMessage(content=human_prompt)]
    )
    content = response.content
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
            elif isinstance(part, str):
                parts.append(part)
        return "\n".join(parts).strip()
    return str(content).strip()


SUMMARY_SYSTEM_PROMPT = """You maintain rolling conversation memory for a coding assistant.

Update the conversation summary using the existing summary and new conversation turns.

Requirements:
- Keep only information that is useful for future turns.
- Preserve decisions, constraints, unresolved items, and important user preferences.
- Preserve generated code and technical artifacts when they may be needed later:
  filenames, function/class names, SQL/table names, config keys, CLI commands,
  model/feature names, bugs fixed, and exact snippets when short enough to matter.
- If code was proposed but not written to disk, summarize what it did and where the user expected it to go.
- If code was written or approved, record the target file path and the key implementation details.
- Remove repetition and casual chatter.
- Prefer concrete technical state over narrative detail.
- Keep the result under {max_summary_words} words.
- Use plain factual prose.
- Do not invent facts.
- If newer turns contradict older summary content, keep the newer truth.

Return only the updated summary text."""


WORKING_SET_SYSTEM_PROMPT = """You maintain the active working set for a coding assistant.

Your job is to update:
- the structured task journal for the current coding thread
- durable conversation facts worth keeping beyond the current turn
- pinned high-value turns that should stay easy to recover later

Rules:
- Prefer concrete technical state over narrative summary.
- Keep lists short, deduplicated, and current.
- Preserve filenames, function/class names, configs, commands, model names, errors, and implementation decisions.
- Pin only high-value turns: generated code, key decisions, important constraints, debugging discoveries, or plans worth reusing later.
- Do not pin routine chatter or ordinary file reads.
- For durable facts, only store information likely to matter later beyond this exact moment.
- If a new fact replaces an older one, mark the older one as superseded.

Return valid JSON with this shape:
{
  "task_journal": {
    "objective": "string",
    "status": "planning | exploring | implementing | debugging | reviewing",
    "files_inspected": ["string"],
    "files_changed": ["string"],
    "generated_code_artifacts": ["string"],
    "key_decisions": ["string"],
    "open_questions": ["string"],
    "known_errors": ["string"],
    "next_steps": ["string"]
  },
  "facts": {
    "upserts": [
      {
        "kind": "preference | constraint | decision | task | project_context",
        "content": "string",
        "status": "active | resolved",
        "confidence": 0.0,
        "source_turn_start": 0,
        "source_turn_end": 0
      }
    ],
    "status_changes": [
      {
        "match_content": "existing fact content to update",
        "new_status": "superseded | resolved"
      }
    ]
  },
  "pins": [
    {
      "turn_index": 0,
      "kind": "code | decision | error | constraint | plan",
      "summary": "string",
      "content_excerpt": "string"
    }
  ]
}"""


def _extract_json_block(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if "```" in candidate:
        for block in candidate.split("```"):
            block = block.strip()
            if block.startswith("json"):
                block = block[4:].strip()
            if block.startswith("{") and block.endswith("}"):
                candidate = block
                break
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in extractor output")
    return json.loads(candidate[start : end + 1])


async def maybe_refresh_memory(
    conversation_id: str,
    mode: str | None = None,
    repo: str | None = None,
) -> None:
    if not memory_enabled():
        return

    effective_mode = normalize_memory_mode(mode)
    store = get_memory_store()
    keep_recent = recent_messages_limit(effective_mode)
    unsummarized_messages = store.load_unsummarized_messages(
        conversation_id, keep_recent_messages=keep_recent
    )
    state = store.load_memory_state(conversation_id, recent_messages_limit=keep_recent)
    working_set_messages = unsummarized_messages or state.recent_messages[
        -working_set_fallback_messages(effective_mode) :
    ]
    if not working_set_messages:
        return
    working_set_text = render_messages(working_set_messages)

    summary_text = state.summary_text
    summarized_through_turn = state.summarized_through_turn

    try:
        if len(unsummarized_messages) >= summarize_threshold_messages(effective_mode):
            summary_text = await _invoke_text(
                SUMMARY_SYSTEM_PROMPT.format(max_summary_words=max_summary_words(effective_mode)),
                (
                    f"Existing summary:\n{state.summary_text or '[none]'}\n\n"
                    f"New turns:\n{render_messages(unsummarized_messages)}\n"
                ),
            )
            summarized_through_turn = unsummarized_messages[-1].turn_index

        working_set_payload = await _invoke_text(
            WORKING_SET_SYSTEM_PROMPT,
            (
                f"Existing task journal:\n"
                f"{json.dumps(asdict(state.task_journal) if state.task_journal else asdict(empty_task_journal(conversation_id, repo=repo)), ensure_ascii=True)}\n\n"
                f"Existing active facts:\n{json.dumps([asdict(fact) for fact in state.facts], ensure_ascii=True)}\n\n"
                f"Existing pinned turns:\n{json.dumps([asdict(pin) for pin in state.pinned_turns], ensure_ascii=True)}\n\n"
                f"New turns:\n{working_set_text}\n"
            ),
        )
    except Exception:
        logger.exception(
            "Memory refresh skipped because the summarization model was unavailable."
        )
        return

    parsed = _extract_json_block(working_set_payload)
    facts_section = parsed.get("facts", {}) if isinstance(parsed, dict) else {}
    journal_section = parsed.get("task_journal", {}) if isinstance(parsed, dict) else {}

    task_journal = normalize_task_journal(
        conversation_id=conversation_id,
        repo=repo,
        raw=journal_section if isinstance(journal_section, dict) else {},
        existing=state.task_journal,
    )
    derived_journal, derived_pins = _derive_structured_memory_signals(
        working_set_messages,
        conversation_id=conversation_id,
        repo=repo,
    )
    task_journal = _merge_task_journal(task_journal, derived_journal)

    fact_upserts: list[FactUpsert] = []
    for raw in facts_section.get("upserts", []):
        if not isinstance(raw, dict):
            continue
        confidence = float(raw.get("confidence", 0.0))
        if confidence < min_fact_confidence():
            continue
        content = str(raw.get("content", "")).strip()
        kind = str(raw.get("kind", "")).strip()
        status = str(raw.get("status", "active")).strip() or "active"
        if not content or not kind:
            continue
        fact_upserts.append(
            FactUpsert(
                kind=kind,
                content=content,
                status=status,
                confidence=confidence,
                source_turn_start=int(raw.get("source_turn_start", unsummarized_messages[0].turn_index)),
                source_turn_end=int(raw.get("source_turn_end", unsummarized_messages[-1].turn_index)),
            )
        )

    fact_status_changes: list[FactStatusChange] = []
    for raw in facts_section.get("status_changes", []):
        if not isinstance(raw, dict):
            continue
        match_content = str(raw.get("match_content", "")).strip()
        new_status = str(raw.get("new_status", "")).strip()
        if match_content and new_status:
            fact_status_changes.append(
                FactStatusChange(match_content=match_content, new_status=new_status)
            )

    pinned_turn_upserts: list[PinnedTurnUpsert] = []
    first_turn = working_set_messages[0].turn_index
    last_turn = working_set_messages[-1].turn_index
    allowed_pin_kinds = {"code", "decision", "error", "constraint", "plan"}
    for raw in parsed.get("pins", []):
        if not isinstance(raw, dict):
            continue
        try:
            turn_index = int(raw.get("turn_index", 0))
        except (TypeError, ValueError):
            continue
        if turn_index < first_turn or turn_index > last_turn:
            continue
        kind = str(raw.get("kind", "")).strip().lower()
        if kind not in allowed_pin_kinds:
            continue
        summary = " ".join(str(raw.get("summary", "")).split()).strip()
        excerpt = " ".join(str(raw.get("content_excerpt", "")).split()).strip()
        if not summary:
            continue
        pinned_turn_upserts.append(
            PinnedTurnUpsert(
                turn_index=turn_index,
                kind=kind,
                summary=summary[:280],
                content_excerpt=excerpt[:380],
            )
        )
    pinned_turn_upserts = _merge_pinned_turns(pinned_turn_upserts, derived_pins)

    payload = MemoryUpdatePayload(
        summary_text=summary_text,
        summarized_through_turn=summarized_through_turn,
        fact_upserts=fact_upserts,
        fact_status_changes=fact_status_changes,
        task_journal=task_journal,
        pinned_turn_upserts=pinned_turn_upserts,
    )
    store.apply_memory_update(conversation_id, payload)
