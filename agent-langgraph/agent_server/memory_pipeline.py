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
)
from agent_server.memory_models import StoredMessage
from agent_server.memory_store import get_memory_store, normalize_item

logger = logging.getLogger(__name__)

DEFAULT_THRESHOLD_MESSAGES = 10
DEFAULT_RECENT_MESSAGES = 8
DEFAULT_MIN_FACT_CONFIDENCE = 0.65
DEFAULT_MAX_SUMMARY_WORDS = 450


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


def recent_messages_limit() -> int:
    return _env_int("MEMORY_RECENT_MESSAGES", DEFAULT_RECENT_MESSAGES)


def summarize_threshold_messages() -> int:
    return _env_int("MEMORY_SUMMARY_THRESHOLD_MESSAGES", DEFAULT_THRESHOLD_MESSAGES)


def min_fact_confidence() -> float:
    return _env_float("MEMORY_MIN_FACT_CONFIDENCE", DEFAULT_MIN_FACT_CONFIDENCE)


def memory_model():
    from databricks_langchain import ChatDatabricks

    return ChatDatabricks(
        endpoint=os.getenv(
            "MEMORY_MODEL_ENDPOINT",
            os.getenv("AGENT_MODEL_ENDPOINT", "databricks-gpt-5-2"),
        )
    )


def memory_runtime_config() -> dict[str, Any]:
    return {
        "enabled": memory_enabled(),
        "db_path": os.getenv("MEMORY_DB_PATH", ".local/conversation_memory.db"),
        "summary_threshold_messages": summarize_threshold_messages(),
        "recent_messages": recent_messages_limit(),
        "min_fact_confidence": min_fact_confidence(),
        "max_summary_words": _env_int("MEMORY_MAX_SUMMARY_WORDS", DEFAULT_MAX_SUMMARY_WORDS),
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
        rendered.append(f"[{msg.turn_index}] {msg.role}: {item_text(item)}")
    return "\n\n".join(rendered)


def build_memory_block(state: MemoryState) -> str | None:
    sections: list[str] = []
    if state.facts:
        fact_lines = [f"- {fact.kind}: {fact.content}" for fact in state.facts]
        sections.append("Active facts:\n" + "\n".join(fact_lines))
    if state.summary_text.strip():
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
    user_profile_block: str | None = None,
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
    memory_block = build_memory_block(state) if state is not None else None
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
- Remove repetition and casual chatter.
- Prefer concrete technical state over narrative detail.
- Keep the result under {max_summary_words} words.
- Use plain factual prose.
- Do not invent facts.
- If newer turns contradict older summary content, keep the newer truth.

Return only the updated summary text."""


FACT_SYSTEM_PROMPT = """You extract durable conversation memory for a coding assistant.

From the new conversation turns, identify durable facts worth storing for future turns.

Store only information that is likely to matter later:
- user preferences
- constraints
- decisions
- tasks
- important project context

Do not store:
- small talk
- transient phrasing
- information already captured unless it changed
- speculation unless it is clearly marked uncertain

Return valid JSON with this shape:
{
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


async def maybe_refresh_memory(conversation_id: str) -> None:
    if not memory_enabled():
        return

    store = get_memory_store()
    keep_recent = recent_messages_limit()
    unsummarized_messages = store.load_unsummarized_messages(conversation_id, keep_recent_messages=keep_recent)
    if len(unsummarized_messages) < summarize_threshold_messages():
        return

    state = store.load_memory_state(conversation_id, recent_messages_limit=keep_recent)
    message_text = render_messages(unsummarized_messages)
    max_words = _env_int("MEMORY_MAX_SUMMARY_WORDS", DEFAULT_MAX_SUMMARY_WORDS)

    try:
        summary_text = await _invoke_text(
            SUMMARY_SYSTEM_PROMPT.format(max_summary_words=max_words),
            (
                f"Existing summary:\n{state.summary_text or '[none]'}\n\n"
                f"New turns:\n{message_text}\n"
            ),
        )

        facts_payload = await _invoke_text(
            FACT_SYSTEM_PROMPT,
            (
                f"Existing active facts:\n{json.dumps([asdict(fact) for fact in state.facts], ensure_ascii=True)}\n\n"
                f"New turns:\n{message_text}\n"
            ),
        )
    except Exception:
        logger.exception(
            "Memory refresh skipped because the summarization model was unavailable."
        )
        return

    parsed = _extract_json_block(facts_payload)
    fact_upserts: list[FactUpsert] = []
    for raw in parsed.get("upserts", []):
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
    for raw in parsed.get("status_changes", []):
        if not isinstance(raw, dict):
            continue
        match_content = str(raw.get("match_content", "")).strip()
        new_status = str(raw.get("new_status", "")).strip()
        if match_content and new_status:
            fact_status_changes.append(
                FactStatusChange(match_content=match_content, new_status=new_status)
            )

    payload = MemoryUpdatePayload(
        summary_text=summary_text,
        summarized_through_turn=unsummarized_messages[-1].turn_index,
        fact_upserts=fact_upserts,
        fact_status_changes=fact_status_changes,
    )
    store.apply_memory_update(conversation_id, payload)
