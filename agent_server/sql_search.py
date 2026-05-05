from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

TOKEN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_.$/-]*|\d+")

STOP_WORDS = {
    "about",
    "across",
    "after",
    "against",
    "all",
    "also",
    "and",
    "any",
    "are",
    "as",
    "at",
    "based",
    "be",
    "before",
    "between",
    "build",
    "by",
    "can",
    "count",
    "counts",
    "create",
    "data",
    "dataset",
    "datasets",
    "does",
    "each",
    "find",
    "for",
    "from",
    "get",
    "give",
    "group",
    "have",
    "how",
    "into",
    "is",
    "it",
    "join",
    "joins",
    "latest",
    "like",
    "list",
    "look",
    "make",
    "many",
    "metric",
    "metrics",
    "need",
    "only",
    "order",
    "per",
    "query",
    "rate",
    "return",
    "rows",
    "search",
    "show",
    "sql",
    "table",
    "tables",
    "that",
    "the",
    "then",
    "this",
    "total",
    "using",
    "want",
    "where",
    "with",
}


def sql_keyword_terms(query: str, *, max_terms: int = 8) -> list[str]:
    """Return focused SQL-knowledge search terms instead of one brittle phrase."""
    raw_tokens = TOKEN_PATTERN.findall(query.strip())
    terms: list[str] = []

    for raw_token in raw_tokens:
        token = raw_token.strip(" .,;:()[]{}'\"`").lower()
        if not token:
            continue

        candidates = [token]
        if any(separator in token for separator in ("_", ".", "$", "/", "-")):
            candidates.extend(
                part
                for part in re.split(r"[_.$/-]+", token)
                if part and part != token
            )

        for candidate in candidates:
            if _skip_term(candidate):
                continue
            terms.append(candidate)
            singular = _singular_variant(candidate)
            if singular and not _skip_term(singular):
                terms.append(singular)

    return _dedupe(terms, limit=max_terms)


def keyword_fanout_search(
    *,
    query: str,
    search_fn: Callable[[str, int], list[dict[str, Any]]],
    limit: int,
    max_terms: int = 8,
    per_term_limit: int | None = None,
) -> dict[str, Any]:
    bounded_limit = max(1, min(limit, 20))
    terms = sql_keyword_terms(query, max_terms=max_terms)
    if not terms:
        terms = [query.strip()]

    term_results: list[tuple[str, list[dict[str, Any]]]] = []
    for term in terms:
        results = search_fn(term, per_term_limit or bounded_limit)
        term_results.append((term, results))

    return {
        "search_terms": terms,
        "results": merge_ranked_results(term_results, limit=bounded_limit),
    }


def merge_ranked_results(
    term_results: list[tuple[str, list[dict[str, Any]]]],
    *,
    limit: int,
) -> list[dict[str, Any]]:
    ranked: dict[str, dict[str, Any]] = {}
    term_count = max(1, len(term_results))

    for term_index, (term, results) in enumerate(term_results):
        term_weight = term_count - term_index
        for result_index, result in enumerate(results):
            key = _result_key(result)
            entry = ranked.get(key)
            if entry is None:
                entry = {
                    "result": dict(result),
                    "score": 0,
                    "matched_terms": [],
                }
                ranked[key] = entry

            entry["score"] += (term_weight * 100) + max(0, 30 - result_index)
            if term not in entry["matched_terms"]:
                entry["matched_terms"].append(term)

            use_count = result.get("use_count")
            if isinstance(use_count, int):
                entry["score"] += min(use_count, 20)

    sorted_entries = sorted(
        ranked.values(),
        key=lambda item: (-int(item["score"]), _result_label(item["result"])),
    )
    merged: list[dict[str, Any]] = []
    for entry in sorted_entries[: max(1, min(limit, 20))]:
        result = dict(entry["result"])
        result["matched_terms"] = list(entry["matched_terms"])[:8]
        merged.append(result)
    return merged


def _dedupe(values: list[str], *, limit: int) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
        if len(deduped) >= limit:
            break
    return deduped


def _skip_term(term: str) -> bool:
    if term in STOP_WORDS:
        return True
    if len(term) < 2 and not term.isdigit():
        return True
    if term.isdigit() and len(term) < 4:
        return True
    return False


def _singular_variant(term: str) -> str | None:
    if len(term) <= 4:
        return None
    if term.endswith("ies"):
        return f"{term[:-3]}y"
    if term.endswith("sses"):
        return term[:-2]
    if term.endswith("s") and not term.endswith("ss"):
        return term[:-1]
    return None


def _result_key(result: dict[str, Any]) -> str:
    result_id = str(result.get("id") or "").strip()
    if result_id:
        return f"id:{result_id}"
    fields = [
        "name",
        "table_name",
        "metric_name",
        "concept_name",
        "canonical_value",
        "column_name",
        "operator",
        "left_table",
        "right_table",
        "join_condition",
    ]
    return "|".join(str(result.get(field) or "").strip().lower() for field in fields)


def _result_label(result: dict[str, Any]) -> str:
    for field in ("name", "table_name", "metric_name", "concept_name", "summary"):
        value = str(result.get(field) or "").strip().lower()
        if value:
            return value
    return _result_key(result)
