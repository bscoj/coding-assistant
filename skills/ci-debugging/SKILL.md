# CI Debugging

Use this workflow when the user asks why CI/CD, GitHub Actions, or a build pipeline is failing.

## Workflow

1. Start with `ci_repo_overview()` to get the workflow map, referenced scripts, local actions, manifests, and recommended first reads.
2. Read the failing workflow file first, then follow only the files it references:
   - reusable workflows
   - local actions
   - referenced scripts
   - supporting manifests like `package.json`, `pyproject.toml`, `Dockerfile`, or `Makefile`
3. Prefer the files listed in `recommended_first_reads` before broad repo exploration.
4. Use `git_repo_summary()` if recent changes may explain the regression.
5. Use targeted `search_files()` or `search_code_blocks()` only for the workflow step, command, or script you are tracing.
6. Synthesize the likely failure path before proposing fixes.

## Guidance

- Do not read the whole repo to debug one workflow.
- Reuse `recent_file_reads()` instead of reopening the same YAML or script ranges.
- If the overview shows missing local references, call that out immediately because it may explain the failure without deeper reading.
- If reusable workflows or local actions are present, assume the real bug may live there rather than in the top-level workflow file.
