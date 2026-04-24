from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import tool
from mlflow.genai.agent_server import get_request_headers

from agent_server.memory_store import get_memory_store


def _conversation_id() -> str | None:
    headers = get_request_headers()
    return (
        headers.get("x-databricks-conversation-id")
        or headers.get("x-codex-conversation-id")
        or None
    )


def _item_text(item: dict[str, Any]) -> str:
    content = item.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if isinstance(text, str):
                parts.append(text)
        if parts:
            return "\n".join(parts)
    return json.dumps(item, ensure_ascii=True)


def _excerpt(text: str, limit: int = 800) -> str:
    compact = " ".join(text.split()).strip()
    if len(compact) <= limit:
        return compact
    return compact[:limit] + " ... [truncated]"


@tool
def search_chat_history(query: str, limit: int = 8) -> str:
    """Search earlier turns in the current chat by keyword so you can recover prior code, errors, or decisions."""
    conversation_id = _conversation_id()
    if not conversation_id:
        return "Chat history search is unavailable because this request has no conversation id."

    needle = query.strip()
    if not needle:
        return "Provide a non-empty query."

    results = get_memory_store().search_messages(conversation_id, needle, limit=limit)
    if not results:
        return "No matching chat history turns found."

    lines: list[str] = []
    for message in results:
        item = json.loads(message.content_json)
        lines.append(
            f"[turn {message.turn_index}] {message.role}: {_excerpt(_item_text(item), 360)}"
        )
    return "\n".join(lines)


@tool
def read_chat_turn(turn_index: int) -> str:
    """Read a specific prior turn from the current chat by turn index."""
    conversation_id = _conversation_id()
    if not conversation_id:
        return "Chat turn lookup is unavailable because this request has no conversation id."

    message = get_memory_store().get_message_by_turn_index(conversation_id, int(turn_index))
    if message is None:
        return f"No chat turn found for turn_index={turn_index}."

    item = json.loads(message.content_json)
    text = _item_text(item)
    return f"[turn {message.turn_index}] {message.role}\n{_excerpt(text, 2400)}"


CHAT_HISTORY_TOOLS = [search_chat_history, read_chat_turn]
