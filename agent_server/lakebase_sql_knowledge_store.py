from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from databricks.sdk import WorkspaceClient

from agent_server.analytics_context_store import (
    _dedupe as analytics_dedupe,
    _json_list as analytics_json_list,
    _parse_json_list as analytics_parse_json_list,
    _sql_literal,
    infer_table_layer,
)
from agent_server.sql_memory_store import (
    _dedupe_strings,
    _json_list,
    _matches_table_or_join,
    _parse_json_list,
    _sql_hash,
    extract_filter_candidates,
    extract_group_by_columns,
    extract_join_clauses,
    extract_metric_candidates,
    extract_tables,
    normalize_sql,
    sql_line_count,
    utc_now,
)


class LakebaseDependencyError(RuntimeError):
    pass


def lakebase_dependency_error_message() -> str:
    return (
        "Lakebase SQL knowledge requires the memory extras for Databricks Lakebase "
        "support. Run `uv sync` after adding `databricks-langchain[memory]` so "
        "`psycopg` and `psycopg-pool` are installed."
    )


def _load_lakebase_client_class():
    try:
        from databricks_ai_bridge.lakebase import LakebaseClient
    except ImportError as exc:
        raise LakebaseDependencyError(lakebase_dependency_error_message()) from exc
    return LakebaseClient


def _env_float(name: str, default: float) -> float:
    raw_value = (os.getenv(name) or "").strip()
    if not raw_value:
        return default
    try:
        return float(raw_value)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw_value = (os.getenv(name) or "").strip()
    if not raw_value:
        return default
    try:
        return int(raw_value)
    except ValueError:
        return default


def _is_branch_resource_path(branch: str | None) -> bool:
    return bool(branch and branch.startswith("projects/") and "/branches/" in branch)


def _extract_postgres_conninfo(raw_value: str | None) -> str | None:
    value = (raw_value or "").strip()
    if not value:
        return None
    if value.startswith("psql "):
        value = value[5:].strip()
    if (
        (value.startswith("'") and value.endswith("'"))
        or (value.startswith('"') and value.endswith('"'))
    ):
        value = value[1:-1].strip()
    if value.startswith("postgresql://") or value.startswith("postgres://"):
        return value
    return raw_value


class DirectPostgresLakebaseClient:
    def __init__(self, conninfo: str, password_provider: Callable[[], str] | None = None):
        try:
            import psycopg
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool
        except ImportError as exc:
            raise LakebaseDependencyError(lakebase_dependency_error_message()) from exc

        password = (
            os.getenv("LAKEBASE_DATABASE_PASSWORD")
            or os.getenv("LAKEBASE_DATABASE_OAUTH_TOKEN")
            or os.getenv("PGPASSWORD")
            or ""
        ).strip()
        kwargs: dict[str, Any] = {
            "autocommit": True,
            "row_factory": dict_row,
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 5,
        }
        if password:
            kwargs["password"] = password

        token_provider = password_provider

        class RotatingConnection(psycopg.Connection):
            @classmethod
            def connect(cls, conninfo: str = "", **connect_kwargs: Any):
                if token_provider is not None:
                    connect_kwargs["password"] = token_provider()
                return super().connect(conninfo, **connect_kwargs)

        self._pool = ConnectionPool(
            conninfo=conninfo,
            kwargs=kwargs,
            min_size=_env_int("LAKEBASE_POOL_MIN_SIZE", 0),
            max_size=_env_int("LAKEBASE_POOL_MAX_SIZE", 4),
            timeout=_env_float("LAKEBASE_POOL_TIMEOUT_SECONDS", 90.0),
            open=True,
            connection_class=RotatingConnection,
        )
        self._psycopg = psycopg

    def execute(
        self,
        sql_text: str,
        params: tuple[Any, ...] | dict[str, Any] | None = None,
    ) -> list[Any] | None:
        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql_text, params)
                if cur.description:
                    return cur.fetchall()
                return None

    def close(self) -> None:
        self._pool.close()


def direct_lakebase_conninfo(database_url: str | None) -> str | None:
    if database_url:
        return _extract_postgres_conninfo(database_url)

    host = (os.getenv("PGHOST") or "").strip()
    database = (os.getenv("PGDATABASE") or "").strip()
    user = (os.getenv("PGUSER") or "").strip()
    if not host or not database or not user:
        return None

    try:
        from psycopg.conninfo import make_conninfo
    except ImportError as exc:
        raise LakebaseDependencyError(lakebase_dependency_error_message()) from exc

    password = (
        os.getenv("PGPASSWORD")
        or os.getenv("LAKEBASE_DATABASE_PASSWORD")
        or os.getenv("LAKEBASE_DATABASE_OAUTH_TOKEN")
        or ""
    ).strip()
    kwargs: dict[str, Any] = {
        "host": host,
        "dbname": database,
        "user": user,
        "port": (os.getenv("PGPORT") or "5432").strip() or "5432",
        "sslmode": (os.getenv("PGSSLMODE") or "require").strip() or "require",
    }
    if password:
        kwargs["password"] = password
    return make_conninfo("", **kwargs)


def database_url_summary(database_url: str | None) -> dict[str, Any] | None:
    conninfo = _extract_postgres_conninfo(database_url)
    if not conninfo:
        return None
    try:
        parsed = urlsplit(conninfo)
    except ValueError:
        return {"kind": "database_url"}
    database = parsed.path.lstrip("/") or None
    return {
        "kind": "database_url",
        "host": parsed.hostname,
        "database": database,
        "role": parsed.username,
        "has_password": parsed.password is not None
        or bool((os.getenv("LAKEBASE_DATABASE_PASSWORD") or "").strip())
        or bool((os.getenv("LAKEBASE_DATABASE_OAUTH_TOKEN") or "").strip())
        or bool((os.getenv("PGPASSWORD") or "").strip()),
        "sslmode_required": "sslmode=require" in parsed.query.lower(),
    }


def pg_env_summary() -> dict[str, Any] | None:
    host = (os.getenv("PGHOST") or "").strip()
    database = (os.getenv("PGDATABASE") or "").strip()
    user = (os.getenv("PGUSER") or "").strip()
    if not host and not database and not user:
        return None
    return {
        "kind": "pg_env",
        "host": host or None,
        "database": database or None,
        "role": user or None,
        "port": (os.getenv("PGPORT") or "5432").strip() or "5432",
        "has_password": bool((os.getenv("PGPASSWORD") or "").strip())
        or bool((os.getenv("LAKEBASE_DATABASE_PASSWORD") or "").strip())
        or bool((os.getenv("LAKEBASE_DATABASE_OAUTH_TOKEN") or "").strip()),
        "sslmode_required": ((os.getenv("PGSSLMODE") or "require").strip().lower() == "require"),
    }


def create_lakebase_client(
    *,
    profile: str | None,
    database_url: str | None,
    instance_name: str | None,
    project: str | None,
    branch: str | None,
):
    conninfo = direct_lakebase_conninfo(database_url)
    if conninfo:
        password_provider = _database_url_password_provider(
            profile=profile,
            database_url=conninfo,
            project=project,
            branch=branch,
        )
        return DirectPostgresLakebaseClient(conninfo, password_provider=password_provider)

    LakebaseClient = _load_lakebase_client_class()
    workspace_client = WorkspaceClient(profile=profile) if profile else WorkspaceClient()
    kwargs: dict[str, Any] = {"workspace_client": workspace_client}
    if instance_name:
        kwargs["instance_name"] = instance_name
    else:
        if not project or not branch:
            raise ValueError(
                "Lakebase configuration is incomplete. Provide instance_name or both project and branch."
            )
        if not _is_branch_resource_path(branch):
            kwargs["project"] = project
        kwargs["branch"] = branch
        kwargs["min_size"] = _env_int("LAKEBASE_POOL_MIN_SIZE", 0)
        kwargs["max_size"] = _env_int("LAKEBASE_POOL_MAX_SIZE", 4)
        kwargs["timeout"] = _env_float("LAKEBASE_POOL_TIMEOUT_SECONDS", 90.0)
    return LakebaseClient(**kwargs)


def _database_url_password_provider(
    *,
    profile: str | None,
    database_url: str,
    project: str | None,
    branch: str | None,
) -> Callable[[], str] | None:
    if (
        (os.getenv("LAKEBASE_DATABASE_PASSWORD") or "").strip()
        or (os.getenv("LAKEBASE_DATABASE_OAUTH_TOKEN") or "").strip()
        or (os.getenv("PGPASSWORD") or "").strip()
    ):
        return None
    try:
        parsed = urlsplit(database_url)
    except ValueError:
        return None
    if parsed.password:
        return None
    if not project or not branch:
        raise ValueError(
            "The pasted Lakebase psql string does not include a password. Keep autoscaling "
            "project and branch configured so the app can mint an OAuth database credential, "
            "or use a native Postgres role connection string that includes a password."
        )

    workspace_client = WorkspaceClient(profile=profile) if profile else WorkspaceClient()
    endpoint_name = _resolve_autoscaling_endpoint_for_host(
        workspace_client=workspace_client,
        project=project,
        branch=branch,
        target_host=parsed.hostname,
    )

    def _mint_token() -> str:
        credential = workspace_client.postgres.generate_database_credential(
            endpoint=endpoint_name,
        )
        token = getattr(credential, "token", None)
        if not token:
            raise RuntimeError("Failed to generate Lakebase database credential.")
        return token

    return _mint_token


def _resolve_autoscaling_endpoint_for_host(
    *,
    workspace_client: WorkspaceClient,
    project: str,
    branch: str,
    target_host: str | None,
) -> str:
    branch_parent = branch if _is_branch_resource_path(branch) else f"projects/{project}/branches/{branch}"
    endpoints = list(workspace_client.postgres.list_endpoints(parent=branch_parent))
    read_write_endpoints: list[Any] = []
    for endpoint in endpoints:
        status = getattr(endpoint, "status", None)
        endpoint_type = getattr(status, "endpoint_type", None)
        if endpoint_type and "READ_WRITE" in str(endpoint_type):
            read_write_endpoints.append(endpoint)

    candidates = read_write_endpoints or endpoints
    for endpoint in candidates:
        status = getattr(endpoint, "status", None)
        hosts = getattr(status, "hosts", None)
        host = getattr(hosts, "host", None) if hosts else None
        if target_host and host == target_host and getattr(endpoint, "name", None):
            return endpoint.name

    if len(candidates) == 1 and getattr(candidates[0], "name", None):
        return candidates[0].name

    raise ValueError(
        "Could not match the pasted Lakebase psql host to an autoscaling endpoint. "
        "Verify the saved project and branch match the psql string's branch and compute."
    )


class _LakebaseStoreBase:
    def __init__(self, client: Any):
        self.client = client

    def _execute(self, sql_text: str, params: tuple[Any, ...] | dict[str, Any] | None = None):
        return self.client.execute(sql_text, params)


class LakebaseValidatedSqlStore(_LakebaseStoreBase):
    def __init__(self, client: Any):
        super().__init__(client)
        self._initialize()

    def _initialize(self) -> None:
        self._execute(
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
            )
            """
        )
        self._execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_validated_sql_unique
            ON validated_sql_patterns(workspace_root, sql_hash)
            """
        )
        self._execute(
            """
            CREATE INDEX IF NOT EXISTS idx_validated_sql_workspace_updated
            ON validated_sql_patterns(workspace_root, updated_at DESC)
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
        inferred_filters = [
            candidate["suggested_filter_sql"]
            for candidate in extract_filter_candidates(normalized_sql)
        ]
        normalized_filters = _dedupe_strings(list(filters or []) or inferred_filters, limit=16)
        normalized_business_terms = _dedupe_strings(list(business_terms or []), limit=20)
        normalized_question = " ".join(business_question.split()).strip()
        normalized_grain = " ".join(grain.split()).strip()
        normalized_semantic_notes = " ".join(semantic_notes.split()).strip()
        workspace_root = str(Path(workspace_root).resolve())

        existing = self._fetchone(
            """
            SELECT *
            FROM validated_sql_patterns
            WHERE workspace_root = %s AND sql_hash = %s
            """,
            (workspace_root, pattern_hash),
        )

        if existing is not None:
            pattern_id = str(existing["id"])
            self._execute(
                """
                UPDATE validated_sql_patterns
                SET name = %s, summary = %s, sql_text = %s, dialect = %s, source_path = %s,
                    validation_notes = %s, business_question = %s, grain = %s, semantic_notes = %s,
                    tags_json = %s, tables_json = %s, joins_json = %s, dimensions_json = %s,
                    metrics_json = %s, filters_json = %s, business_terms_json = %s,
                    updated_at = %s, use_count = use_count + 1, last_used_at = %s
                WHERE id = %s
                """,
                (
                    name,
                    summary,
                    normalized_sql,
                    dialect,
                    source_path,
                    validation_notes,
                    normalized_question or str(existing.get("business_question") or ""),
                    normalized_grain or str(existing.get("grain") or ""),
                    normalized_semantic_notes or str(existing.get("semantic_notes") or ""),
                    _json_list(tags),
                    _json_list(tables),
                    _json_list(joins),
                    _json_list(
                        _dedupe_strings(
                            _parse_json_list(str(existing.get("dimensions_json") or "[]"))
                            + normalized_dimensions,
                            limit=16,
                        )
                    ),
                    _json_list(
                        _dedupe_strings(
                            _parse_json_list(str(existing.get("metrics_json") or "[]"))
                            + normalized_metrics,
                            limit=16,
                        )
                    ),
                    _json_list(
                        _dedupe_strings(
                            _parse_json_list(str(existing.get("filters_json") or "[]"))
                            + normalized_filters,
                            limit=16,
                        )
                    ),
                    _json_list(
                        _dedupe_strings(
                            _parse_json_list(str(existing.get("business_terms_json") or "[]"))
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
            self._execute(
                """
                INSERT INTO validated_sql_patterns (
                  id, workspace_root, name, summary, sql_text, sql_hash, dialect,
                  source_path, validation_notes, business_question, grain, semantic_notes,
                  tags_json, tables_json, joins_json, dimensions_json, metrics_json,
                  filters_json, business_terms_json, use_count, created_at, updated_at,
                  last_used_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1, %s, %s, %s)
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
        row = self._fetchone(
            """
            SELECT *
            FROM validated_sql_patterns
            WHERE id = %s AND workspace_root = %s
            """,
            (pattern_id, workspace_root),
        )
        if row is None:
            raise KeyError(pattern_id)
        return self._row_to_pattern(row)

    def list_patterns(self, workspace_root: str) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        rows = self._fetchall(
            """
            SELECT *
            FROM validated_sql_patterns
            WHERE workspace_root = %s
            ORDER BY updated_at DESC, name ASC
            """,
            (workspace_root,),
        )
        return [self._row_to_pattern(row) for row in rows]

    def search_patterns(
        self, workspace_root: str, query: str, limit: int = 8
    ) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        needle = f"%{query.strip().lower()}%"
        rows = self._fetchall(
            """
            SELECT *
            FROM validated_sql_patterns
            WHERE workspace_root = %s
              AND (
                lower(name) LIKE %s
                OR lower(summary) LIKE %s
                OR lower(sql_text) LIKE %s
                OR lower(validation_notes) LIKE %s
                OR lower(business_question) LIKE %s
                OR lower(grain) LIKE %s
                OR lower(semantic_notes) LIKE %s
                OR lower(tables_json) LIKE %s
                OR lower(joins_json) LIKE %s
                OR lower(dimensions_json) LIKE %s
                OR lower(metrics_json) LIKE %s
                OR lower(filters_json) LIKE %s
                OR lower(business_terms_json) LIKE %s
                OR lower(tags_json) LIKE %s
              )
            ORDER BY use_count DESC, updated_at DESC
            LIMIT %s
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
        )
        return [self._row_to_pattern_summary(row) for row in rows]

    def overview(self, workspace_root: str, limit: int = 10) -> dict[str, Any]:
        workspace_root = str(Path(workspace_root).resolve())
        patterns = self.list_patterns(workspace_root)
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
        patterns = self.list_patterns(workspace_root)
        trimmed = query.strip()
        if not trimmed:
            return []
        return [
            self._pattern_summary(pattern)
            for pattern in patterns
            if _matches_table_or_join(pattern, trimmed)
        ][: max(1, min(limit, 20))]

    def suggest_filter_candidates(
        self, workspace_root: str, query: str = "", limit: int = 8
    ) -> list[dict[str, Any]]:
        patterns = self.list_patterns(workspace_root)[:200]
        trimmed = query.strip().lower()
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
    def _row_to_pattern_summary(cls, row: dict[str, Any]) -> dict[str, Any]:
        return cls._pattern_summary(cls._row_to_pattern(row))

    @staticmethod
    def _row_to_pattern(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "workspace_root": row["workspace_root"],
            "name": row["name"],
            "summary": row["summary"],
            "sql_text": row["sql_text"],
            "sql_hash": row.get("sql_hash", ""),
            "dialect": row["dialect"],
            "source_path": row.get("source_path"),
            "validation_notes": row["validation_notes"],
            "business_question": row.get("business_question", ""),
            "grain": row.get("grain", ""),
            "semantic_notes": row.get("semantic_notes", ""),
            "tags": _parse_json_list(row.get("tags_json")),
            "tables": _parse_json_list(row.get("tables_json")),
            "joins": _parse_json_list(row.get("joins_json")),
            "dimensions": _parse_json_list(row.get("dimensions_json")),
            "metrics": _parse_json_list(row.get("metrics_json")),
            "filters": _parse_json_list(row.get("filters_json")),
            "business_terms": _parse_json_list(row.get("business_terms_json")),
            "use_count": int(row.get("use_count") or 0),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "last_used_at": row.get("last_used_at"),
        }

    def _fetchall(self, sql_text: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
        rows = self._execute(sql_text, params)
        return [dict(row) for row in rows or []]

    def _fetchone(self, sql_text: str, params: tuple[Any, ...]) -> dict[str, Any] | None:
        rows = self._fetchall(sql_text, params)
        return rows[0] if rows else None


class LakebaseAnalyticsContextStore(_LakebaseStoreBase):
    def __init__(self, client: Any):
        super().__init__(client)
        self._initialize()

    def _initialize(self) -> None:
        self._execute(
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
            )
            """
        )
        self._execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_tables_unique
            ON analytics_tables(workspace_root, table_name)
            """
        )
        self._execute(
            """
            CREATE INDEX IF NOT EXISTS idx_analytics_tables_workspace_updated
            ON analytics_tables(workspace_root, updated_at DESC)
            """
        )
        self._execute(
            """
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
            )
            """
        )
        self._execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_joins_unique
            ON analytics_joins(workspace_root, left_table, right_table, join_condition)
            """
        )
        self._execute(
            """
            CREATE INDEX IF NOT EXISTS idx_analytics_joins_workspace_updated
            ON analytics_joins(workspace_root, updated_at DESC)
            """
        )
        self._execute(
            """
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
            )
            """
        )
        self._execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_metrics_unique
            ON analytics_metrics(workspace_root, metric_name)
            """
        )
        self._execute(
            """
            CREATE INDEX IF NOT EXISTS idx_analytics_metrics_workspace_updated
            ON analytics_metrics(workspace_root, updated_at DESC)
            """
        )
        self._execute(
            """
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
            )
            """
        )
        self._execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_filter_values_unique
            ON analytics_filter_values(workspace_root, concept_name, source_table, column_name)
            """
        )
        self._execute(
            """
            CREATE INDEX IF NOT EXISTS idx_analytics_filter_values_workspace_updated
            ON analytics_filter_values(workspace_root, updated_at DESC)
            """
        )

    @staticmethod
    def _merge_text(existing: str, incoming: str) -> str:
        candidate = " ".join((incoming or "").split()).strip()
        return candidate or existing

    @staticmethod
    def _merge_lists(existing: list[str], incoming: list[str], limit: int = 24) -> list[str]:
        return analytics_dedupe([*incoming, *existing], limit=limit)

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
        incoming_synonyms = analytics_dedupe(synonyms or [], 20)
        incoming_columns = analytics_dedupe(important_columns or [], 30)
        incoming_tags = analytics_dedupe(tags or [], 20)
        now = utc_now()

        row = self._fetchone(
            """
            SELECT *
            FROM analytics_tables
            WHERE workspace_root = %s AND table_name = %s
            """,
            (workspace_root, table_name),
        )
        if row is None:
            table_id = f"atable_{uuid.uuid4().hex}"
            self._execute(
                """
                INSERT INTO analytics_tables (
                  id, workspace_root, table_name, layer, grain, summary, usage_notes,
                  synonyms_json, important_columns_json, tags_json, source, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    table_id,
                    workspace_root,
                    table_name,
                    incoming_layer,
                    grain.strip(),
                    " ".join(summary.split()).strip(),
                    " ".join(usage_notes.split()).strip(),
                    analytics_json_list(incoming_synonyms),
                    analytics_json_list(incoming_columns),
                    analytics_json_list(incoming_tags),
                    source.strip() or "manual",
                    now,
                    now,
                ),
            )
        else:
            table_id = str(row["id"])
            self._execute(
                """
                UPDATE analytics_tables
                SET layer = %s, grain = %s, summary = %s, usage_notes = %s,
                    synonyms_json = %s, important_columns_json = %s, tags_json = %s,
                    source = %s, updated_at = %s
                WHERE id = %s
                """,
                (
                    self._merge_text(str(row.get("layer") or ""), incoming_layer),
                    self._merge_text(str(row.get("grain") or ""), grain),
                    self._merge_text(str(row.get("summary") or ""), summary),
                    self._merge_text(str(row.get("usage_notes") or ""), usage_notes),
                    analytics_json_list(
                        self._merge_lists(
                            analytics_parse_json_list(row.get("synonyms_json")),
                            incoming_synonyms,
                        )
                    ),
                    analytics_json_list(
                        self._merge_lists(
                            analytics_parse_json_list(row.get("important_columns_json")),
                            incoming_columns,
                            limit=40,
                        )
                    ),
                    analytics_json_list(
                        self._merge_lists(
                            analytics_parse_json_list(row.get("tags_json")),
                            incoming_tags,
                        )
                    ),
                    self._merge_text(str(row.get("source") or ""), source),
                    now,
                    table_id,
                ),
            )
        updated = self._fetchone("SELECT * FROM analytics_tables WHERE id = %s", (table_id,))
        if updated is None:
            raise KeyError(table_id)
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

        incoming_warnings = analytics_dedupe(warnings or [], 16)
        incoming_tags = analytics_dedupe(tags or [], 20)
        now = utc_now()

        row = self._fetchone(
            """
            SELECT *
            FROM analytics_joins
            WHERE workspace_root = %s AND left_table = %s AND right_table = %s AND join_condition = %s
            """,
            (workspace_root, left_table, right_table, join_condition),
        )
        if row is None:
            join_id = f"ajoin_{uuid.uuid4().hex}"
            self._execute(
                """
                INSERT INTO analytics_joins (
                  id, workspace_root, left_table, right_table, join_type, join_condition,
                  relationship, grain_notes, warnings_json, tags_json, source, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    analytics_json_list(incoming_warnings),
                    analytics_json_list(incoming_tags),
                    source.strip() or "manual",
                    now,
                    now,
                ),
            )
        else:
            join_id = str(row["id"])
            self._execute(
                """
                UPDATE analytics_joins
                SET join_type = %s, relationship = %s, grain_notes = %s,
                    warnings_json = %s, tags_json = %s, source = %s, updated_at = %s
                WHERE id = %s
                """,
                (
                    self._merge_text(str(row.get("join_type") or ""), join_type),
                    self._merge_text(str(row.get("relationship") or ""), relationship),
                    self._merge_text(str(row.get("grain_notes") or ""), grain_notes),
                    analytics_json_list(
                        self._merge_lists(
                            analytics_parse_json_list(row.get("warnings_json")),
                            incoming_warnings,
                        )
                    ),
                    analytics_json_list(
                        self._merge_lists(
                            analytics_parse_json_list(row.get("tags_json")),
                            incoming_tags,
                        )
                    ),
                    self._merge_text(str(row.get("source") or ""), source),
                    now,
                    join_id,
                ),
            )
        updated = self._fetchone("SELECT * FROM analytics_joins WHERE id = %s", (join_id,))
        if updated is None:
            raise KeyError(join_id)
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

        incoming_dimensions = analytics_dedupe(dimensions or [], 24)
        incoming_synonyms = analytics_dedupe(synonyms or [], 20)
        incoming_tags = analytics_dedupe(tags or [], 20)
        now = utc_now()

        row = self._fetchone(
            """
            SELECT *
            FROM analytics_metrics
            WHERE workspace_root = %s AND metric_name = %s
            """,
            (workspace_root, metric_name),
        )
        if row is None:
            metric_id = f"ametric_{uuid.uuid4().hex}"
            self._execute(
                """
                INSERT INTO analytics_metrics (
                  id, workspace_root, metric_name, definition, source_table,
                  default_time_column, dimensions_json, synonyms_json, tags_json,
                  source, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    metric_id,
                    workspace_root,
                    metric_name,
                    definition,
                    source_table.strip(),
                    default_time_column.strip(),
                    analytics_json_list(incoming_dimensions),
                    analytics_json_list(incoming_synonyms),
                    analytics_json_list(incoming_tags),
                    source.strip() or "manual",
                    now,
                    now,
                ),
            )
        else:
            metric_id = str(row["id"])
            self._execute(
                """
                UPDATE analytics_metrics
                SET definition = %s, source_table = %s, default_time_column = %s,
                    dimensions_json = %s, synonyms_json = %s, tags_json = %s,
                    source = %s, updated_at = %s
                WHERE id = %s
                """,
                (
                    self._merge_text(str(row.get("definition") or ""), definition),
                    self._merge_text(str(row.get("source_table") or ""), source_table),
                    self._merge_text(
                        str(row.get("default_time_column") or ""),
                        default_time_column,
                    ),
                    analytics_json_list(
                        self._merge_lists(
                            analytics_parse_json_list(row.get("dimensions_json")),
                            incoming_dimensions,
                        )
                    ),
                    analytics_json_list(
                        self._merge_lists(
                            analytics_parse_json_list(row.get("synonyms_json")),
                            incoming_synonyms,
                        )
                    ),
                    analytics_json_list(
                        self._merge_lists(
                            analytics_parse_json_list(row.get("tags_json")),
                            incoming_tags,
                        )
                    ),
                    self._merge_text(str(row.get("source") or ""), source),
                    now,
                    metric_id,
                ),
            )
        updated = self._fetchone("SELECT * FROM analytics_metrics WHERE id = %s", (metric_id,))
        if updated is None:
            raise KeyError(metric_id)
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

        incoming_synonyms = analytics_dedupe(synonyms or [], 20)
        incoming_tags = analytics_dedupe(tags or [], 20)
        now = utc_now()

        row = self._fetchone(
            """
            SELECT *
            FROM analytics_filter_values
            WHERE workspace_root = %s AND concept_name = %s AND source_table = %s AND column_name = %s
            """,
            (workspace_root, concept_name, source_table, column_name),
        )
        if row is None:
            filter_id = f"afilter_{uuid.uuid4().hex}"
            self._execute(
                """
                INSERT INTO analytics_filter_values (
                  id, workspace_root, concept_name, canonical_value, source_table, column_name,
                  operator, sql_value_expression, description, synonyms_json, tags_json,
                  source, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    analytics_json_list(incoming_synonyms),
                    analytics_json_list(incoming_tags),
                    source.strip() or "manual",
                    now,
                    now,
                ),
            )
        else:
            filter_id = str(row["id"])
            self._execute(
                """
                UPDATE analytics_filter_values
                SET canonical_value = %s, operator = %s, sql_value_expression = %s, description = %s,
                    synonyms_json = %s, tags_json = %s, source = %s, updated_at = %s
                WHERE id = %s
                """,
                (
                    self._merge_text(str(row.get("canonical_value") or ""), canonical_value),
                    self._merge_text(str(row.get("operator") or ""), operator),
                    self._merge_text(
                        str(row.get("sql_value_expression") or ""),
                        sql_value_expression,
                    ),
                    self._merge_text(str(row.get("description") or ""), description),
                    analytics_json_list(
                        self._merge_lists(
                            analytics_parse_json_list(row.get("synonyms_json")),
                            incoming_synonyms,
                        )
                    ),
                    analytics_json_list(
                        self._merge_lists(
                            analytics_parse_json_list(row.get("tags_json")),
                            incoming_tags,
                        )
                    ),
                    self._merge_text(str(row.get("source") or ""), source),
                    now,
                    filter_id,
                ),
            )
        updated = self._fetchone(
            "SELECT * FROM analytics_filter_values WHERE id = %s",
            (filter_id,),
        )
        if updated is None:
            raise KeyError(filter_id)
        return self._row_to_filter_value(updated)

    def search_tables(self, workspace_root: str, query: str, limit: int = 8) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        needle = f"%{query.strip().lower()}%"
        rows = self._fetchall(
            """
            SELECT *
            FROM analytics_tables
            WHERE workspace_root = %s
              AND (
                lower(table_name) LIKE %s
                OR lower(summary) LIKE %s
                OR lower(usage_notes) LIKE %s
                OR lower(synonyms_json) LIKE %s
                OR lower(important_columns_json) LIKE %s
                OR lower(tags_json) LIKE %s
              )
            ORDER BY updated_at DESC
            LIMIT %s
            """,
            (workspace_root, needle, needle, needle, needle, needle, needle, max(1, min(limit, 20))),
        )
        return [self._row_to_table(row) for row in rows]

    def search_joins(self, workspace_root: str, query: str, limit: int = 8) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        needle = f"%{query.strip().lower()}%"
        rows = self._fetchall(
            """
            SELECT *
            FROM analytics_joins
            WHERE workspace_root = %s
              AND (
                lower(left_table) LIKE %s
                OR lower(right_table) LIKE %s
                OR lower(join_condition) LIKE %s
                OR lower(relationship) LIKE %s
                OR lower(grain_notes) LIKE %s
                OR lower(warnings_json) LIKE %s
                OR lower(tags_json) LIKE %s
              )
            ORDER BY updated_at DESC
            LIMIT %s
            """,
            (workspace_root, needle, needle, needle, needle, needle, needle, needle, max(1, min(limit, 20))),
        )
        return [self._row_to_join(row) for row in rows]

    def search_metrics(self, workspace_root: str, query: str, limit: int = 8) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        needle = f"%{query.strip().lower()}%"
        rows = self._fetchall(
            """
            SELECT *
            FROM analytics_metrics
            WHERE workspace_root = %s
              AND (
                lower(metric_name) LIKE %s
                OR lower(definition) LIKE %s
                OR lower(source_table) LIKE %s
                OR lower(default_time_column) LIKE %s
                OR lower(dimensions_json) LIKE %s
                OR lower(synonyms_json) LIKE %s
                OR lower(tags_json) LIKE %s
              )
            ORDER BY updated_at DESC
            LIMIT %s
            """,
            (workspace_root, needle, needle, needle, needle, needle, needle, needle, max(1, min(limit, 20))),
        )
        return [self._row_to_metric(row) for row in rows]

    def search_filter_values(self, workspace_root: str, query: str, limit: int = 8) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        needle = f"%{query.strip().lower()}%"
        rows = self._fetchall(
            """
            SELECT *
            FROM analytics_filter_values
            WHERE workspace_root = %s
              AND (
                lower(concept_name) LIKE %s
                OR lower(canonical_value) LIKE %s
                OR lower(source_table) LIKE %s
                OR lower(column_name) LIKE %s
                OR lower(description) LIKE %s
                OR lower(synonyms_json) LIKE %s
                OR lower(tags_json) LIKE %s
              )
            ORDER BY updated_at DESC
            LIMIT %s
            """,
            (workspace_root, needle, needle, needle, needle, needle, needle, needle, max(1, min(limit, 20))),
        )
        return [self._row_to_filter_value(row) for row in rows]

    def list_tables(self, workspace_root: str) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        rows = self._fetchall(
            """
            SELECT *
            FROM analytics_tables
            WHERE workspace_root = %s
            ORDER BY updated_at DESC, table_name ASC
            """,
            (workspace_root,),
        )
        return [self._row_to_table(row) for row in rows]

    def list_joins(self, workspace_root: str) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        rows = self._fetchall(
            """
            SELECT *
            FROM analytics_joins
            WHERE workspace_root = %s
            ORDER BY updated_at DESC, left_table ASC, right_table ASC
            """,
            (workspace_root,),
        )
        return [self._row_to_join(row) for row in rows]

    def list_metrics(self, workspace_root: str) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        rows = self._fetchall(
            """
            SELECT *
            FROM analytics_metrics
            WHERE workspace_root = %s
            ORDER BY updated_at DESC, metric_name ASC
            """,
            (workspace_root,),
        )
        return [self._row_to_metric(row) for row in rows]

    def list_filter_values(self, workspace_root: str) -> list[dict[str, Any]]:
        workspace_root = str(Path(workspace_root).resolve())
        rows = self._fetchall(
            """
            SELECT *
            FROM analytics_filter_values
            WHERE workspace_root = %s
            ORDER BY updated_at DESC, concept_name ASC
            """,
            (workspace_root,),
        )
        return [self._row_to_filter_value(row) for row in rows]

    def overview(self, workspace_root: str, limit: int = 10) -> dict[str, Any]:
        workspace_root = str(Path(workspace_root).resolve())
        tables = self.list_tables(workspace_root)
        joins = self.list_joins(workspace_root)
        metrics = self.list_metrics(workspace_root)
        filter_values = self.list_filter_values(workspace_root)
        return {
            "workspace_root": workspace_root,
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
    def _row_to_table(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "workspace_root": row["workspace_root"],
            "table_name": row["table_name"],
            "layer": row["layer"],
            "grain": row["grain"],
            "summary": row["summary"],
            "usage_notes": row["usage_notes"],
            "synonyms": analytics_parse_json_list(row.get("synonyms_json")),
            "important_columns": analytics_parse_json_list(row.get("important_columns_json")),
            "tags": analytics_parse_json_list(row.get("tags_json")),
            "source": row["source"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _row_to_join(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "workspace_root": row["workspace_root"],
            "left_table": row["left_table"],
            "right_table": row["right_table"],
            "join_type": row["join_type"],
            "join_condition": row["join_condition"],
            "relationship": row["relationship"],
            "grain_notes": row["grain_notes"],
            "warnings": analytics_parse_json_list(row.get("warnings_json")),
            "tags": analytics_parse_json_list(row.get("tags_json")),
            "source": row["source"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _row_to_metric(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "workspace_root": row["workspace_root"],
            "metric_name": row["metric_name"],
            "definition": row["definition"],
            "source_table": row["source_table"],
            "default_time_column": row["default_time_column"],
            "dimensions": analytics_parse_json_list(row.get("dimensions_json")),
            "synonyms": analytics_parse_json_list(row.get("synonyms_json")),
            "tags": analytics_parse_json_list(row.get("tags_json")),
            "source": row["source"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _row_to_filter_value(row: dict[str, Any]) -> dict[str, Any]:
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
            "synonyms": analytics_parse_json_list(row.get("synonyms_json")),
            "tags": analytics_parse_json_list(row.get("tags_json")),
            "source": row["source"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _fetchall(self, sql_text: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
        rows = self._execute(sql_text, params)
        return [dict(row) for row in rows or []]

    def _fetchone(self, sql_text: str, params: tuple[Any, ...]) -> dict[str, Any] | None:
        rows = self._fetchall(sql_text, params)
        return rows[0] if rows else None
