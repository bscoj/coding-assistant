from __future__ import annotations

import json
import re
from pathlib import Path

from langchain_core.tools import tool

from agent_server.analytics_context_store import infer_table_layer
from agent_server.filesystem_tools import workspace_root
from agent_server.sql_knowledge_runtime import (
    get_active_analytics_context_store,
    get_active_sql_store,
)
from agent_server.sql_memory_store import (
    extract_join_clauses,
    extract_join_pairs,
    extract_tables,
)

SELECT_STAR_PATTERN = re.compile(r"(?is)\bselect\s+\*")
BRONZE_PATTERN = re.compile(r"(?i)(?:^|[._])bronze(?:[._]|$)")


def _split_csv(values: str) -> list[str]:
    return [value.strip() for value in values.split(",") if value.strip()]


def _current_workspace_root() -> str:
    return str(workspace_root())


def sync_validated_pattern_into_analytics_context(pattern: dict[str, object]) -> None:
    store = get_active_analytics_context_store()
    workspace = str(pattern.get("workspace_root") or _current_workspace_root())
    name = str(pattern.get("name") or "validated sql pattern").strip() or "validated sql pattern"
    summary = str(pattern.get("summary") or "").strip()
    business_question = str(pattern.get("business_question") or "").strip()
    grain = str(pattern.get("grain") or "").strip()
    semantic_notes = str(pattern.get("semantic_notes") or "").strip()
    metrics = [str(metric).strip() for metric in pattern.get("metrics", []) if str(metric).strip()]
    dimensions = [
        str(dimension).strip()
        for dimension in pattern.get("dimensions", [])
        if str(dimension).strip()
    ]
    pattern_id = str(pattern.get("id") or "").strip()
    source = f"validated_sql:{pattern_id}" if pattern_id else "validated_sql"
    table_summary = business_question or summary
    table_usage_notes = semantic_notes or f"Seen in validated SQL pattern '{name}'."

    for table in pattern.get("tables", []):
        table_name = str(table).strip()
        if not table_name:
            continue
        store.upsert_table_context(
            workspace_root=workspace,
            table_name=table_name,
            layer=infer_table_layer(table_name),
            summary=table_summary,
            grain=grain,
            usage_notes=table_usage_notes,
            tags=["validated-sql"],
            source=source,
        )

    if metrics and table_summary:
        source_table = str(pattern.get("tables", [""])[0]).strip() if pattern.get("tables") else ""
        for metric in metrics[:8]:
            store.upsert_metric_context(
                workspace_root=workspace,
                metric_name=metric,
                definition=f"Derived from validated SQL pattern '{name}'. {table_summary}".strip(),
                source_table=source_table,
                dimensions=dimensions[:10],
                tags=["validated-sql"],
                source=source,
            )

    sql_text = str(pattern.get("sql_text") or "")
    for pair in extract_join_pairs(sql_text):
        store.upsert_join_context(
            workspace_root=workspace,
            left_table=pair["left_table"],
            right_table=pair["right_table"],
            join_type=pair["join_type"],
            join_condition=pair["join_condition"],
            relationship="validated_pattern",
            grain_notes=f"Derived from validated SQL pattern '{name}'. {grain}".strip(),
            tags=["validated-sql"],
            source=source,
        )


def _known_tables_map() -> dict[str, dict]:
    tables = get_active_analytics_context_store().list_tables(_current_workspace_root())
    return {table["table_name"].lower(): table for table in tables}


def _known_joins() -> list[dict]:
    return get_active_analytics_context_store().list_joins(_current_workspace_root())


@tool
def analytics_context_overview(limit: int = 10) -> str:
    """Show curated analytics context for the active SQL scope: trusted tables, join rules, metric definitions, and saved filter values."""
    payload = get_active_analytics_context_store().overview(
        _current_workspace_root(),
        limit=max(1, min(limit, 20)),
    )
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def search_analytics_tables(query: str, limit: int = 8) -> str:
    """Search curated analytics table context by table name, business term, grain, synonym, or important column."""
    needle = query.strip()
    if not needle:
        return "Provide a non-empty query."
    payload = {
        "query": needle,
        "results": get_active_analytics_context_store().search_tables(
            _current_workspace_root(),
            needle,
            limit=max(1, min(limit, 20)),
        ),
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def search_analytics_joins(query: str, limit: int = 8) -> str:
    """Search curated analytics join knowledge by table name, key, relationship, or grain note."""
    needle = query.strip()
    if not needle:
        return "Provide a non-empty query."
    payload = {
        "query": needle,
        "results": get_active_analytics_context_store().search_joins(
            _current_workspace_root(),
            needle,
            limit=max(1, min(limit, 20)),
        ),
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def search_analytics_metrics(query: str, limit: int = 8) -> str:
    """Search curated analytics metric definitions by metric name, synonym, definition, or source table."""
    needle = query.strip()
    if not needle:
        return "Provide a non-empty query."
    payload = {
        "query": needle,
        "results": get_active_analytics_context_store().search_metrics(
            _current_workspace_root(),
            needle,
            limit=max(1, min(limit, 20)),
        ),
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def search_analytics_filter_values(query: str, limit: int = 8) -> str:
    """Search curated analytics filter values by business concept, abbreviation, canonical value, table, or column."""
    needle = query.strip()
    if not needle:
        return "Provide a non-empty query."
    payload = {
        "query": needle,
        "results": get_active_analytics_context_store().search_filter_values(
            _current_workspace_root(),
            needle,
            limit=max(1, min(limit, 20)),
        ),
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def suggest_filter_candidates_from_validated_sql(query: str = "", limit: int = 8) -> str:
    """Mine likely exact-value filter candidates from validated SQL so you can promote repeated literals into curated business mappings."""
    payload = {
        "query": query.strip(),
        "results": get_active_sql_store().suggest_filter_candidates(
            _current_workspace_root(),
            query.strip(),
            limit=max(1, min(limit, 20)),
        ),
        "guidance": (
            "These are mined from trusted SQL patterns. Promote the high-value ones "
            "with register_analytics_filter_value() when you want durable alias-to-filter behavior."
        ),
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def register_analytics_table(
    table_name: str,
    summary: str,
    layer: str = "",
    grain: str = "",
    usage_notes: str = "",
    important_columns_csv: str = "",
    synonyms_csv: str = "",
    tags_csv: str = "",
) -> str:
    """Register curated knowledge about an analytics table for the active SQL scope. Use this only when the user explicitly wants to save trusted table context."""
    payload = get_active_analytics_context_store().upsert_table_context(
        workspace_root=_current_workspace_root(),
        table_name=table_name,
        summary=summary,
        layer=layer,
        grain=grain,
        usage_notes=usage_notes,
        synonyms=_split_csv(synonyms_csv),
        important_columns=_split_csv(important_columns_csv),
        tags=_split_csv(tags_csv),
        source="manual",
    )
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def register_analytics_join(
    left_table: str,
    right_table: str,
    join_condition: str,
    relationship: str = "",
    join_type: str = "inner",
    grain_notes: str = "",
    warnings_csv: str = "",
    tags_csv: str = "",
) -> str:
    """Register a trusted analytics join rule for the active SQL scope. Use this only when the user explicitly wants to save known-good join guidance."""
    payload = get_active_analytics_context_store().upsert_join_context(
        workspace_root=_current_workspace_root(),
        left_table=left_table,
        right_table=right_table,
        join_condition=join_condition,
        relationship=relationship,
        join_type=join_type,
        grain_notes=grain_notes,
        warnings=_split_csv(warnings_csv),
        tags=_split_csv(tags_csv),
        source="manual",
    )
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def register_analytics_metric(
    metric_name: str,
    definition: str,
    source_table: str = "",
    default_time_column: str = "",
    dimensions_csv: str = "",
    synonyms_csv: str = "",
    tags_csv: str = "",
) -> str:
    """Register a trusted analytics metric definition for the active SQL scope. Use this only when the user explicitly wants to save known-good metric context."""
    payload = get_active_analytics_context_store().upsert_metric_context(
        workspace_root=_current_workspace_root(),
        metric_name=metric_name,
        definition=definition,
        source_table=source_table,
        default_time_column=default_time_column,
        dimensions=_split_csv(dimensions_csv),
        synonyms=_split_csv(synonyms_csv),
        tags=_split_csv(tags_csv),
        source="manual",
    )
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def register_analytics_filter_value(
    concept_name: str,
    canonical_value: str,
    column_name: str,
    source_table: str = "",
    operator: str = "=",
    sql_value_expression: str = "",
    description: str = "",
    synonyms_csv: str = "",
    tags_csv: str = "",
) -> str:
    """Register a trusted filter mapping for the active SQL scope so plain-language concepts or abbreviations resolve to exact SQL values."""
    payload = get_active_analytics_context_store().upsert_filter_value_context(
        workspace_root=_current_workspace_root(),
        concept_name=concept_name,
        canonical_value=canonical_value,
        source_table=source_table,
        column_name=column_name,
        operator=operator,
        sql_value_expression=sql_value_expression,
        description=description,
        synonyms=_split_csv(synonyms_csv),
        tags=_split_csv(tags_csv),
        source="manual",
    )
    return json.dumps(payload, indent=2, ensure_ascii=True)


def _suggest_sql_context_follow_ups(
    task: str,
    tables: list[dict],
    metrics: list[dict],
    filter_values: list[dict],
    patterns: list[dict],
) -> list[str]:
    lowered = task.lower()
    questions: list[str] = []
    if not patterns and not tables:
        questions.append("Which source table or subject area should this query begin from?")
    if not metrics and any(
        token in lowered
        for token in ["metric", "kpi", "count", "sum", "avg", "average", "rate", "how many", "total"]
    ):
        questions.append("Which exact business metric definition should this query implement?")
    if not filter_values and any(
        token in lowered
        for token in ["filter", "only", "exclude", "excluding", "where", "for ", "among", "segment"]
    ):
        questions.append("Which exact business filters, aliases, or exclusions should be applied?")
    if not patterns and any(
        token in lowered
        for token in [" daily", " weekly", " monthly", "yearly", " by ", "per ", "grain"]
    ):
        questions.append("What output grain or grouping should the final result return?")

    deduped: list[str] = []
    seen: set[str] = set()
    for question in questions:
        normalized = question.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(question)
    return deduped[:4]


@tool
def resolve_sql_task_context(task: str, limit: int = 4) -> str:
    """Retrieve only the most relevant SQL knowledge for a task: best matching validated patterns, tables, joins, metrics, and filter mappings plus the key follow-up questions if context is still missing."""
    needle = task.strip()
    if not needle:
        return "Provide a non-empty task description."

    analytics_store = get_active_analytics_context_store()
    sql_store = get_active_sql_store()
    workspace = _current_workspace_root()
    bounded_limit = max(1, min(limit, 8))

    tables = analytics_store.search_tables(workspace, needle, limit=bounded_limit)
    joins = analytics_store.search_joins(workspace, needle, limit=bounded_limit)
    metrics = analytics_store.search_metrics(workspace, needle, limit=bounded_limit)
    filter_values = analytics_store.search_filter_values(workspace, needle, limit=bounded_limit)
    patterns = sql_store.search_patterns(workspace, needle, limit=bounded_limit)

    payload = {
        "task": needle,
        "tables": tables[:bounded_limit],
        "joins": joins[:bounded_limit],
        "metrics": metrics[:bounded_limit],
        "filters": [
            {
                "concept_name": item["concept_name"],
                "canonical_value": item["canonical_value"],
                "source_table": item["source_table"],
                "column_name": item["column_name"],
                "suggested_filter_sql": item["suggested_filter_sql"],
                "synonyms": item["synonyms"][:6],
            }
            for item in filter_values[:bounded_limit]
        ],
        "validated_patterns": [
            {
                "id": pattern["id"],
                "name": pattern["name"],
                "summary": pattern["summary"],
                "business_question": pattern.get("business_question", ""),
                "grain": pattern.get("grain", ""),
                "metrics": pattern.get("metrics", [])[:6],
                "dimensions": pattern.get("dimensions", [])[:6],
                "filters": pattern.get("filters", [])[:6],
                "business_terms": pattern.get("business_terms", [])[:8],
                "tables": pattern["tables"][:6],
                "joins": pattern["joins"][:4],
            }
            for pattern in patterns[:bounded_limit]
        ],
        "follow_up_questions": _suggest_sql_context_follow_ups(
            needle,
            tables=tables,
            metrics=metrics,
            filter_values=filter_values,
            patterns=patterns,
        ),
        "guidance": "Read full SQL only for the best 1-2 validated patterns with get_validated_sql_pattern(id).",
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


@tool
def suggest_sql_starting_points(task: str, limit: int = 6) -> str:
    """Suggest trusted starting points for a SQL task by combining curated analytics context and validated SQL patterns."""
    needle = task.strip()
    if not needle:
        return "Provide a non-empty task description."

    analytics_store = get_active_analytics_context_store()
    sql_store = get_active_sql_store()
    workspace = _current_workspace_root()

    tables = analytics_store.search_tables(workspace, needle, limit=max(1, min(limit, 12)))
    joins = analytics_store.search_joins(workspace, needle, limit=max(1, min(limit, 12)))
    metrics = analytics_store.search_metrics(workspace, needle, limit=max(1, min(limit, 12)))
    filter_values = analytics_store.search_filter_values(workspace, needle, limit=max(1, min(limit, 12)))
    mined_filter_candidates = sql_store.suggest_filter_candidates(
        workspace,
        needle,
        limit=max(1, min(limit, 12)),
    )
    patterns = sql_store.search_patterns(workspace, needle, limit=max(1, min(limit, 12)))

    payload = {
        "task": needle,
        "recommended_tables": tables[:limit],
        "recommended_joins": joins[:limit],
        "recommended_metrics": metrics[:limit],
        "recommended_filters": [
            {
                "id": filter_value["id"],
                "concept_name": filter_value["concept_name"],
                "canonical_value": filter_value["canonical_value"],
                "source_table": filter_value["source_table"],
                "column_name": filter_value["column_name"],
                "suggested_filter_sql": filter_value["suggested_filter_sql"],
                "synonyms": filter_value["synonyms"][:6],
            }
            for filter_value in filter_values[:limit]
        ],
        "validated_filter_candidates": [
            {
                "column_name": candidate["column_name"],
                "canonical_value": candidate["canonical_value"],
                "suggested_filter_sql": candidate["suggested_filter_sql"],
                "suggested_aliases": candidate["suggested_aliases"][:4],
                "pattern_count": candidate["pattern_count"],
                "patterns": candidate["patterns"][:3],
            }
            for candidate in mined_filter_candidates[:limit]
        ],
        "validated_sql_patterns": [
            {
                "id": pattern["id"],
                "name": pattern["name"],
                "summary": pattern["summary"],
                "business_question": pattern.get("business_question", ""),
                "grain": pattern.get("grain", ""),
                "dimensions": pattern.get("dimensions", [])[:6],
                "metrics": pattern.get("metrics", [])[:6],
                "filters": pattern.get("filters", [])[:6],
                "business_terms": pattern.get("business_terms", [])[:8],
                "tables": pattern["tables"],
                "joins": pattern["joins"][:4],
            }
            for pattern in patterns[:limit]
        ],
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


def _match_known_join(pair: dict[str, str], known_joins: list[dict]) -> dict | None:
    left = pair["left_table"].lower()
    right = pair["right_table"].lower()
    rendered = pair["rendered"].lower()
    for join in known_joins:
        if join["left_table"].lower() == left and join["right_table"].lower() == right:
            return join
        join_rendered = (
            f'{join["join_type"]} {join["right_table"]} on {join["join_condition"]}'
        ).strip().lower()
        if join_rendered == rendered:
            return join
    return None


def _candidate_validated_patterns(sql_text: str, tables: list[str], join_clauses: list[str]) -> list[dict]:
    workspace = _current_workspace_root()
    store = get_active_sql_store()
    results_by_id: dict[str, dict] = {}
    search_terms = [*tables[:4], *join_clauses[:2]]
    if not search_terms:
        search_terms = [sql_text]
    for term in search_terms:
        for pattern in store.search_patterns(workspace, term, limit=6):
            results_by_id.setdefault(pattern["id"], pattern)
    return list(results_by_id.values())[:6]


@tool
def verify_sql_query(sql_text: str) -> str:
    """Verify a SQL query against the active SQL knowledge scope and validated SQL patterns. Use this before finalizing important SQL."""
    normalized_sql = sql_text.strip()
    if not normalized_sql:
        return "Provide non-empty SQL text."

    workspace = _current_workspace_root()
    tables = extract_tables(normalized_sql)
    join_clauses = extract_join_clauses(normalized_sql)
    join_pairs = extract_join_pairs(normalized_sql)
    known_tables = _known_tables_map()
    known_joins = _known_joins()
    matched_patterns = _candidate_validated_patterns(
        normalized_sql,
        tables=tables,
        join_clauses=join_clauses,
    )

    findings: list[dict[str, str]] = []
    unknown_tables = [table for table in tables if table.lower() not in known_tables]
    if unknown_tables:
        findings.append(
            {
                "severity": "warning",
                "message": f"These tables are not in curated analytics context yet: {', '.join(unknown_tables)}.",
            }
        )

    bronze_tables = [table for table in tables if BRONZE_PATTERN.search(table)]
    if bronze_tables:
        findings.append(
            {
                "severity": "warning",
                "message": f"This query touches bronze-layer tables: {', '.join(bronze_tables)}. Double-check that raw-layer access is intentional.",
            }
        )

    if SELECT_STAR_PATTERN.search(normalized_sql):
        findings.append(
            {
                "severity": "warning",
                "message": "The query uses SELECT *. Consider projecting only the columns you need to reduce risk and improve readability.",
            }
        )

    matched_join_rules: list[dict[str, str]] = []
    unmatched_join_pairs: list[str] = []
    for pair in join_pairs:
        known_join = _match_known_join(pair, known_joins)
        if known_join is None:
            unmatched_join_pairs.append(pair["rendered"])
            continue
        matched_join_rules.append(
            {
                "left_table": known_join["left_table"],
                "right_table": known_join["right_table"],
                "relationship": known_join["relationship"],
                "join_condition": known_join["join_condition"],
            }
        )

    if join_pairs and unmatched_join_pairs:
        findings.append(
            {
                "severity": "warning",
                "message": "Some joins do not match any curated or previously validated join rule: "
                + "; ".join(unmatched_join_pairs[:4]),
            }
        )

    risky_join_clauses = [
        join for join in join_clauses if " or " in join.lower() or "!=" in join or "<>" in join
    ]
    if risky_join_clauses:
        findings.append(
            {
                "severity": "warning",
                "message": "The query uses potentially risky join logic that may increase fanout or skew results: "
                + "; ".join(risky_join_clauses[:3]),
            }
        )

    if not findings:
        findings.append(
            {
                "severity": "info",
                "message": "No obvious issues were found against the current trusted SQL and analytics context.",
            }
        )

    known_table_count = len(tables) - len(unknown_tables)
    matched_pattern_count = len(matched_patterns)
    matched_join_count = len(matched_join_rules)
    if tables and known_table_count == len(tables) and (not join_pairs or matched_join_count == len(join_pairs)) and matched_pattern_count > 0:
        confidence = "high"
    elif known_table_count > 0 or matched_pattern_count > 0:
        confidence = "medium"
    else:
        confidence = "low"

    recommended_next_checks = [
        "Confirm the grain of the base table and each join before running the full query.",
        "Compare row counts before and after joins to catch fanout early.",
        "If the query drives reporting or features, validate a few known entities by hand.",
    ]

    payload = {
        "tables": tables,
        "join_clauses": join_clauses,
        "matched_join_rules": matched_join_rules,
        "matched_validated_patterns": [
            {
                "id": pattern["id"],
                "name": pattern["name"],
                "summary": pattern["summary"],
                "tables": pattern["tables"],
                "joins": pattern["joins"][:4],
            }
            for pattern in matched_patterns
        ],
        "unknown_tables": unknown_tables,
        "findings": findings,
        "confidence": confidence,
        "recommended_next_checks": recommended_next_checks,
    }
    return json.dumps(payload, indent=2, ensure_ascii=True)


ANALYTICS_CONTEXT_TOOLS = [
    analytics_context_overview,
    search_analytics_tables,
    search_analytics_joins,
    search_analytics_metrics,
    search_analytics_filter_values,
    suggest_filter_candidates_from_validated_sql,
    resolve_sql_task_context,
    suggest_sql_starting_points,
    verify_sql_query,
    register_analytics_table,
    register_analytics_join,
    register_analytics_metric,
    register_analytics_filter_value,
]
