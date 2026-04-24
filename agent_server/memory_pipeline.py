from __future__ import annotations

import json
import logging
import os
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

logger = logging.getLogger(__name__)

DEFAULT_THRESHOLD_MESSAGES = 10
DEFAULT_RECENT_MESSAGES = 12
DEFAULT_WORK_THRESHOLD_MESSAGES = 12
DEFAULT_WORK_RECENT_MESSAGES = 60
DEFAULT_RAW_THRESHOLD_MESSAGES = 20
DEFAULT_RAW_RECENT_MESSAGES = 140
DEFAULT_MIN_FACT_CONFIDENCE = 0.65
DEFAULT_MAX_SUMMARY_WORDS = 450
DEFAULT_WORK_MAX_SUMMARY_WORDS = 1000
DEFAULT_RAW_MAX_SUMMARY_WORDS = 1600
DEFAULT_MEMORY_MODE = "work"
DEFAULT_TOOL_SUMMARY_MAX_CHARS = 1200


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
        if pin.content_excerpt.strip():
            detail += f" | {pin.content_excerpt.strip()}"
        lines.append(f"- turn {pin.turn_index} [{pin.kind}]: {detail}")
    return "Pinned high-value turns:\n" + "\n".join(lines)


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


def build_optimized_messages(
    request_input: list[Any],
    state: MemoryState | None = None,
    memory_mode: str | None = None,
    user_profile_block: str | None = None,
    repo_instruction_blocks: list[str] | None = None,
    hook_instruction_blocks: list[str] | None = None,
    tool_memory_block: str | None = None,
    skill_blocks: list[str] | None = None,
    workflow_blocks: list[str] | None = None,
    task_scratchpad_block: str | None = None,
) -> list[dict[str, Any]]:
    current_items = [normalize_item(item) for item in request_input]
    system_items = [item for item in current_items if item.get("role") == "system"]
    if state is not None:
        recent_items = []
        for msg in state.recent_messages:
            if msg.role == "system":
                continue
            safe_item = model_safe_item(json.loads(msg.content_json))
            if safe_item is not None:
                recent_items.append(safe_item)
    else:
        recent_items = []
        for item in current_items:
            if item.get("role") == "system":
                continue
            safe_item = model_safe_item(item)
            if safe_item is not None:
                recent_items.append(safe_item)

    optimized: list[dict[str, Any]] = [item for item in system_items]
    if user_profile_block:
        optimized.append({"role": "system", "content": user_profile_block})
    if repo_instruction_blocks:
        for block in repo_instruction_blocks:
            optimized.append({"role": "system", "content": block})
    if hook_instruction_blocks:
        for block in hook_instruction_blocks:
            optimized.append({"role": "system", "content": block})
    if skill_blocks:
        for skill_block in skill_blocks:
            optimized.append({"role": "system", "content": skill_block})
    if workflow_blocks:
        for workflow_block in workflow_blocks:
            optimized.append({"role": "system", "content": workflow_block})
    if task_scratchpad_block:
        optimized.append({"role": "system", "content": task_scratchpad_block})
    if tool_memory_block:
        optimized.append({"role": "system", "content": tool_memory_block})
    memory_block = build_memory_block(state, memory_mode) if state is not None else None
    if memory_block:
        optimized.append({"role": "system", "content": memory_block})
    optimized.extend(recent_items)
    return optimized if optimized else current_items


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
    unsummarized_messages = store.load_unsummarized_messages(conversation_id, keep_recent_messages=keep_recent)
    state = store.load_memory_state(conversation_id, recent_messages_limit=keep_recent)
    working_set_messages = unsummarized_messages or state.recent_messages[-12:]
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

    payload = MemoryUpdatePayload(
        summary_text=summary_text,
        summarized_through_turn=summarized_through_turn,
        fact_upserts=fact_upserts,
        fact_status_changes=fact_status_changes,
        task_journal=task_journal,
        pinned_turn_upserts=pinned_turn_upserts,
    )
    store.apply_memory_update(conversation_id, payload)
