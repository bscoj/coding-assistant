from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent

TABLE_PATTERN = re.compile(r"(?is)\b(?:from|join)\s+([`\"\[\]\w\.-]+)")
JOIN_PATTERN = re.compile(
    r"(?is)\b((?:left|right|full(?:\s+outer)?|inner|cross)?\s*join)\s+([`\"\[\]\w\.-]+)"
    r"(?:\s+(?:as\s+)?[\w$]+)?\s+on\s+(.*?)(?=\b(?:left|right|full(?:\s+outer)?|inner|cross)?\s*join\b|\bwhere\b|\bgroup\b|\border\b|\bhaving\b|\bqualify\b|\blimit\b|$)"
)
GROUP_BY_PATTERN = re.compile(
    r"(?is)\bgroup\s+by\s+(.*?)(?=\border\b|\bhaving\b|\bqualify\b|\blimit\b|$)"
)
AGGREGATE_PATTERN = re.compile(
    r"(?is)\b(count\s*\(\s*distinct\s+[^)]+\)|count\s*\([^)]*\)|sum\s*\([^)]*\)|avg\s*\([^)]*\)|min\s*\([^)]*\)|max\s*\([^)]*\))(?:\s+as\s+([A-Za-z_][\w$]*))?"
)
FILTER_EQ_PATTERN = re.compile(
    r"""(?is)\b([A-Za-z_][\w.$]*)\s*(=|!=|<>)\s*(['"])(.{1,160}?)\3"""
)
FILTER_IN_PATTERN = re.compile(
    r"""(?is)\b([A-Za-z_][\w.$]*)\s+in\s*\(([^)]{1,400})\)"""
)
QUOTED_LITERAL_PATTERN = re.compile(r"""(['"])(.{1,160}?)\1""")
GENERIC_FILTER_WORDS = {
    "hospital",
    "medical",
    "center",
    "centre",
    "clinic",
    "system",
    "health",
    "healthcare",
    "facility",
    "campus",
    "site",
    "department",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sql_memory_db_path() -> Path:
    configured = Path(os.getenv("SQL_MEMORY_DB_PATH", ".local/sql_memory.db"))
    if not configured.is_absolute():
        configured = (PROJECT_ROOT / configured).resolve()
    configured.parent.mkdir(parents=True, exist_ok=True)
    return configured


def normalize_sql(sql: str) -> str:
    return "\n".join(line.rstrip() for line in sql.strip().splitlines()).strip()


def sql_line_count(sql: str) -> int:
    normalized = normalize_sql(sql)
    if not normalized:
        return 0
    return len(normalized.splitlines())


def _sql_hash(sql: str) -> str:
    normalized = " ".join(normalize_sql(sql).split()).strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _parse_json_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _json_list(values: list[str]) -> str:
    return json.dumps(values, ensure_ascii=True)


def _dedupe_strings(values: list[str], limit: int = 24) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for raw in values:
        value = " ".join(str(raw).split()).strip()
        if not value:
            continue
        lowered = value.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(value[:240])
        if len(deduped) >= limit:
            break
    return deduped


def _clean_identifier(value: str) -> str:
    cleaned = value.strip().rstrip(",;")
    if cleaned.startswith("[") and cleaned.endswith("]"):
        cleaned = cleaned[1:-1]
    return cleaned.strip("`\"")


def extract_tables(sql: str) -> list[str]:
    seen: set[str] = set()
    tables: list[str] = []
    for match in TABLE_PATTERN.finditer(sql):
        identifier = _clean_identifier(match.group(1))
        lowered = identifier.lower()
        if not identifier or lowered in seen:
            continue
        seen.add(lowered)
        tables.append(identifier)
    return tables[:20]


def extract_join_clauses(sql: str) -> list[str]:
    return [detail["rendered"] for detail in extract_join_details(sql)]


def extract_join_details(sql: str) -> list[dict[str, str]]:
    seen: set[str] = set()
    joins: list[dict[str, str]] = []
    for match in JOIN_PATTERN.finditer(sql):
        join_type = " ".join(match.group(1).split()).strip().lower()
        table = _clean_identifier(match.group(2))
        clause = " ".join(match.group(3).split()).strip()
        rendered = f"{join_type} {table} on {clause}".strip()
        if len(rendered) > 320:
            rendered = rendered[:320].rstrip() + " ... [truncated]"
        lowered = rendered.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        joins.append(
            {
                "join_type": join_type,
                "table": table,
                "condition": clause,
                "rendered": rendered,
            }
        )
    return joins[:20]


def extract_join_pairs(sql: str) -> list[dict[str, str]]:
    tables = extract_tables(sql)
    join_details = extract_join_details(sql)
    if not tables or not join_details:
        return []

    pairs: list[dict[str, str]] = []
    left_table = tables[0]
    for detail in join_details:
        right_table = detail["table"]
        if not right_table:
            continue
        pairs.append(
            {
                "left_table": left_table,
                "right_table": right_table,
                "join_type": detail["join_type"],
                "join_condition": detail["condition"],
                "rendered": detail["rendered"],
            }
        )
        left_table = right_table
    return pairs[:20]


def extract_group_by_columns(sql: str) -> list[str]:
    match = GROUP_BY_PATTERN.search(sql)
    if not match:
        return []
    raw_clause = " ".join(match.group(1).split()).strip()
    if not raw_clause:
        return []
    columns = re.split(r",(?![^(]*\))", raw_clause)
    return _dedupe_strings(columns, limit=16)


def extract_metric_candidates(sql: str) -> list[str]:
    candidates: list[str] = []
    for match in AGGREGATE_PATTERN.finditer(sql):
        alias = (match.group(2) or "").strip()
        expression = " ".join(match.group(1).split()).strip()
        if alias:
            candidates.append(alias)
        elif expression:
            candidates.append(expression)
    return _dedupe_strings(candidates, limit=16)


def _alias_suggestions(value: str) -> list[str]:
    compact = " ".join(value.replace("_", " ").split()).strip()
    if not compact:
        return []
    suggestions: list[str] = [compact.lower()]
    tokens = [token for token in re.split(r"[\s/-]+", compact) if token]
    if tokens:
        first = tokens[0]
        if 2 <= len(first) <= 6 and first.isupper():
            suggestions.append(first.lower())
        meaningful = [token for token in tokens if token.lower() not in GENERIC_FILTER_WORDS]
        if meaningful:
            suggestions.append(" ".join(token.lower() for token in meaningful))
            if len(meaningful) == 1:
                suggestions.append(meaningful[0].lower())
    deduped: list[str] = []
    seen: set[str] = set()
    for suggestion in suggestions:
        normalized = suggestion.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped[:6]


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def extract_filter_candidates(sql: str) -> list[dict[str, Any]]:
    normalized = normalize_sql(sql)
    seen: set[tuple[str, str, str]] = set()
    candidates: list[dict[str, Any]] = []

    for match in FILTER_EQ_PATTERN.finditer(normalized):
        column = _clean_identifier(match.group(1))
        operator = match.group(2)
        literal = " ".join(match.group(4).split()).strip()
        if not column or not literal:
            continue
        if literal.isdigit():
            continue
        key = (column.lower(), operator, literal.lower())
        if key in seen:
            continue
        seen.add(key)
        candidates.append(
            {
                "column_name": column,
                "operator": operator,
                "canonical_value": literal,
                "suggested_filter_sql": f"{column} {operator} {_sql_literal(literal)}",
                "alias_suggestions": _alias_suggestions(literal),
            }
        )

    for match in FILTER_IN_PATTERN.finditer(normalized):
        column = _clean_identifier(match.group(1))
        raw_values = match.group(2)
        if not column:
            continue
        literals = [
            " ".join(found.group(2).split()).strip()
            for found in QUOTED_LITERAL_PATTERN.finditer(raw_values)
            if " ".join(found.group(2).split()).strip()
        ]
        for literal in literals[:5]:
            if literal.isdigit():
                continue
            key = (column.lower(), "in", literal.lower())
            if key in seen:
                continue
            seen.add(key)
            candidates.append(
                {
                    "column_name": column,
                    "operator": "in",
                    "canonical_value": literal,
                    "suggested_filter_sql": f"{column} in ({_sql_literal(literal)})",
                    "alias_suggestions": _alias_suggestions(literal),
                }
            )
    return candidates[:24]


def _matches_table_or_join(pattern: dict[str, Any], needle: str) -> bool:
    lowered = needle.strip().lower()
    if not lowered:
        return False
    return any(lowered in table.lower() for table in pattern["tables"]) or any(
        lowered in join.lower() for join in pattern["joins"]
    )


class ValidatedSqlStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS validated_sql_patterns (
                  id TEXT PRIMARY KEY,
                  workspace_root TEXT NOT NULL,
                  name TEXT NOT NULL,
                  summary TEXT NOT NULL DEFAULT '',
                  sql_text TEXT NOT NULL,
                  sql_hash TEXT NOT NULL,
                  dialect TEXT NOT NULL DEFAULT 'spark_sql',
                  source_path TEXT,
                  validation_notes TEXT NOT NULL DEFAULT '',
                  business_question TEXT NOT NULL DEFAULT '',
                  grain TEXT NOT NULL DEFAULT '',
                  semantic_notes TEXT NOT NULL DEFAULT '',
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  tables_json TEXT NOT NULL DEFAULT '[]',
                  joins_json TEXT NOT NULL DEFAULT '[]',
                  dimensions_json TEXT NOT NULL DEFAULT '[]',
                  metrics_json TEXT NOT NULL DEFAULT '[]',
                  filters_json TEXT NOT NULL DEFAULT '[]',
                  business_terms_json TEXT NOT NULL DEFAULT '[]',
                  use_count INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  last_used_at TEXT
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_validated_sql_unique
                ON validated_sql_patterns(workspace_root, sql_hash);

                CREATE INDEX IF NOT EXISTS idx_validated_sql_workspace_updated
                ON validated_sql_patterns(workspace_root, updated_at DESC);
                """
            )
            self._ensure_column(
                conn, "validated_sql_patterns", "business_question", "TEXT NOT NULL DEFAULT ''"
            )
            self._ensure_column(
                conn, "validated_sql_patterns", "grain", "TEXT NOT NULL DEFAULT ''"
            )
            self._ensure_column(
                conn, "validated_sql_patterns", "semantic_notes", "TEXT NOT NULL DEFAULT ''"
            )
            self._ensure_column(
                conn, "validated_sql_patterns", "dimensions_json", "TEXT NOT NULL DEFAULT '[]'"
            )
            self._ensure_column(
                conn, "validated_sql_patterns", "metrics_json", "TEXT NOT NULL DEFAULT '[]'"
            )
            self._ensure_column(
                conn, "validated_sql_patterns", "filters_json", "TEXT NOT NULL DEFAULT '[]'"
            )
            self._ensure_column(
                conn,
                "validated_sql_patterns",
                "business_terms_json",
                "TEXT NOT NULL DEFAULT '[]'",
            )

    @staticmethod
    def _ensure_column(
        conn: sqlite3.Connection,
        table_name: str,
        column_name: str,
        definition: str,
    ) -> None:
        columns = {
            row["name"]
            for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        }
        if column_name in columns:
            return
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")

    def save_pattern(
        self,
        *,
        workspace_root: str,
        name: str,
        summary: str,
        sql_text: str,
        dialect: str,
        source_path: str | None,
        validation_notes: str,
        tags: list[str],
        business_question: str = "",
        grain: str = "",
        semantic_notes: str = "",
        dimensions: list[str] | None = None,
        metrics: list[str] | None = None,
        filters: list[str] | None = None,
        business_terms: list[str] | None = None,
    ) -> dict[str, Any]:
        now = utc_now()
        normalized_sql = normalize_sql(sql_text)
        pattern_hash = _sql_hash(normalized_sql)
        tables = extract_tables(normalized_sql)
        joins = extract_join_clauses(normalized_sql)
        normalized_dimensions = _dedupe_strings(
            list(dimensions or []) or extract_group_by_columns(normalized_sql),
            limit=16,
        )
        normalized_metrics = _dedupe_strings(
            list(metrics or []) or extract_metric_candidates(normalized_sql),
            limit=16,
        )
        inferred_filters = [candidate["suggested_filter_sql"] for candidate in extract_filter_candidates(normalized_sql)]
        normalized_filters = _dedupe_strings(list(filters or []) or inferred_filters, limit=16)
        normalized_business_terms = _dedupe_strings(list(business_terms or []), limit=20)
        normalized_question = " ".join(business_question.split()).strip()
        normalized_grain = " ".join(grain.split()).strip()
        normalized_semantic_notes = " ".join(semantic_notes.split()).strip()
        workspace_root = str(Path(workspace_root).resolve())

        with self._connect() as conn:
            existing = conn.execute(
                """
                SELECT *
                FROM validated_sql_patterns
                WHERE workspace_root = ? AND sql_hash = ?
                """,
                (workspace_root, pattern_hash),
            ).fetchone()
            if existing is not None:
                pattern_id = existing["id"]
                conn.execute(
                    """
                    UPDATE validated_sql_patterns
                    SET name = ?, summary = ?, sql_text = ?, dialect = ?, source_path = ?,
                        validation_notes = ?, business_question = ?, grain = ?, semantic_notes = ?,
                        tags_json = ?, tables_json = ?, joins_json = ?, dimensions_json = ?,
                        metrics_json = ?, filters_json = ?, business_terms_json = ?,
                        updated_at = ?, use_count = use_count + 1, last_used_at = ?
                    WHERE id = ?
                    """,
                    (
                        name,
                        summary,
                        normalized_sql,
                        dialect,
                        source_path,
                        validation_notes,
                        normalized_question or existing["business_question"],
                        normalized_grain or existing["grain"],
                        normalized_semantic_notes or existing["semantic_notes"],
                        _json_list(tags),
                        _json_list(tables),
                        _json_list(joins),
                        _json_list(
                            _dedupe_strings(
                                _parse_json_list(existing["dimensions_json"])
                                + normalized_dimensions,
                                limit=16,
                            )
                        ),
                        _json_list(
                            _dedupe_strings(
                                _parse_json_list(existing["metrics_json"]) + normalized_metrics,
                                limit=16,
                            )
                        ),
                        _json_list(
                            _dedupe_strings(
                                _parse_json_list(existing["filters_json"]) + normalized_filters,
                                limit=16,
                            )
                        ),
                        _json_list(
                            _dedupe_strings(
                                _parse_json_list(existing["business_terms_json"])
                                + normalized_business_terms,
                                limit=20,
                            )
                        ),
                        now,
                        now,
                        pattern_id,
                    ),
                )
            else:
                pattern_id = f"sql_{uuid.uuid4().hex}"
                conn.execute(
                    """
                    INSERT INTO validated_sql_patterns (
                      id, workspace_root, name, summary, sql_text, sql_hash, dialect,
                      source_path, validation_notes, business_question, grain, semantic_notes,
                      tags_json, tables_json, joins_json, dimensions_json, metrics_json,
                      filters_json, business_terms_json, use_count, created_at, updated_at,
                      last_used_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                    """,
                    (
                        pattern_id,
                        workspace_root,
                        name,
                        summary,
                        normalized_sql,
                        pattern_hash,
                        dialect,
                        source_path,
                        validation_notes,
                        normalized_question,
                        normalized_grain,
                        normalized_semantic_notes,
                        _json_list(tags),
                        _json_list(tables),
                        _json_list(joins),
                        _json_list(normalized_dimensions),
                        _json_list(normalized_metrics),
                        _json_list(normalized_filters),
                        _json_list(normalized_business_terms),
                        now,
                        now,
                        now,
                    ),
                )
        return self.get_pattern(pattern_id, workspace_root)

    def get_pattern(self, pattern_id: str, workspace_root: str) -> dict[str, Any]:
        workspace_root = str(Path(workspace_root).resolve())
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM validated_sql_patterns
                WHERE id = ? AND workspace_root = ?
                """,
                (pattern_id, workspace_root),
            ).fetchone()
            if row is None:
                raise KeyError(pattern_id)
        return self._row_to_pattern(row)

    def search_patterns(
        self, workspace_root: str, query: str, limit: int = 8
    ) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        needle = f"%{query.strip().lower()}%"
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM validated_sql_patterns
                WHERE workspace_root = ?
                  AND (
                    lower(name) LIKE ?
                    OR lower(summary) LIKE ?
                    OR lower(sql_text) LIKE ?
                    OR lower(validation_notes) LIKE ?
                    OR lower(business_question) LIKE ?
                    OR lower(grain) LIKE ?
                    OR lower(semantic_notes) LIKE ?
                    OR lower(tables_json) LIKE ?
                    OR lower(joins_json) LIKE ?
                    OR lower(dimensions_json) LIKE ?
                    OR lower(metrics_json) LIKE ?
                    OR lower(filters_json) LIKE ?
                    OR lower(business_terms_json) LIKE ?
                    OR lower(tags_json) LIKE ?
                  )
                ORDER BY use_count DESC, updated_at DESC
                LIMIT ?
                """,
                (
                    workspace_root,
                    needle,
                    needle,
                    needle,
                    needle,
                    needle,
                    needle,
                    needle,
                    needle,
                    needle,
                    needle,
                    needle,
                    needle,
                    needle,
                    needle,
                    max(1, min(limit, 20)),
                ),
            ).fetchall()
        return [self._row_to_pattern_summary(row) for row in rows]

    def overview(self, workspace_root: str, limit: int = 10) -> dict[str, Any]:
        workspace_root = str(Path(workspace_root).resolve())
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM validated_sql_patterns
                WHERE workspace_root = ?
                ORDER BY updated_at DESC
                """,
                (workspace_root,),
            ).fetchall()
        patterns = [self._row_to_pattern(row) for row in rows]
        table_counts: dict[str, int] = {}
        join_counts: dict[str, int] = {}
        metric_counts: dict[str, int] = {}
        for pattern in patterns:
            for table in pattern["tables"]:
                table_counts[table] = table_counts.get(table, 0) + 1
            for join in pattern["joins"]:
                join_counts[join] = join_counts.get(join, 0) + 1
            for metric in pattern["metrics"]:
                metric_counts[metric] = metric_counts.get(metric, 0) + 1

        top_tables = sorted(
            [{"table": table, "count": count} for table, count in table_counts.items()],
            key=lambda item: (-item["count"], item["table"].lower()),
        )[:limit]
        top_joins = sorted(
            [{"join": join, "count": count} for join, count in join_counts.items()],
            key=lambda item: (-item["count"], item["join"].lower()),
        )[:limit]
        top_metrics = sorted(
            [{"metric": metric, "count": count} for metric, count in metric_counts.items()],
            key=lambda item: (-item["count"], item["metric"].lower()),
        )[:limit]
        recent_patterns = [
            {
                "id": pattern["id"],
                "name": pattern["name"],
                "summary": pattern["summary"],
                "business_question": pattern["business_question"],
                "grain": pattern["grain"],
                "metrics": pattern["metrics"][:4],
                "tables": pattern["tables"][:6],
                "updated_at": pattern["updated_at"],
            }
            for pattern in patterns[:limit]
        ]
        return {
            "workspace_root": workspace_root,
            "pattern_count": len(patterns),
            "top_tables": top_tables,
            "top_joins": top_joins,
            "top_metrics": top_metrics,
            "recent_patterns": recent_patterns,
        }

    def search_by_table_or_join(
        self, workspace_root: str, query: str, limit: int = 8
    ) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        trimmed = query.strip()
        if not trimmed:
            return []
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM validated_sql_patterns
                WHERE workspace_root = ?
                ORDER BY use_count DESC, updated_at DESC
                """,
                (workspace_root,),
            ).fetchall()
        patterns = [self._row_to_pattern(row) for row in rows]
        return [
            self._pattern_summary(pattern)
            for pattern in patterns
            if _matches_table_or_join(pattern, trimmed)
        ][: max(1, min(limit, 20))]

    def suggest_filter_candidates(
        self, workspace_root: str, query: str = "", limit: int = 8
    ) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        trimmed = query.strip().lower()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM validated_sql_patterns
                WHERE workspace_root = ?
                ORDER BY use_count DESC, updated_at DESC
                LIMIT 200
                """,
                (workspace_root,),
            ).fetchall()
        patterns = [self._row_to_pattern(row) for row in rows]
        aggregated: dict[tuple[str, str, str], dict[str, Any]] = {}

        for pattern in patterns:
            pattern_text = " ".join(
                [
                    pattern["name"],
                    pattern["summary"],
                    pattern["business_question"],
                    pattern["semantic_notes"],
                    " ".join(pattern["dimensions"]),
                    " ".join(pattern["metrics"]),
                    " ".join(pattern["filters"]),
                    " ".join(pattern["business_terms"]),
                    pattern["validation_notes"],
                    " ".join(pattern["tables"]),
                    " ".join(pattern["joins"]),
                    pattern["sql_text"],
                ]
            ).lower()
            for candidate in extract_filter_candidates(pattern["sql_text"]):
                if trimmed:
                    search_text = " ".join(
                        [
                            candidate["column_name"],
                            candidate["canonical_value"],
                            " ".join(candidate["alias_suggestions"]),
                            pattern_text,
                        ]
                    ).lower()
                    if trimmed not in search_text:
                        continue

                key = (
                    candidate["column_name"].lower(),
                    candidate["operator"].lower(),
                    candidate["canonical_value"].lower(),
                )
                entry = aggregated.get(key)
                if entry is None:
                    entry = {
                        "column_name": candidate["column_name"],
                        "operator": candidate["operator"],
                        "canonical_value": candidate["canonical_value"],
                        "suggested_filter_sql": candidate["suggested_filter_sql"],
                        "suggested_aliases": list(candidate["alias_suggestions"]),
                        "pattern_count": 0,
                        "patterns": [],
                        "tables": [],
                    }
                    aggregated[key] = entry

                entry["pattern_count"] += 1
                for alias in candidate["alias_suggestions"]:
                    if alias not in entry["suggested_aliases"]:
                        entry["suggested_aliases"].append(alias)
                for table in pattern["tables"][:4]:
                    if table not in entry["tables"]:
                        entry["tables"].append(table)
                if len(entry["patterns"]) < 4:
                    entry["patterns"].append(
                        {
                            "id": pattern["id"],
                            "name": pattern["name"],
                            "summary": pattern["summary"],
                            "source_path": pattern["source_path"],
                        }
                    )

        results = sorted(
            aggregated.values(),
            key=lambda item: (
                -item["pattern_count"],
                item["column_name"].lower(),
                item["canonical_value"].lower(),
            ),
        )
        return results[: max(1, min(limit, 20))]

    def summarize_pattern(self, pattern: dict[str, Any]) -> dict[str, Any]:
        return self._pattern_summary(pattern)

    @staticmethod
    def _pattern_summary(pattern: dict[str, Any]) -> dict[str, Any]:
        sql_text = str(pattern.get("sql_text") or "")
        return {
            "id": pattern["id"],
            "workspace_root": pattern["workspace_root"],
            "name": pattern["name"],
            "summary": pattern["summary"],
            "business_question": pattern["business_question"],
            "grain": pattern["grain"],
            "semantic_notes": pattern["semantic_notes"],
            "dialect": pattern["dialect"],
            "source_path": pattern["source_path"],
            "validation_notes": pattern["validation_notes"],
            "tags": list(pattern["tags"]),
            "tables": list(pattern["tables"])[:8],
            "joins": list(pattern["joins"])[:4],
            "dimensions": list(pattern["dimensions"])[:6],
            "metrics": list(pattern["metrics"])[:6],
            "filters": list(pattern["filters"])[:6],
            "business_terms": list(pattern["business_terms"])[:8],
            "table_count": len(pattern["tables"]),
            "join_count": len(pattern["joins"]),
            "sql_char_count": len(sql_text),
            "sql_line_count": sql_line_count(sql_text),
            "use_count": pattern["use_count"],
            "created_at": pattern["created_at"],
            "updated_at": pattern["updated_at"],
            "last_used_at": pattern["last_used_at"],
        }

    @classmethod
    def _row_to_pattern_summary(cls, row: sqlite3.Row) -> dict[str, Any]:
        return cls._pattern_summary(cls._row_to_pattern(row))

    @staticmethod
    def _row_to_pattern(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "workspace_root": row["workspace_root"],
            "name": row["name"],
            "summary": row["summary"],
            "sql_text": row["sql_text"],
            "dialect": row["dialect"],
            "source_path": row["source_path"],
            "validation_notes": row["validation_notes"],
            "business_question": row["business_question"] if "business_question" in row.keys() else "",
            "grain": row["grain"] if "grain" in row.keys() else "",
            "semantic_notes": row["semantic_notes"] if "semantic_notes" in row.keys() else "",
            "tags": _parse_json_list(row["tags_json"]),
            "tables": _parse_json_list(row["tables_json"]),
            "joins": _parse_json_list(row["joins_json"]),
            "dimensions": _parse_json_list(row["dimensions_json"])
            if "dimensions_json" in row.keys()
            else [],
            "metrics": _parse_json_list(row["metrics_json"]) if "metrics_json" in row.keys() else [],
            "filters": _parse_json_list(row["filters_json"]) if "filters_json" in row.keys() else [],
            "business_terms": _parse_json_list(row["business_terms_json"])
            if "business_terms_json" in row.keys()
            else [],
            "use_count": row["use_count"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "last_used_at": row["last_used_at"],
        }


_SQL_STORE: ValidatedSqlStore | None = None


def get_sql_store() -> ValidatedSqlStore:
    global _SQL_STORE
    if _SQL_STORE is None:
        _SQL_STORE = ValidatedSqlStore(sql_memory_db_path())
    return _SQL_STORE
