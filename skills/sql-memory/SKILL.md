# SQL Memory

Use the validated SQL store before broad repo exploration when the task is about:

- writing Spark SQL
- choosing tables for a business question
- reusing known-good joins
- recovering a query pattern you know worked before

## Workflow

1. Start with `validated_sql_store_overview()` when you need the overall shape of trusted patterns in this repo.
2. Use `search_validated_sql_patterns()` with:
   - business concepts
   - table names
   - join keys
   - filters
   - metric names
3. Use `search_validated_sql_by_table_or_join()` when you already know one table, alias, or join clue and want nearby trusted patterns fast.
4. Use `search_analytics_filter_values()` when the task mentions a plain-language concept, abbreviation, site, hospital, department, or business alias that should resolve to an exact SQL filter value.
5. If no curated filter mapping exists yet, use `suggest_filter_candidates_from_validated_sql()` to mine repeated exact-value filters from trusted SQL.
6. Search tools return lightweight summaries. If a hit looks promising, inspect only the best 1-2 candidates with `get_validated_sql_pattern()`.
7. Only fall back to broad file search when the validated store does not cover the task.
8. When the user confirms a query is correct, trusted, production-safe, or known-good, save it with:
   - `save_latest_assistant_sql_pattern()` when the SQL was just generated in chat
   - `save_validated_sql_from_chat_turn()` for a specific chat turn
   - `save_validated_sql_pattern()` for raw query text
   - `save_validated_sql_file()` for a repo SQL file
9. When the user explicitly wants durable business vocabulary or exact filter mappings saved, use `register_analytics_filter_value()`.

## Guidance

- Prefer trusted validated patterns over ad hoc table guessing.
- Prefer curated filter mappings over guessed string literals when the user gives a business alias or abbreviation.
- Treat mined filter candidates as suggestions, not truth, until they are promoted into curated filter mappings.
- Call out which stored patterns influenced your recommendation.
- Reuse extracted tables and join clauses directly when they fit the task.
- If a task appears to need bronze/silver/gold decisions, say which layer you chose and why.
- If there is no strong validated pattern, be explicit that you are switching back to repo exploration.
