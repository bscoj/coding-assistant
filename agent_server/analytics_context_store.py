from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def analytics_context_db_path() -> Path:
    configured = Path(
        os.getenv("ANALYTICS_CONTEXT_DB_PATH", ".local/analytics_context.db")
    )
    if not configured.is_absolute():
        configured = (PROJECT_ROOT / configured).resolve()
    configured.parent.mkdir(parents=True, exist_ok=True)
    return configured


def _json_list(values: list[str]) -> str:
    return json.dumps(values, ensure_ascii=True)


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


def _dedupe(values: list[str], limit: int = 24) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        trimmed = " ".join(str(value).split()).strip()
        if not trimmed:
            continue
        lowered = trimmed.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(trimmed[:240])
        if len(deduped) >= limit:
            break
    return deduped


def infer_table_layer(table_name: str) -> str:
    lowered = table_name.lower()
    for layer in ("gold", "silver", "bronze"):
        if (
            f".{layer}." in lowered
            or lowered.startswith(f"{layer}.")
            or lowered.endswith(f".{layer}")
            or f"_{layer}_" in lowered
            or lowered.startswith(f"{layer}_")
        ):
            return layer
    return ""


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


class AnalyticsContextStore:
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
                CREATE TABLE IF NOT EXISTS analytics_tables (
                  id TEXT PRIMARY KEY,
                  workspace_root TEXT NOT NULL,
                  table_name TEXT NOT NULL,
                  layer TEXT NOT NULL DEFAULT '',
                  grain TEXT NOT NULL DEFAULT '',
                  summary TEXT NOT NULL DEFAULT '',
                  usage_notes TEXT NOT NULL DEFAULT '',
                  synonyms_json TEXT NOT NULL DEFAULT '[]',
                  important_columns_json TEXT NOT NULL DEFAULT '[]',
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  source TEXT NOT NULL DEFAULT 'manual',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_tables_unique
                ON analytics_tables(workspace_root, table_name);

                CREATE INDEX IF NOT EXISTS idx_analytics_tables_workspace_updated
                ON analytics_tables(workspace_root, updated_at DESC);

                CREATE TABLE IF NOT EXISTS analytics_joins (
                  id TEXT PRIMARY KEY,
                  workspace_root TEXT NOT NULL,
                  left_table TEXT NOT NULL,
                  right_table TEXT NOT NULL,
                  join_type TEXT NOT NULL DEFAULT '',
                  join_condition TEXT NOT NULL,
                  relationship TEXT NOT NULL DEFAULT '',
                  grain_notes TEXT NOT NULL DEFAULT '',
                  warnings_json TEXT NOT NULL DEFAULT '[]',
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  source TEXT NOT NULL DEFAULT 'manual',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_joins_unique
                ON analytics_joins(workspace_root, left_table, right_table, join_condition);

                CREATE INDEX IF NOT EXISTS idx_analytics_joins_workspace_updated
                ON analytics_joins(workspace_root, updated_at DESC);

                CREATE TABLE IF NOT EXISTS analytics_metrics (
                  id TEXT PRIMARY KEY,
                  workspace_root TEXT NOT NULL,
                  metric_name TEXT NOT NULL,
                  definition TEXT NOT NULL,
                  source_table TEXT NOT NULL DEFAULT '',
                  default_time_column TEXT NOT NULL DEFAULT '',
                  dimensions_json TEXT NOT NULL DEFAULT '[]',
                  synonyms_json TEXT NOT NULL DEFAULT '[]',
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  source TEXT NOT NULL DEFAULT 'manual',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_metrics_unique
                ON analytics_metrics(workspace_root, metric_name);

                CREATE INDEX IF NOT EXISTS idx_analytics_metrics_workspace_updated
                ON analytics_metrics(workspace_root, updated_at DESC);

                CREATE TABLE IF NOT EXISTS analytics_filter_values (
                  id TEXT PRIMARY KEY,
                  workspace_root TEXT NOT NULL,
                  concept_name TEXT NOT NULL,
                  canonical_value TEXT NOT NULL DEFAULT '',
                  source_table TEXT NOT NULL DEFAULT '',
                  column_name TEXT NOT NULL DEFAULT '',
                  operator TEXT NOT NULL DEFAULT '=',
                  sql_value_expression TEXT NOT NULL DEFAULT '',
                  description TEXT NOT NULL DEFAULT '',
                  synonyms_json TEXT NOT NULL DEFAULT '[]',
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  source TEXT NOT NULL DEFAULT 'manual',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_filter_values_unique
                ON analytics_filter_values(workspace_root, concept_name, source_table, column_name);

                CREATE INDEX IF NOT EXISTS idx_analytics_filter_values_workspace_updated
                ON analytics_filter_values(workspace_root, updated_at DESC);
                """
            )

    @staticmethod
    def _merge_text(existing: str, incoming: str) -> str:
        candidate = " ".join((incoming or "").split()).strip()
        return candidate or existing

    @staticmethod
    def _merge_lists(existing: list[str], incoming: list[str], limit: int = 24) -> list[str]:
        return _dedupe([*incoming, *existing], limit=limit)

    def upsert_table_context(
        self,
        *,
        workspace_root: str,
        table_name: str,
        summary: str = "",
        layer: str = "",
        grain: str = "",
        usage_notes: str = "",
        synonyms: list[str] | None = None,
        important_columns: list[str] | None = None,
        tags: list[str] | None = None,
        source: str = "manual",
    ) -> dict[str, Any]:
        workspace_root = str(Path(workspace_root).resolve())
        table_name = table_name.strip()
        if not table_name:
            raise ValueError("table_name must be non-empty")

        incoming_layer = layer.strip() or infer_table_layer(table_name)
        incoming_synonyms = _dedupe(synonyms or [], 20)
        incoming_columns = _dedupe(important_columns or [], 30)
        incoming_tags = _dedupe(tags or [], 20)
        now = utc_now()

        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM analytics_tables
                WHERE workspace_root = ? AND table_name = ?
                """,
                (workspace_root, table_name),
            ).fetchone()
            if row is None:
                table_id = f"atable_{uuid.uuid4().hex}"
                conn.execute(
                    """
                    INSERT INTO analytics_tables (
                      id, workspace_root, table_name, layer, grain, summary, usage_notes,
                      synonyms_json, important_columns_json, tags_json, source, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        table_id,
                        workspace_root,
                        table_name,
                        incoming_layer,
                        grain.strip(),
                        " ".join(summary.split()).strip(),
                        " ".join(usage_notes.split()).strip(),
                        _json_list(incoming_synonyms),
                        _json_list(incoming_columns),
                        _json_list(incoming_tags),
                        source.strip() or "manual",
                        now,
                        now,
                    ),
                )
            else:
                table_id = row["id"]
                conn.execute(
                    """
                    UPDATE analytics_tables
                    SET layer = ?, grain = ?, summary = ?, usage_notes = ?,
                        synonyms_json = ?, important_columns_json = ?, tags_json = ?,
                        source = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        self._merge_text(row["layer"], incoming_layer),
                        self._merge_text(row["grain"], grain),
                        self._merge_text(row["summary"], summary),
                        self._merge_text(row["usage_notes"], usage_notes),
                        _json_list(
                            self._merge_lists(
                                _parse_json_list(row["synonyms_json"]), incoming_synonyms
                            )
                        ),
                        _json_list(
                            self._merge_lists(
                                _parse_json_list(row["important_columns_json"]),
                                incoming_columns,
                                limit=40,
                            )
                        ),
                        _json_list(
                            self._merge_lists(_parse_json_list(row["tags_json"]), incoming_tags)
                        ),
                        self._merge_text(row["source"], source),
                        now,
                        table_id,
                    ),
                )
            updated = conn.execute(
                """
                SELECT *
                FROM analytics_tables
                WHERE id = ?
                """,
                (table_id,),
            ).fetchone()
        return self._row_to_table(updated)

    def upsert_join_context(
        self,
        *,
        workspace_root: str,
        left_table: str,
        right_table: str,
        join_condition: str,
        join_type: str = "",
        relationship: str = "",
        grain_notes: str = "",
        warnings: list[str] | None = None,
        tags: list[str] | None = None,
        source: str = "manual",
    ) -> dict[str, Any]:
        workspace_root = str(Path(workspace_root).resolve())
        left_table = left_table.strip()
        right_table = right_table.strip()
        join_condition = " ".join(join_condition.split()).strip()
        if not left_table or not right_table or not join_condition:
            raise ValueError("left_table, right_table, and join_condition must be non-empty")

        incoming_warnings = _dedupe(warnings or [], 16)
        incoming_tags = _dedupe(tags or [], 20)
        now = utc_now()

        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM analytics_joins
                WHERE workspace_root = ? AND left_table = ? AND right_table = ? AND join_condition = ?
                """,
                (workspace_root, left_table, right_table, join_condition),
            ).fetchone()
            if row is None:
                join_id = f"ajoin_{uuid.uuid4().hex}"
                conn.execute(
                    """
                    INSERT INTO analytics_joins (
                      id, workspace_root, left_table, right_table, join_type, join_condition,
                      relationship, grain_notes, warnings_json, tags_json, source, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        join_id,
                        workspace_root,
                        left_table,
                        right_table,
                        " ".join(join_type.split()).strip(),
                        join_condition,
                        " ".join(relationship.split()).strip(),
                        " ".join(grain_notes.split()).strip(),
                        _json_list(incoming_warnings),
                        _json_list(incoming_tags),
                        source.strip() or "manual",
                        now,
                        now,
                    ),
                )
            else:
                join_id = row["id"]
                conn.execute(
                    """
                    UPDATE analytics_joins
                    SET join_type = ?, relationship = ?, grain_notes = ?,
                        warnings_json = ?, tags_json = ?, source = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        self._merge_text(row["join_type"], join_type),
                        self._merge_text(row["relationship"], relationship),
                        self._merge_text(row["grain_notes"], grain_notes),
                        _json_list(
                            self._merge_lists(
                                _parse_json_list(row["warnings_json"]), incoming_warnings
                            )
                        ),
                        _json_list(
                            self._merge_lists(_parse_json_list(row["tags_json"]), incoming_tags)
                        ),
                        self._merge_text(row["source"], source),
                        now,
                        join_id,
                    ),
                )
            updated = conn.execute(
                """
                SELECT *
                FROM analytics_joins
                WHERE id = ?
                """,
                (join_id,),
            ).fetchone()
        return self._row_to_join(updated)

    def upsert_metric_context(
        self,
        *,
        workspace_root: str,
        metric_name: str,
        definition: str,
        source_table: str = "",
        default_time_column: str = "",
        dimensions: list[str] | None = None,
        synonyms: list[str] | None = None,
        tags: list[str] | None = None,
        source: str = "manual",
    ) -> dict[str, Any]:
        workspace_root = str(Path(workspace_root).resolve())
        metric_name = metric_name.strip()
        definition = " ".join(definition.split()).strip()
        if not metric_name or not definition:
            raise ValueError("metric_name and definition must be non-empty")

        incoming_dimensions = _dedupe(dimensions or [], 24)
        incoming_synonyms = _dedupe(synonyms or [], 20)
        incoming_tags = _dedupe(tags or [], 20)
        now = utc_now()

        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM analytics_metrics
                WHERE workspace_root = ? AND metric_name = ?
                """,
                (workspace_root, metric_name),
            ).fetchone()
            if row is None:
                metric_id = f"ametric_{uuid.uuid4().hex}"
                conn.execute(
                    """
                    INSERT INTO analytics_metrics (
                      id, workspace_root, metric_name, definition, source_table,
                      default_time_column, dimensions_json, synonyms_json, tags_json,
                      source, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        metric_id,
                        workspace_root,
                        metric_name,
                        definition,
                        source_table.strip(),
                        default_time_column.strip(),
                        _json_list(incoming_dimensions),
                        _json_list(incoming_synonyms),
                        _json_list(incoming_tags),
                        source.strip() or "manual",
                        now,
                        now,
                    ),
                )
            else:
                metric_id = row["id"]
                conn.execute(
                    """
                    UPDATE analytics_metrics
                    SET definition = ?, source_table = ?, default_time_column = ?,
                        dimensions_json = ?, synonyms_json = ?, tags_json = ?,
                        source = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        self._merge_text(row["definition"], definition),
                        self._merge_text(row["source_table"], source_table),
                        self._merge_text(row["default_time_column"], default_time_column),
                        _json_list(
                            self._merge_lists(
                                _parse_json_list(row["dimensions_json"]), incoming_dimensions
                            )
                        ),
                        _json_list(
                            self._merge_lists(
                                _parse_json_list(row["synonyms_json"]), incoming_synonyms
                            )
                        ),
                        _json_list(
                            self._merge_lists(_parse_json_list(row["tags_json"]), incoming_tags)
                        ),
                        self._merge_text(row["source"], source),
                        now,
                        metric_id,
                    ),
                )
            updated = conn.execute(
                """
                SELECT *
                FROM analytics_metrics
                WHERE id = ?
                """,
                (metric_id,),
            ).fetchone()
        return self._row_to_metric(updated)

    def upsert_filter_value_context(
        self,
        *,
        workspace_root: str,
        concept_name: str,
        canonical_value: str = "",
        source_table: str = "",
        column_name: str = "",
        operator: str = "=",
        sql_value_expression: str = "",
        description: str = "",
        synonyms: list[str] | None = None,
        tags: list[str] | None = None,
        source: str = "manual",
    ) -> dict[str, Any]:
        workspace_root = str(Path(workspace_root).resolve())
        concept_name = " ".join(concept_name.split()).strip()
        canonical_value = " ".join(canonical_value.split()).strip()
        source_table = source_table.strip()
        column_name = column_name.strip()
        operator = " ".join(operator.split()).strip() or "="
        sql_value_expression = " ".join(sql_value_expression.split()).strip()
        description = " ".join(description.split()).strip()
        if not concept_name:
            raise ValueError("concept_name must be non-empty")
        if not column_name:
            raise ValueError("column_name must be non-empty")
        if not canonical_value and not sql_value_expression:
            raise ValueError("Provide canonical_value or sql_value_expression")

        incoming_synonyms = _dedupe(synonyms or [], 20)
        incoming_tags = _dedupe(tags or [], 20)
        now = utc_now()

        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM analytics_filter_values
                WHERE workspace_root = ? AND concept_name = ? AND source_table = ? AND column_name = ?
                """,
                (workspace_root, concept_name, source_table, column_name),
            ).fetchone()
            if row is None:
                filter_id = f"afilter_{uuid.uuid4().hex}"
                conn.execute(
                    """
                    INSERT INTO analytics_filter_values (
                      id, workspace_root, concept_name, canonical_value, source_table, column_name,
                      operator, sql_value_expression, description, synonyms_json, tags_json,
                      source, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        filter_id,
                        workspace_root,
                        concept_name,
                        canonical_value,
                        source_table,
                        column_name,
                        operator,
                        sql_value_expression,
                        description,
                        _json_list(incoming_synonyms),
                        _json_list(incoming_tags),
                        source.strip() or "manual",
                        now,
                        now,
                    ),
                )
            else:
                filter_id = row["id"]
                conn.execute(
                    """
                    UPDATE analytics_filter_values
                    SET canonical_value = ?, operator = ?, sql_value_expression = ?, description = ?,
                        synonyms_json = ?, tags_json = ?, source = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        self._merge_text(row["canonical_value"], canonical_value),
                        self._merge_text(row["operator"], operator),
                        self._merge_text(row["sql_value_expression"], sql_value_expression),
                        self._merge_text(row["description"], description),
                        _json_list(
                            self._merge_lists(
                                _parse_json_list(row["synonyms_json"]), incoming_synonyms
                            )
                        ),
                        _json_list(
                            self._merge_lists(_parse_json_list(row["tags_json"]), incoming_tags)
                        ),
                        self._merge_text(row["source"], source),
                        now,
                        filter_id,
                    ),
                )
            updated = conn.execute(
                """
                SELECT *
                FROM analytics_filter_values
                WHERE id = ?
                """,
                (filter_id,),
            ).fetchone()
        return self._row_to_filter_value(updated)

    def search_tables(self, workspace_root: str, query: str, limit: int = 8) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        needle = f"%{query.strip().lower()}%"
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM analytics_tables
                WHERE workspace_root = ?
                  AND (
                    lower(table_name) LIKE ?
                    OR lower(summary) LIKE ?
                    OR lower(usage_notes) LIKE ?
                    OR lower(synonyms_json) LIKE ?
                    OR lower(important_columns_json) LIKE ?
                    OR lower(tags_json) LIKE ?
                  )
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (workspace_root, needle, needle, needle, needle, needle, needle, max(1, min(limit, 20))),
            ).fetchall()
        return [self._row_to_table(row) for row in rows]

    def search_joins(self, workspace_root: str, query: str, limit: int = 8) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        needle = f"%{query.strip().lower()}%"
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM analytics_joins
                WHERE workspace_root = ?
                  AND (
                    lower(left_table) LIKE ?
                    OR lower(right_table) LIKE ?
                    OR lower(join_condition) LIKE ?
                    OR lower(relationship) LIKE ?
                    OR lower(grain_notes) LIKE ?
                    OR lower(warnings_json) LIKE ?
                    OR lower(tags_json) LIKE ?
                  )
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (workspace_root, needle, needle, needle, needle, needle, needle, needle, max(1, min(limit, 20))),
            ).fetchall()
        return [self._row_to_join(row) for row in rows]

    def search_metrics(self, workspace_root: str, query: str, limit: int = 8) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        needle = f"%{query.strip().lower()}%"
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM analytics_metrics
                WHERE workspace_root = ?
                  AND (
                    lower(metric_name) LIKE ?
                    OR lower(definition) LIKE ?
                    OR lower(source_table) LIKE ?
                    OR lower(default_time_column) LIKE ?
                    OR lower(dimensions_json) LIKE ?
                    OR lower(synonyms_json) LIKE ?
                    OR lower(tags_json) LIKE ?
                  )
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (workspace_root, needle, needle, needle, needle, needle, needle, needle, max(1, min(limit, 20))),
            ).fetchall()
        return [self._row_to_metric(row) for row in rows]

    def search_filter_values(self, workspace_root: str, query: str, limit: int = 8) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        needle = f"%{query.strip().lower()}%"
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM analytics_filter_values
                WHERE workspace_root = ?
                  AND (
                    lower(concept_name) LIKE ?
                    OR lower(canonical_value) LIKE ?
                    OR lower(source_table) LIKE ?
                    OR lower(column_name) LIKE ?
                    OR lower(description) LIKE ?
                    OR lower(synonyms_json) LIKE ?
                    OR lower(tags_json) LIKE ?
                  )
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (workspace_root, needle, needle, needle, needle, needle, needle, needle, max(1, min(limit, 20))),
            ).fetchall()
        return [self._row_to_filter_value(row) for row in rows]

    def list_tables(self, workspace_root: str) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM analytics_tables
                WHERE workspace_root = ?
                ORDER BY updated_at DESC, table_name ASC
                """,
                (workspace_root,),
            ).fetchall()
        return [self._row_to_table(row) for row in rows]

    def list_joins(self, workspace_root: str) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM analytics_joins
                WHERE workspace_root = ?
                ORDER BY updated_at DESC, left_table ASC, right_table ASC
                """,
                (workspace_root,),
            ).fetchall()
        return [self._row_to_join(row) for row in rows]

    def list_metrics(self, workspace_root: str) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM analytics_metrics
                WHERE workspace_root = ?
                ORDER BY updated_at DESC, metric_name ASC
                """,
                (workspace_root,),
            ).fetchall()
        return [self._row_to_metric(row) for row in rows]

    def list_filter_values(self, workspace_root: str) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM analytics_filter_values
                WHERE workspace_root = ?
                ORDER BY updated_at DESC, concept_name ASC
                """,
                (workspace_root,),
            ).fetchall()
        return [self._row_to_filter_value(row) for row in rows]

    def overview(self, workspace_root: str, limit: int = 10) -> dict[str, Any]:
        tables = self.list_tables(workspace_root)
        joins = self.list_joins(workspace_root)
        metrics = self.list_metrics(workspace_root)
        filter_values = self.list_filter_values(workspace_root)
        return {
            "workspace_root": str(Path(workspace_root).resolve()),
            "table_count": len(tables),
            "join_count": len(joins),
            "metric_count": len(metrics),
            "filter_value_count": len(filter_values),
            "tables": tables[:limit],
            "joins": joins[:limit],
            "metrics": metrics[:limit],
            "filter_values": filter_values[:limit],
        }

    @staticmethod
    def _row_to_table(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "workspace_root": row["workspace_root"],
            "table_name": row["table_name"],
            "layer": row["layer"],
            "grain": row["grain"],
            "summary": row["summary"],
            "usage_notes": row["usage_notes"],
            "synonyms": _parse_json_list(row["synonyms_json"]),
            "important_columns": _parse_json_list(row["important_columns_json"]),
            "tags": _parse_json_list(row["tags_json"]),
            "source": row["source"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _row_to_join(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "workspace_root": row["workspace_root"],
            "left_table": row["left_table"],
            "right_table": row["right_table"],
            "join_type": row["join_type"],
            "join_condition": row["join_condition"],
            "relationship": row["relationship"],
            "grain_notes": row["grain_notes"],
            "warnings": _parse_json_list(row["warnings_json"]),
            "tags": _parse_json_list(row["tags_json"]),
            "source": row["source"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _row_to_metric(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "workspace_root": row["workspace_root"],
            "metric_name": row["metric_name"],
            "definition": row["definition"],
            "source_table": row["source_table"],
            "default_time_column": row["default_time_column"],
            "dimensions": _parse_json_list(row["dimensions_json"]),
            "synonyms": _parse_json_list(row["synonyms_json"]),
            "tags": _parse_json_list(row["tags_json"]),
            "source": row["source"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _row_to_filter_value(row: sqlite3.Row) -> dict[str, Any]:
        canonical_value = row["canonical_value"]
        sql_value_expression = row["sql_value_expression"]
        column_name = row["column_name"]
        operator = row["operator"] or "="
        if sql_value_expression:
            suggested_filter_sql = f"{column_name} {operator} {sql_value_expression}".strip()
        elif canonical_value:
            suggested_filter_sql = f"{column_name} {operator} {_sql_literal(canonical_value)}".strip()
        else:
            suggested_filter_sql = ""
        return {
            "id": row["id"],
            "workspace_root": row["workspace_root"],
            "concept_name": row["concept_name"],
            "canonical_value": canonical_value,
            "source_table": row["source_table"],
            "column_name": column_name,
            "operator": operator,
            "sql_value_expression": sql_value_expression,
            "suggested_filter_sql": suggested_filter_sql,
            "description": row["description"],
            "synonyms": _parse_json_list(row["synonyms_json"]),
            "tags": _parse_json_list(row["tags_json"]),
            "source": row["source"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }


_ANALYTICS_CONTEXT_STORE: AnalyticsContextStore | None = None


def get_analytics_context_store() -> AnalyticsContextStore:
    global _ANALYTICS_CONTEXT_STORE
    if _ANALYTICS_CONTEXT_STORE is None:
        _ANALYTICS_CONTEXT_STORE = AnalyticsContextStore(analytics_context_db_path())
    return _ANALYTICS_CONTEXT_STORE
