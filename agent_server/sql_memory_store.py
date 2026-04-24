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
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  tables_json TEXT NOT NULL DEFAULT '[]',
                  joins_json TEXT NOT NULL DEFAULT '[]',
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
    ) -> dict[str, Any]:
        now = utc_now()
        normalized_sql = normalize_sql(sql_text)
        pattern_hash = _sql_hash(normalized_sql)
        tables = extract_tables(normalized_sql)
        joins = extract_join_clauses(normalized_sql)
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
                        validation_notes = ?, tags_json = ?, tables_json = ?, joins_json = ?,
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
                        _json_list(tags),
                        _json_list(tables),
                        _json_list(joins),
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
                      source_path, validation_notes, tags_json, tables_json, joins_json,
                      use_count, created_at, updated_at, last_used_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
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
                        _json_list(tags),
                        _json_list(tables),
                        _json_list(joins),
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
                    OR lower(tables_json) LIKE ?
                    OR lower(joins_json) LIKE ?
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
                    max(1, min(limit, 20)),
                ),
            ).fetchall()
        return [self._row_to_pattern(row) for row in rows]

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
        for pattern in patterns:
            for table in pattern["tables"]:
                table_counts[table] = table_counts.get(table, 0) + 1
            for join in pattern["joins"]:
                join_counts[join] = join_counts.get(join, 0) + 1

        top_tables = sorted(
            [{"table": table, "count": count} for table, count in table_counts.items()],
            key=lambda item: (-item["count"], item["table"].lower()),
        )[:limit]
        top_joins = sorted(
            [{"join": join, "count": count} for join, count in join_counts.items()],
            key=lambda item: (-item["count"], item["join"].lower()),
        )[:limit]
        recent_patterns = [
            {
                "id": pattern["id"],
                "name": pattern["name"],
                "summary": pattern["summary"],
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
            pattern
            for pattern in patterns
            if _matches_table_or_join(pattern, trimmed)
        ][: max(1, min(limit, 20))]

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
            "tags": _parse_json_list(row["tags_json"]),
            "tables": _parse_json_list(row["tables_json"]),
            "joins": _parse_json_list(row["joins_json"]),
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
