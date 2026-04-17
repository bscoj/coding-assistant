# Project Update Skill

Use this skill when the user wants help planning the day, tracking progress, or generating a concise end-of-day update from repo work.

## Goals

- keep one daily project update file current
- capture planned work, completed work, in-progress work, blockers, and next steps
- use repo and git evidence when available instead of relying only on chat memory
- draft a short, paste-ready ServiceNow status summary
- stage update-file changes for approval before writing them

## Recommended Output Files

Prefer:

- `docs/project-updates/daily/YYYY-MM-DD.md`

Optionally maintain:

- `docs/project-updates/current-status.md`

unless the user asks for a different location.

## Modes

### 1. Plan

Use when the user is starting the day or wants to list intended tasks.

Capture:

- focus for today
- 2-5 concrete tasks
- known constraints or dependencies

### 2. Progress

Use when the user wants to refresh the daily file based on work already done.

Update:

- completed work
- in-progress work
- blockers / risks
- next steps

### 3. Report

Use when the user wants a polished status update for ServiceNow or another reporting system.

Produce:

- a short, direct summary
- no filler
- no exaggerated claims
- mention blockers if they matter

## Repo / Git Awareness

When the selected workspace is a git repo, prefer using:

- `git_repo_summary()`
- `workspace_overview()`
- `find_files_by_name()`
- `search_files()`
- `recent_file_reads()`
- `read_file()`

Use git evidence to ground the update:

- branch name
- changed files
- diff summary
- recent commits

Use repo context to improve the wording:

- which systems or modules were touched
- what user-facing or engineering outcome changed
- what remains unfinished

Do not overclaim. If git evidence is ambiguous, say "likely completed" or keep the wording neutral.

## Writing Rules

- be concise, clear, and professional
- write like a human engineer giving a real project update
- avoid generic AI phrasing
- prefer concrete outcomes over implementation trivia
- keep the ServiceNow draft to a short paragraph or tight bullet list

## Daily File Structure

Use a structure like:

```md
# Project Update - YYYY-MM-DD

## Focus For Today
- ...

## Work Completed
- ...

## In Progress
- ...

## Blockers / Risks
- ...

## Next Steps
- ...

## ServiceNow Draft
- ...
```

## Workflow

1. Identify whether the user wants `plan`, `progress`, or `report`.
2. Inspect the repo and git summary when relevant.
3. Draft or update the daily markdown file.
4. Include a polished `ServiceNow Draft` section.
5. Stage the file change for approval.

## Non-Goals

- Do not silently mark work complete without evidence.
- Do not turn this into a heavy project-management system.
- Do not overwrite history from previous days.
