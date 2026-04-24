from __future__ import annotations

import json
from pathlib import Path

from langchain_core.tools import tool

from agent_server.filesystem_tools import workspace_root
from agent_server.sql_memory_store import get_sql_store


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


def _split_tags(tags_csv: str) -> list[str]:
    return [value.strip() for value in tags_csv.split(",") if value.strip()]


@tool
def validated_sql_store_overview(limit: int = 10) -> str:
    """Show the current repo's validated SQL memory, including common tables, join patterns, and recent trusted queries."""
    payload = get_sql_store().overview(str(workspace_root()), limit=max(1, min(limit, 20)))
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def search_validated_sql_patterns(query: str, limit: int = 8) -> str:
    """Search validated SQL patterns for the current repo by business term, table, join, filter, or metric keyword."""
    needle = query.strip()
    if not needle:
        return "Provide a non-empty query."
    payload = {
        "query": needle,
        "results": get_sql_store().search_patterns(
            str(workspace_root()),
            needle,
            limit=max(1, min(limit, 20)),
        ),
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def search_validated_sql_by_table_or_join(query: str, limit: int = 8) -> str:
    """Find validated SQL patterns by table name, alias, or join clue so you can quickly reuse known-good data combinations."""
    needle = query.strip()
    if not needle:
        return "Provide a non-empty table or join query."
    payload = {
        "query": needle,
        "results": get_sql_store().search_by_table_or_join(
            str(workspace_root()),
            needle,
            limit=max(1, min(limit, 20)),
        ),
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def get_validated_sql_pattern(pattern_id: str) -> str:
    """Read one validated SQL pattern in full, including the saved SQL text, tables, joins, and notes."""
    try:
        payload = get_sql_store().get_pattern(pattern_id.strip(), str(workspace_root()))
    except KeyError:
        return f"No validated SQL pattern found for id={pattern_id!r}."
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def save_validated_sql_pattern(
    name: str,
    sql_text: str,
    summary: str,
    validation_notes: str = "",
    source_path: str = "",
    dialect: str = "spark_sql",
    tags_csv: str = "",
) -> str:
    """Save a known-good SQL query for the current repo so future SQL tasks can reuse its tables and joins."""
    trimmed_sql = sql_text.strip()
    if not trimmed_sql:
        return "Provide non-empty SQL text."
    normalized_source = source_path.strip() or None
    payload = get_sql_store().save_pattern(
        workspace_root=str(workspace_root()),
        name=name.strip() or "Validated SQL pattern",
        summary=summary.strip(),
        sql_text=trimmed_sql,
        dialect=dialect.strip() or "spark_sql",
        source_path=normalized_source,
        validation_notes=validation_notes.strip(),
        tags=_split_tags(tags_csv),
    )
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def save_validated_sql_file(
    path: str,
    summary: str,
    name: str = "",
    validation_notes: str = "",
    dialect: str = "spark_sql",
    tags_csv: str = "",
) -> str:
    """Save a SQL file from the current repo into validated SQL memory so its tables and joins become easy to reuse later."""
    target = _resolve_repo_path(path)
    if not target.exists():
        return f"No file found at {path!r}."
    sql_text = target.read_text(encoding="utf-8")
    payload = get_sql_store().save_pattern(
        workspace_root=str(workspace_root()),
        name=name.strip() or target.stem,
        summary=summary.strip(),
        sql_text=sql_text,
        dialect=dialect.strip() or "spark_sql",
        source_path=str(target.relative_to(workspace_root())),
        validation_notes=validation_notes.strip(),
        tags=_split_tags(tags_csv),
    )
    return json.dumps(payload, indent=2, ensure_ascii=True)


SQL_MEMORY_TOOLS = [
    validated_sql_store_overview,
    search_validated_sql_patterns,
    search_validated_sql_by_table_or_join,
    get_validated_sql_pattern,
    save_validated_sql_pattern,
    save_validated_sql_file,
]
