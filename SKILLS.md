# Local Skills

This project supports local runtime skills so we can add focused capabilities without bloating the always-on system prompt.

## What "registered" means

A skill is considered registered when it exists on disk under:

- `skills/<skill-name>/skill.json`
- `skills/<skill-name>/SKILL.md`

There is no database or separate admin step in the current implementation. The backend scans the `skills/` directory at request time and loads any skill folder that contains both files.

## Skill format

Each skill folder contains:

- `skill.json`: metadata used for discovery and matching
- `SKILL.md`: the instructions injected into the model when the skill is active
- optional supporting assets such as `templates/`, examples, or reference files

Example:

```text
skills/
  project-update/
    skill.json
    SKILL.md
    templates/
      daily-update.md
```

Example `skill.json`:

```json
{
  "name": "project-update",
  "description": "Maintain daily status files and draft concise ServiceNow-ready updates using repo and git context.",
  "triggers": [
    "project update",
    "daily update",
    "status update",
    "servicenow update"
  ]
}
```

## How the backend uses skills

For each request, the backend:

1. Reads the current user turn.
2. Scans `skills/` for registered skills.
3. Selects skills conservatively when:
   - the user explicitly mentions the skill by name
   - or the user message contains one of the configured trigger phrases
4. Injects only the matching skill instructions into the current request as extra system context.

The base system prompt stays lean. Skill instructions are only included when they are relevant to the current turn.

## Why this exists

This keeps context higher-signal than putting every feature into one giant global prompt. It also makes it easier to add new capabilities incrementally, because each workflow can live in its own skill folder with its own instructions and templates.

## Current skills

- `project-update`: maintains daily status files and drafts concise ServiceNow-ready updates using repo and git context
- `ml-engineer`: helps the agent reason like a strong senior ML engineer and teacher for repo reviews, modeling tradeoffs, leakage checks, and ML design questions
- `experiment-review`: helps the agent interpret metrics, compare baselines, and recommend the next best experiments
- `production-readiness`: helps the agent review serving, batch scoring, MLflow lineage, monitoring, rollback, and deployment hardening
- `sql-memory`: helps the agent reuse validated SQL patterns, tables, and joins before searching the repo from scratch
