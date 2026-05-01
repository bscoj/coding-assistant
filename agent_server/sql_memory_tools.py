from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from langchain_core.tools import tool
from mlflow.genai.agent_server import get_request_headers

from agent_server.analytics_context_tools import sync_validated_pattern_into_analytics_context
from agent_server.filesystem_tools import (
    workspace_root,
    workspace_selected,
    workspace_selection_error,
)
from agent_server.memory_store import get_memory_store
from agent_server.sql_memory_store import (
    extract_filter_candidates,
    extract_group_by_columns,
    extract_metric_candidates,
    extract_tables,
    get_sql_store,
)

SQL_CODE_BLOCK_PATTERN = re.compile(
    r"```(?P<lang>[A-Za-z0-9_+-]*)\n(?P<code>.*?)(?:```|$)",
    re.S,
)


def _resolve_repo_path(path: str) -> Path:
    candidate = Path(path)
    root = workspace_root().resolve()
    if not candidate.is_absolute():
        candidate = (root / candidate).resolve()
    else:
        candidate = candidate.resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"Path {candidate} is outside workspace root {root}")
    return candidate


def _split_csv(values_csv: str) -> list[str]:
    return [value.strip() for value in values_csv.split(",") if value.strip()]


def _split_tags(tags_csv: str) -> list[str]:
    return _split_csv(tags_csv)


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


def _extract_sql_candidates(text: str) -> list[str]:
    candidates: list[str] = []
    for match in SQL_CODE_BLOCK_PATTERN.finditer(text):
        language = (match.group("lang") or "").strip().lower()
        code = (match.group("code") or "").strip()
        if not code:
            continue
        lowered = code.lower()
        if language == "sql" or ("select" in lowered and "from" in lowered):
            candidates.append(code)
    if candidates:
        return candidates

    compact = text.strip()
    lowered = compact.lower()
    if "select" in lowered and "from" in lowered and len(compact) >= 40:
        return [compact]
    return []


def _search_response(query: str, results: list[dict]) -> str:
    payload = {
        "query": query,
        "results": results,
        "guidance": "Search results are summaries only. Use get_validated_sql_pattern(id) only for the best 1-2 candidates when you need the full SQL text.",
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


def _workspace_root_or_error() -> str | None:
    if not workspace_selected():
        return workspace_selection_error()
    return None


def _save_sql_pattern_payload(
    *,
    name: str,
    summary: str,
    sql_text: str,
    validation_notes: str,
    dialect: str,
    tags_csv: str,
    business_question: str = "",
    grain: str = "",
    semantic_notes: str = "",
    dimensions_csv: str = "",
    metrics_csv: str = "",
    filters_csv: str = "",
    business_terms_csv: str = "",
    source_path: str | None = None,
) -> str:
    payload = get_sql_store().save_pattern(
        workspace_root=str(workspace_root()),
        name=name.strip() or "Validated SQL pattern",
        summary=summary.strip(),
        sql_text=sql_text.strip(),
        dialect=dialect.strip() or "spark_sql",
        source_path=source_path,
        validation_notes=validation_notes.strip(),
        tags=_split_tags(tags_csv),
        business_question=business_question.strip(),
        grain=grain.strip(),
        semantic_notes=semantic_notes.strip(),
        dimensions=_split_csv(dimensions_csv),
        metrics=_split_csv(metrics_csv),
        filters=_split_csv(filters_csv),
        business_terms=_split_csv(business_terms_csv),
    )
    sync_validated_pattern_into_analytics_context(payload)
    return json.dumps(
        {
            "saved": get_sql_store().summarize_pattern(payload),
            "guidance": "Use get_validated_sql_pattern(id) later if you need the full SQL text.",
        },
        indent=2,
        ensure_ascii=True,
    )


@tool
def prepare_sql_knowledge_capture(
    sql_text: str,
    business_question: str = "",
    grain: str = "",
    dimensions_csv: str = "",
    metrics_csv: str = "",
    filters_csv: str = "",
    business_terms_csv: str = "",
    semantic_notes: str = "",
) -> str:
    """Analyze a SQL example before saving it so you can identify missing business context and the follow-up questions needed to turn it into durable SQL knowledge."""
    if error := _workspace_root_or_error():
        return error
    normalized_sql = sql_text.strip()
    if not normalized_sql:
        return "Provide non-empty SQL text."

    inferred_tables = extract_tables(normalized_sql)
    inferred_dimensions = extract_group_by_columns(normalized_sql)
    inferred_metrics = extract_metric_candidates(normalized_sql)
    inferred_filter_candidates = extract_filter_candidates(normalized_sql)
    inferred_filters = [candidate["suggested_filter_sql"] for candidate in inferred_filter_candidates]
    inferred_terms: list[str] = []
    for candidate in inferred_filter_candidates:
        inferred_terms.extend(candidate["alias_suggestions"])

    provided_dimensions = _split_csv(dimensions_csv)
    provided_metrics = _split_csv(metrics_csv)
    provided_filters = _split_csv(filters_csv)
    provided_terms = _split_csv(business_terms_csv)

    missing_context: list[str] = []
    follow_up_questions: list[str] = []
    if not business_question.strip():
        missing_context.append("business_question")
        follow_up_questions.append(
            "What business question or recurring analysis does this query answer?"
        )
    if not grain.strip():
        missing_context.append("grain")
        follow_up_questions.append(
            "What is the intended output grain, such as one row per claim, member, facility, or month?"
        )
    if not provided_metrics and not inferred_metrics:
        missing_context.append("metrics")
        follow_up_questions.append(
            "Which metric or KPI should this query be remembered for?"
        )
    if not provided_dimensions and not inferred_dimensions:
        missing_context.append("dimensions")
        follow_up_questions.append(
            "Which dimensions or breakdown columns matter when reusing this query?"
        )
    if not provided_filters and inferred_filters:
        missing_context.append("filters")
        follow_up_questions.append(
            "Which filters here are durable business logic rather than one-off query parameters?"
        )
    if not provided_terms and inferred_terms:
        missing_context.append("business_terms")
        follow_up_questions.append(
            "What business words, abbreviations, or aliases should map to this query pattern?"
        )
    if not semantic_notes.strip():
        follow_up_questions.append(
            "Are there any grain, fanout, exclusion, or semantic caveats future queries should preserve?"
        )

    payload = {
        "business_question": business_question.strip(),
        "grain": grain.strip(),
        "provided_dimensions": provided_dimensions,
        "provided_metrics": provided_metrics,
        "provided_filters": provided_filters,
        "provided_business_terms": provided_terms,
        "semantic_notes": semantic_notes.strip(),
        "inferred_tables": inferred_tables,
        "inferred_dimensions": inferred_dimensions,
        "inferred_metrics": inferred_metrics,
        "inferred_filters": inferred_filters,
        "inferred_business_terms": sorted(set(inferred_terms))[:10],
        "missing_context": missing_context,
        "follow_up_questions": follow_up_questions,
        "ready_to_save": len(missing_context) == 0,
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def validated_sql_store_overview(limit: int = 10) -> str:
    """Show the current repo's validated SQL memory, including common tables, join patterns, and recent trusted queries."""
    if error := _workspace_root_or_error():
        return error
    payload = get_sql_store().overview(str(workspace_root()), limit=max(1, min(limit, 20)))
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def search_validated_sql_patterns(query: str, limit: int = 4) -> str:
    """Search validated SQL patterns for the current repo by business term, table, join, filter, or metric keyword. Returns lightweight summaries, not full SQL text."""
    if error := _workspace_root_or_error():
        return error
    needle = query.strip()
    if not needle:
        return "Provide a non-empty query."
    return _search_response(
        needle,
        get_sql_store().search_patterns(
            str(workspace_root()),
            needle,
            limit=max(1, min(limit, 10)),
        ),
    )


@tool
def search_validated_sql_by_table_or_join(query: str, limit: int = 4) -> str:
    """Find validated SQL patterns by table name, alias, or join clue so you can quickly reuse known-good data combinations. Returns lightweight summaries, not full SQL text."""
    if error := _workspace_root_or_error():
        return error
    needle = query.strip()
    if not needle:
        return "Provide a non-empty table or join query."
    return _search_response(
        needle,
        get_sql_store().search_by_table_or_join(
            str(workspace_root()),
            needle,
            limit=max(1, min(limit, 10)),
        ),
    )


@tool
def get_validated_sql_pattern(pattern_id: str) -> str:
    """Read one validated SQL pattern in full, including the saved SQL text, tables, joins, and notes."""
    if error := _workspace_root_or_error():
        return error
    try:
        payload = get_sql_store().get_pattern(pattern_id.strip(), str(workspace_root()))
    except KeyError:
        return f"No validated SQL pattern found for id={pattern_id!r}."
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def save_validated_sql_from_chat_turn(
    turn_index: int,
    summary: str,
    name: str = "",
    validation_notes: str = "",
    dialect: str = "spark_sql",
    tags_csv: str = "",
    business_question: str = "",
    grain: str = "",
    semantic_notes: str = "",
    dimensions_csv: str = "",
    metrics_csv: str = "",
    filters_csv: str = "",
    business_terms_csv: str = "",
    block_index: int = 1,
) -> str:
    """Save a SQL query from a specific chat turn without repeating the full SQL in the tool arguments."""
    if error := _workspace_root_or_error():
        return error
    conversation_id = _conversation_id()
    if not conversation_id:
        return "Chat-based SQL save is unavailable because this request has no conversation id."

    message = get_memory_store().get_message_by_turn_index(conversation_id, int(turn_index))
    if message is None:
        return f"No chat turn found for turn_index={turn_index}."

    item = json.loads(message.content_json)
    sql_candidates = _extract_sql_candidates(_item_text(item))
    if not sql_candidates:
        return f"No SQL query found in chat turn {turn_index}."

    selected_index = max(1, int(block_index)) - 1
    if selected_index >= len(sql_candidates):
        return (
            f"Chat turn {turn_index} has only {len(sql_candidates)} SQL block(s). "
            f"Use block_index between 1 and {len(sql_candidates)}."
        )

    result = _save_sql_pattern_payload(
        name=name,
        summary=summary,
        sql_text=sql_candidates[selected_index],
        validation_notes=validation_notes,
        dialect=dialect,
        tags_csv=tags_csv,
        business_question=business_question,
        grain=grain,
        semantic_notes=semantic_notes,
        dimensions_csv=dimensions_csv,
        metrics_csv=metrics_csv,
        filters_csv=filters_csv,
        business_terms_csv=business_terms_csv,
        source_path=f"chat_turn:{turn_index}",
    )
    payload = json.loads(result)
    payload["source_turn_index"] = int(turn_index)
    payload["source_role"] = message.role
    payload["saved_from"] = "chat_turn"
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def save_latest_assistant_sql_pattern(
    summary: str,
    name: str = "",
    validation_notes: str = "",
    dialect: str = "spark_sql",
    tags_csv: str = "",
    business_question: str = "",
    grain: str = "",
    semantic_notes: str = "",
    dimensions_csv: str = "",
    metrics_csv: str = "",
    filters_csv: str = "",
    business_terms_csv: str = "",
    search_hint: str = "",
    lookback_turns: int = 12,
) -> str:
    """Save the most recent assistant SQL query from this chat without repeating the full SQL in the tool arguments."""
    if error := _workspace_root_or_error():
        return error
    conversation_id = _conversation_id()
    if not conversation_id:
        return "Chat-based SQL save is unavailable because this request has no conversation id."

    store = get_memory_store()
    latest_turn = store.latest_turn_index(conversation_id)
    hint = search_hint.strip().lower()
    start_turn = max(1, latest_turn - max(1, min(int(lookback_turns), 40)) + 1)

    for turn_index in range(latest_turn, start_turn - 1, -1):
        message = store.get_message_by_turn_index(conversation_id, turn_index)
        if message is None or message.role != "assistant":
            continue
        item = json.loads(message.content_json)
        text = _item_text(item)
        if hint and hint not in text.lower():
            continue
        sql_candidates = _extract_sql_candidates(text)
        if not sql_candidates:
            continue
        result = _save_sql_pattern_payload(
            name=name,
            summary=summary,
            sql_text=sql_candidates[0],
            validation_notes=validation_notes,
            dialect=dialect,
            tags_csv=tags_csv,
            business_question=business_question,
            grain=grain,
            semantic_notes=semantic_notes,
            dimensions_csv=dimensions_csv,
            metrics_csv=metrics_csv,
            filters_csv=filters_csv,
            business_terms_csv=business_terms_csv,
            source_path=f"chat_turn:{turn_index}",
        )
        payload = json.loads(result)
        payload["source_turn_index"] = turn_index
        payload["source_role"] = message.role
        payload["saved_from"] = "latest_assistant_chat_sql"
        return json.dumps(payload, indent=2, ensure_ascii=True)

    if hint:
        return f"No recent assistant SQL query matched search_hint={search_hint!r}."
    return "No recent assistant SQL query was found in this chat."


@tool
def save_validated_sql_pattern(
    name: str,
    sql_text: str,
    summary: str,
    validation_notes: str = "",
    business_question: str = "",
    grain: str = "",
    semantic_notes: str = "",
    dimensions_csv: str = "",
    metrics_csv: str = "",
    filters_csv: str = "",
    business_terms_csv: str = "",
    source_path: str = "",
    dialect: str = "spark_sql",
    tags_csv: str = "",
) -> str:
    """Save a known-good SQL query for the current repo so future SQL tasks can reuse its tables and joins. Returns a compact summary to avoid echoing the full SQL back into context."""
    if error := _workspace_root_or_error():
        return error
    trimmed_sql = sql_text.strip()
    if not trimmed_sql:
        return "Provide non-empty SQL text."
    return _save_sql_pattern_payload(
        name=name,
        summary=summary,
        sql_text=trimmed_sql,
        validation_notes=validation_notes,
        dialect=dialect,
        tags_csv=tags_csv,
        business_question=business_question,
        grain=grain,
        semantic_notes=semantic_notes,
        dimensions_csv=dimensions_csv,
        metrics_csv=metrics_csv,
        filters_csv=filters_csv,
        business_terms_csv=business_terms_csv,
        source_path=source_path.strip() or None,
    )


@tool
def save_validated_sql_file(
    path: str,
    summary: str,
    name: str = "",
    validation_notes: str = "",
    business_question: str = "",
    grain: str = "",
    semantic_notes: str = "",
    dimensions_csv: str = "",
    metrics_csv: str = "",
    filters_csv: str = "",
    business_terms_csv: str = "",
    dialect: str = "spark_sql",
    tags_csv: str = "",
) -> str:
    """Save a SQL file from the current repo into validated SQL memory so its tables and joins become easy to reuse later. Returns a compact summary to avoid echoing the full SQL back into context."""
    if error := _workspace_root_or_error():
        return error
    target = _resolve_repo_path(path)
    if not target.exists():
        return f"No file found at {path!r}."
    sql_text = target.read_text(encoding="utf-8")
    return _save_sql_pattern_payload(
        name=name.strip() or target.stem,
        summary=summary,
        sql_text=sql_text,
        validation_notes=validation_notes,
        dialect=dialect,
        tags_csv=tags_csv,
        business_question=business_question,
        grain=grain,
        semantic_notes=semantic_notes,
        dimensions_csv=dimensions_csv,
        metrics_csv=metrics_csv,
        filters_csv=filters_csv,
        business_terms_csv=business_terms_csv,
        source_path=str(target.relative_to(workspace_root())),
    )


SQL_MEMORY_TOOLS = [
    prepare_sql_knowledge_capture,
    validated_sql_store_overview,
    search_validated_sql_patterns,
    search_validated_sql_by_table_or_join,
    get_validated_sql_pattern,
    save_validated_sql_from_chat_turn,
    save_latest_assistant_sql_pattern,
    save_validated_sql_pattern,
    save_validated_sql_file,
]
