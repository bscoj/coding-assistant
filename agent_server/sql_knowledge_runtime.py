from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from mlflow.genai.agent_server import get_request_headers

from agent_server.analytics_context_store import get_analytics_context_store
from agent_server.filesystem_tools import NO_WORKSPACE_SELECTED_MARKER, PROJECT_ROOT
from agent_server.lakebase_sql_knowledge_store import (
    LakebaseAnalyticsContextStore,
    LakebaseDependencyError,
    LakebaseValidatedSqlStore,
    create_lakebase_client,
)
from agent_server.sql_memory_store import get_sql_store

SqlKnowledgeMode = Literal["local", "lakebase", "hybrid"]

SQL_KNOWLEDGE_MODE_HEADER = "x-codex-sql-knowledge-mode"
LAKEBASE_PROJECT_HEADER = "x-codex-lakebase-project"
LAKEBASE_BRANCH_HEADER = "x-codex-lakebase-branch"
LAKEBASE_INSTANCE_HEADER = "x-codex-lakebase-instance"

_LAKEBASE_CACHE_KEY: tuple[str | None, str | None, str | None, str | None] | None = None
_LAKEBASE_SQL_STORE: LakebaseValidatedSqlStore | None = None
_LAKEBASE_ANALYTICS_STORE: LakebaseAnalyticsContextStore | None = None


@dataclass(frozen=True)
class LakebaseConnectionConfig:
    profile: str | None
    instance_name: str | None
    project: str | None
    branch: str | None

    @property
    def configured(self) -> bool:
        return bool(self.instance_name or (self.project and self.branch))


def normalize_sql_knowledge_mode(value: str | None) -> SqlKnowledgeMode:
    candidate = (value or "").strip().lower()
    if candidate == "lakebase":
        return "lakebase"
    if candidate == "hybrid":
        return "hybrid"
    return "local"


def requested_sql_knowledge_mode() -> SqlKnowledgeMode:
    headers = get_request_headers()
    requested = headers.get(SQL_KNOWLEDGE_MODE_HEADER)
    env_value = os.getenv("SQL_KNOWLEDGE_MODE")
    return normalize_sql_knowledge_mode(requested or env_value)


def lakebase_connection_config(
    headers: dict[str, str] | None = None,
) -> LakebaseConnectionConfig:
    values = headers or get_request_headers()
    return LakebaseConnectionConfig(
        profile=(os.getenv("DATABRICKS_CONFIG_PROFILE") or "").strip() or None,
        instance_name=(values.get(LAKEBASE_INSTANCE_HEADER) or os.getenv("LAKEBASE_INSTANCE_NAME") or "").strip() or None,
        project=(values.get(LAKEBASE_PROJECT_HEADER) or os.getenv("LAKEBASE_AUTOSCALING_PROJECT") or "").strip() or None,
        branch=(values.get(LAKEBASE_BRANCH_HEADER) or os.getenv("LAKEBASE_AUTOSCALING_BRANCH") or "").strip() or None,
    )


def normalize_sql_workspace_root(raw_workspace_root: str | None) -> str:
    value = (raw_workspace_root or "").strip()
    if not value or value == NO_WORKSPACE_SELECTED_MARKER:
        path = (PROJECT_ROOT / ".local" / "no-workspace-selected").resolve()
        path.mkdir(parents=True, exist_ok=True)
        return str(path)
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = (PROJECT_ROOT / candidate).resolve()
    return str(candidate.resolve())


def effective_sql_knowledge_mode(
    requested_mode: SqlKnowledgeMode, *, lakebase_available: bool
) -> SqlKnowledgeMode:
    if requested_mode == "hybrid" and not lakebase_available:
        return "local"
    return requested_mode


def _lakebase_stores(
    config: LakebaseConnectionConfig,
) -> tuple[LakebaseValidatedSqlStore, LakebaseAnalyticsContextStore]:
    global _LAKEBASE_CACHE_KEY, _LAKEBASE_SQL_STORE, _LAKEBASE_ANALYTICS_STORE
    if not config.configured:
        raise ValueError(
            "Lakebase SQL knowledge is not configured. Add an instance name or autoscaling project and branch."
        )
    cache_key = (config.profile, config.instance_name, config.project, config.branch)
    if (
        _LAKEBASE_CACHE_KEY != cache_key
        or _LAKEBASE_SQL_STORE is None
        or _LAKEBASE_ANALYTICS_STORE is None
    ):
        client = create_lakebase_client(
            profile=config.profile,
            instance_name=config.instance_name,
            project=config.project,
            branch=config.branch,
        )
        _LAKEBASE_SQL_STORE = LakebaseValidatedSqlStore(client)
        _LAKEBASE_ANALYTICS_STORE = LakebaseAnalyticsContextStore(client)
        _LAKEBASE_CACHE_KEY = cache_key
    return _LAKEBASE_SQL_STORE, _LAKEBASE_ANALYTICS_STORE


def _pattern_key(item: dict[str, Any]) -> str:
    sql_hash = str(item.get("sql_hash") or "").strip().lower()
    if sql_hash:
        return f"hash:{sql_hash}"
    summary = str(item.get("summary") or "").strip().lower()
    business_question = str(item.get("business_question") or "").strip().lower()
    name = str(item.get("name") or "").strip().lower()
    source_path = str(item.get("source_path") or "").strip().lower()
    tables = ",".join(str(table).strip().lower() for table in item.get("tables", [])[:6])
    return "|".join([name, source_path, business_question, summary, tables])


def _merge_patterns(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in groups:
        for item in group:
            key = _pattern_key(item)
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)
    return merged


def _table_key(item: dict[str, Any]) -> str:
    return str(item.get("table_name") or "").strip().lower()


def _join_key(item: dict[str, Any]) -> str:
    return "|".join(
        [
            str(item.get("left_table") or "").strip().lower(),
            str(item.get("right_table") or "").strip().lower(),
            str(item.get("join_condition") or "").strip().lower(),
        ]
    )


def _metric_key(item: dict[str, Any]) -> str:
    return str(item.get("metric_name") or "").strip().lower()


def _filter_value_key(item: dict[str, Any]) -> str:
    return "|".join(
        [
            str(item.get("concept_name") or "").strip().lower(),
            str(item.get("source_table") or "").strip().lower(),
            str(item.get("column_name") or "").strip().lower(),
        ]
    )


def _merge_unique(
    key_fn,
    *groups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in groups:
        for item in group:
            key = key_fn(item)
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)
    return merged


class HybridValidatedSqlStore:
    def __init__(self, local_store: Any, lakebase_store: Any):
        self.local_store = local_store
        self.lakebase_store = lakebase_store

    def save_pattern(self, **kwargs):
        return self.local_store.save_pattern(**kwargs)

    def get_pattern(self, pattern_id: str, workspace_root: str):
        try:
            return self.local_store.get_pattern(pattern_id, workspace_root)
        except KeyError:
            return self.lakebase_store.get_pattern(pattern_id, workspace_root)

    def list_patterns(self, workspace_root: str):
        return _merge_patterns(
            self.local_store.list_patterns(workspace_root),
            self.lakebase_store.list_patterns(workspace_root),
        )

    def search_patterns(self, workspace_root: str, query: str, limit: int = 8):
        merged = _merge_patterns(
            self.local_store.search_patterns(workspace_root, query, limit),
            self.lakebase_store.search_patterns(workspace_root, query, limit),
        )
        return merged[: max(1, min(limit, 20))]

    def overview(self, workspace_root: str, limit: int = 10):
        local_patterns = self.local_store.list_patterns(workspace_root)
        lakebase_patterns = self.lakebase_store.list_patterns(workspace_root)
        combined = _merge_patterns(local_patterns, lakebase_patterns)
        table_counts: dict[str, int] = {}
        join_counts: dict[str, int] = {}
        metric_counts: dict[str, int] = {}
        for pattern in combined:
            for table in pattern.get("tables", []):
                table_counts[table] = table_counts.get(table, 0) + 1
            for join in pattern.get("joins", []):
                join_counts[join] = join_counts.get(join, 0) + 1
            for metric in pattern.get("metrics", []):
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
                "business_question": pattern.get("business_question", ""),
                "grain": pattern.get("grain", ""),
                "metrics": list(pattern.get("metrics", []))[:4],
                "tables": list(pattern.get("tables", []))[:6],
                "updated_at": pattern.get("updated_at"),
            }
            for pattern in combined[:limit]
        ]
        return {
            "workspace_root": str(Path(workspace_root).resolve()),
            "pattern_count": len(combined),
            "top_tables": top_tables,
            "top_joins": top_joins,
            "top_metrics": top_metrics,
            "recent_patterns": recent_patterns,
        }

    def search_by_table_or_join(self, workspace_root: str, query: str, limit: int = 8):
        merged = _merge_patterns(
            self.local_store.search_by_table_or_join(workspace_root, query, limit),
            self.lakebase_store.search_by_table_or_join(workspace_root, query, limit),
        )
        return merged[: max(1, min(limit, 20))]

    def suggest_filter_candidates(self, workspace_root: str, query: str = "", limit: int = 8):
        merged = _merge_unique(
            lambda item: "|".join(
                [
                    str(item.get("column_name") or "").strip().lower(),
                    str(item.get("operator") or "").strip().lower(),
                    str(item.get("canonical_value") or "").strip().lower(),
                ]
            ),
            self.local_store.suggest_filter_candidates(workspace_root, query, limit),
            self.lakebase_store.suggest_filter_candidates(workspace_root, query, limit),
        )
        return merged[: max(1, min(limit, 20))]

    def summarize_pattern(self, pattern: dict[str, Any]):
        return self.local_store.summarize_pattern(pattern)


class HybridAnalyticsContextStore:
    def __init__(self, local_store: Any, lakebase_store: Any):
        self.local_store = local_store
        self.lakebase_store = lakebase_store

    def upsert_table_context(self, **kwargs):
        return self.local_store.upsert_table_context(**kwargs)

    def upsert_join_context(self, **kwargs):
        return self.local_store.upsert_join_context(**kwargs)

    def upsert_metric_context(self, **kwargs):
        return self.local_store.upsert_metric_context(**kwargs)

    def upsert_filter_value_context(self, **kwargs):
        return self.local_store.upsert_filter_value_context(**kwargs)

    def search_tables(self, workspace_root: str, query: str, limit: int = 8):
        merged = _merge_unique(
            _table_key,
            self.local_store.search_tables(workspace_root, query, limit),
            self.lakebase_store.search_tables(workspace_root, query, limit),
        )
        return merged[: max(1, min(limit, 20))]

    def search_joins(self, workspace_root: str, query: str, limit: int = 8):
        merged = _merge_unique(
            _join_key,
            self.local_store.search_joins(workspace_root, query, limit),
            self.lakebase_store.search_joins(workspace_root, query, limit),
        )
        return merged[: max(1, min(limit, 20))]

    def search_metrics(self, workspace_root: str, query: str, limit: int = 8):
        merged = _merge_unique(
            _metric_key,
            self.local_store.search_metrics(workspace_root, query, limit),
            self.lakebase_store.search_metrics(workspace_root, query, limit),
        )
        return merged[: max(1, min(limit, 20))]

    def search_filter_values(self, workspace_root: str, query: str, limit: int = 8):
        merged = _merge_unique(
            _filter_value_key,
            self.local_store.search_filter_values(workspace_root, query, limit),
            self.lakebase_store.search_filter_values(workspace_root, query, limit),
        )
        return merged[: max(1, min(limit, 20))]

    def list_tables(self, workspace_root: str):
        return _merge_unique(
            _table_key,
            self.local_store.list_tables(workspace_root),
            self.lakebase_store.list_tables(workspace_root),
        )

    def list_joins(self, workspace_root: str):
        return _merge_unique(
            _join_key,
            self.local_store.list_joins(workspace_root),
            self.lakebase_store.list_joins(workspace_root),
        )

    def list_metrics(self, workspace_root: str):
        return _merge_unique(
            _metric_key,
            self.local_store.list_metrics(workspace_root),
            self.lakebase_store.list_metrics(workspace_root),
        )

    def list_filter_values(self, workspace_root: str):
        return _merge_unique(
            _filter_value_key,
            self.local_store.list_filter_values(workspace_root),
            self.lakebase_store.list_filter_values(workspace_root),
        )

    def overview(self, workspace_root: str, limit: int = 10):
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


def get_active_sql_store(
    *,
    headers: dict[str, str] | None = None,
):
    local_store = get_sql_store()
    requested_mode = (
        normalize_sql_knowledge_mode((headers or get_request_headers()).get(SQL_KNOWLEDGE_MODE_HEADER))
        if headers is not None
        else requested_sql_knowledge_mode()
    )
    config = lakebase_connection_config(headers)
    if requested_mode == "local":
        return local_store
    if requested_mode == "lakebase":
        lakebase_store, _ = _lakebase_stores(config)
        return lakebase_store
    try:
        lakebase_store, _ = _lakebase_stores(config)
    except Exception:
        return local_store
    return HybridValidatedSqlStore(local_store, lakebase_store)


def get_active_analytics_context_store(
    *,
    headers: dict[str, str] | None = None,
):
    local_store = get_analytics_context_store()
    requested_mode = (
        normalize_sql_knowledge_mode((headers or get_request_headers()).get(SQL_KNOWLEDGE_MODE_HEADER))
        if headers is not None
        else requested_sql_knowledge_mode()
    )
    config = lakebase_connection_config(headers)
    if requested_mode == "local":
        return local_store
    if requested_mode == "lakebase":
        _, lakebase_store = _lakebase_stores(config)
        return lakebase_store
    try:
        _, lakebase_store = _lakebase_stores(config)
    except Exception:
        return local_store
    return HybridAnalyticsContextStore(local_store, lakebase_store)


def _store_counts(sql_store: Any, analytics_store: Any, workspace_root: str) -> dict[str, int]:
    sql_overview = sql_store.overview(workspace_root, limit=1)
    analytics_overview = analytics_store.overview(workspace_root, limit=1)
    return {
        "validatedSqlPatterns": int(sql_overview.get("pattern_count") or 0),
        "analyticsTables": int(analytics_overview.get("table_count") or 0),
        "analyticsJoins": int(analytics_overview.get("join_count") or 0),
        "analyticsMetrics": int(analytics_overview.get("metric_count") or 0),
        "analyticsFilterValues": int(analytics_overview.get("filter_value_count") or 0),
    }


def sql_knowledge_runtime_config(
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    requested_mode = (
        normalize_sql_knowledge_mode((headers or get_request_headers()).get(SQL_KNOWLEDGE_MODE_HEADER))
        if headers is not None
        else requested_sql_knowledge_mode()
    )
    config = lakebase_connection_config(headers)
    try:
        available = config.configured
        if available:
            _lakebase_stores(config)
        lakebase_error: str | None = None
    except Exception as exc:
        available = False
        lakebase_error = str(exc)
    return {
        "requested_mode": requested_mode,
        "effective_mode": effective_sql_knowledge_mode(
            requested_mode, lakebase_available=available
        ),
        "profile": config.profile,
        "lakebase_instance_name": config.instance_name,
        "lakebase_project": config.project,
        "lakebase_branch": config.branch,
        "lakebase_configured": config.configured,
        "lakebase_available": available,
        "lakebase_error": lakebase_error,
    }


def sql_knowledge_status(
    *,
    workspace_root: str,
    requested_mode: SqlKnowledgeMode,
    config: LakebaseConnectionConfig,
) -> dict[str, Any]:
    normalized_workspace_root = normalize_sql_workspace_root(workspace_root)
    local_sql_store = get_sql_store()
    local_analytics_store = get_analytics_context_store()
    payload: dict[str, Any] = {
        "workspace_root": normalized_workspace_root,
        "requested_mode": requested_mode,
        "effective_mode": requested_mode,
        "profile": config.profile,
        "lakebase": {
            "configured": config.configured,
            "instance_name": config.instance_name,
            "project": config.project,
            "branch": config.branch,
            "available": False,
            "error": None,
        },
        "local": _store_counts(local_sql_store, local_analytics_store, normalized_workspace_root),
    }
    if requested_mode == "local":
        payload["active"] = payload["local"]
    if not config.configured:
        if requested_mode == "hybrid":
            payload["effective_mode"] = "local"
            payload["active"] = payload["local"]
        return payload
    try:
        lakebase_sql_store, lakebase_analytics_store = _lakebase_stores(config)
        payload["lakebase"]["available"] = True
        payload["lakebase"]["counts"] = _store_counts(
            lakebase_sql_store, lakebase_analytics_store, normalized_workspace_root
        )
    except Exception as exc:
        payload["lakebase"]["error"] = str(exc)
        if requested_mode == "hybrid":
            payload["effective_mode"] = "local"
        return payload

    if requested_mode == "hybrid":
        payload["effective_mode"] = "hybrid"
        hybrid_sql_store = HybridValidatedSqlStore(local_sql_store, lakebase_sql_store)
        hybrid_analytics_store = HybridAnalyticsContextStore(
            local_analytics_store,
            lakebase_analytics_store,
        )
        payload["active"] = _store_counts(
            hybrid_sql_store, hybrid_analytics_store, normalized_workspace_root
        )
    elif requested_mode == "lakebase":
        payload["active"] = payload["lakebase"]["counts"]
    else:
        payload["active"] = payload["local"]
    return payload


def sync_sql_knowledge(
    *,
    direction: Literal["push", "pull"],
    workspace_root: str,
    config: LakebaseConnectionConfig,
) -> dict[str, Any]:
    normalized_workspace_root = normalize_sql_workspace_root(workspace_root)
    local_sql_store = get_sql_store()
    local_analytics_store = get_analytics_context_store()
    lakebase_sql_store, lakebase_analytics_store = _lakebase_stores(config)

    if direction == "push":
        source_sql_store = local_sql_store
        source_analytics_store = local_analytics_store
        target_sql_store = lakebase_sql_store
        target_analytics_store = lakebase_analytics_store
        source_label = "local"
        target_label = "lakebase"
    else:
        source_sql_store = lakebase_sql_store
        source_analytics_store = lakebase_analytics_store
        target_sql_store = local_sql_store
        target_analytics_store = local_analytics_store
        source_label = "lakebase"
        target_label = "local"

    patterns = source_sql_store.list_patterns(normalized_workspace_root)
    for pattern in patterns:
        target_sql_store.save_pattern(
            workspace_root=normalized_workspace_root,
            name=str(pattern.get("name") or "Validated SQL pattern"),
            summary=str(pattern.get("summary") or ""),
            sql_text=str(pattern.get("sql_text") or ""),
            dialect=str(pattern.get("dialect") or "spark_sql"),
            source_path=pattern.get("source_path"),
            validation_notes=str(pattern.get("validation_notes") or ""),
            tags=list(pattern.get("tags", [])),
            business_question=str(pattern.get("business_question") or ""),
            grain=str(pattern.get("grain") or ""),
            semantic_notes=str(pattern.get("semantic_notes") or ""),
            dimensions=list(pattern.get("dimensions", [])),
            metrics=list(pattern.get("metrics", [])),
            filters=list(pattern.get("filters", [])),
            business_terms=list(pattern.get("business_terms", [])),
        )

    tables = source_analytics_store.list_tables(normalized_workspace_root)
    for table in tables:
        target_analytics_store.upsert_table_context(
            workspace_root=normalized_workspace_root,
            table_name=str(table.get("table_name") or ""),
            summary=str(table.get("summary") or ""),
            layer=str(table.get("layer") or ""),
            grain=str(table.get("grain") or ""),
            usage_notes=str(table.get("usage_notes") or ""),
            synonyms=list(table.get("synonyms", [])),
            important_columns=list(table.get("important_columns", [])),
            tags=list(table.get("tags", [])),
            source=str(table.get("source") or "manual"),
        )

    joins = source_analytics_store.list_joins(normalized_workspace_root)
    for join in joins:
        target_analytics_store.upsert_join_context(
            workspace_root=normalized_workspace_root,
            left_table=str(join.get("left_table") or ""),
            right_table=str(join.get("right_table") or ""),
            join_condition=str(join.get("join_condition") or ""),
            join_type=str(join.get("join_type") or ""),
            relationship=str(join.get("relationship") or ""),
            grain_notes=str(join.get("grain_notes") or ""),
            warnings=list(join.get("warnings", [])),
            tags=list(join.get("tags", [])),
            source=str(join.get("source") or "manual"),
        )

    metrics = source_analytics_store.list_metrics(normalized_workspace_root)
    for metric in metrics:
        target_analytics_store.upsert_metric_context(
            workspace_root=normalized_workspace_root,
            metric_name=str(metric.get("metric_name") or ""),
            definition=str(metric.get("definition") or ""),
            source_table=str(metric.get("source_table") or ""),
            default_time_column=str(metric.get("default_time_column") or ""),
            dimensions=list(metric.get("dimensions", [])),
            synonyms=list(metric.get("synonyms", [])),
            tags=list(metric.get("tags", [])),
            source=str(metric.get("source") or "manual"),
        )

    filter_values = source_analytics_store.list_filter_values(normalized_workspace_root)
    for filter_value in filter_values:
        target_analytics_store.upsert_filter_value_context(
            workspace_root=normalized_workspace_root,
            concept_name=str(filter_value.get("concept_name") or ""),
            canonical_value=str(filter_value.get("canonical_value") or ""),
            source_table=str(filter_value.get("source_table") or ""),
            column_name=str(filter_value.get("column_name") or ""),
            operator=str(filter_value.get("operator") or "="),
            sql_value_expression=str(filter_value.get("sql_value_expression") or ""),
            description=str(filter_value.get("description") or ""),
            synonyms=list(filter_value.get("synonyms", [])),
            tags=list(filter_value.get("tags", [])),
            source=str(filter_value.get("source") or "manual"),
        )

    return {
        "workspace_root": normalized_workspace_root,
        "direction": direction,
        "source": source_label,
        "target": target_label,
        "counts": {
            "validatedSqlPatterns": len(patterns),
            "analyticsTables": len(tables),
            "analyticsJoins": len(joins),
            "analyticsMetrics": len(metrics),
            "analyticsFilterValues": len(filter_values),
        },
        "targetStatus": sql_knowledge_status(
            workspace_root=normalized_workspace_root,
            requested_mode="lakebase" if target_label == "lakebase" else "local",
            config=config,
        ),
    }


def lakebase_user_facing_error(error: Exception) -> str:
    if isinstance(error, LakebaseDependencyError):
        return str(error)
    return str(error)
