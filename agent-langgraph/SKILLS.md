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
- `SKILL.md`: the actual instructions injected into the model when the skill is active
- optional supporting assets such as `templates/`, examples, or reference files

Example:

```text
skills/
  marp/
    skill.json
    SKILL.md
    templates/
      technical-walkthrough.md
      architecture-overview.md
      stakeholder-summary.md
  project-update/
    skill.json
    SKILL.md
    templates/
      daily-update.md
```

Example `skill.json`:

```json
{
  "name": "marp",
  "description": "Create Marp markdown presentations from repo context.",
  "triggers": [
    "marp",
    "presentation",
    "slides",
    "slide deck",
    "deck"
  ]
}
```

## How the backend uses skills

For each request, the backend:

1. Reads the current user turn.
2. Scans `skills/` for registered skills.
3. Selects skills conservatively when:
   - the user explicitly mentions the skill by name, like `marp` or `$marp`
   - or the user message contains one of the configured trigger phrases
4. Injects only the matching skill instructions into the current request as extra system context.

The base system prompt stays lean. Skill instructions are only included when they are relevant to the current turn.

## Why this exists

This keeps context higher-signal than putting every feature into one giant global prompt. It also makes it easier to add new capabilities incrementally, because each workflow can live in its own skill folder with its own templates and instructions.

## Current skills

- `marp`: creates Marp markdown presentations from repo context
- `project-update`: maintains daily status files and drafts concise ServiceNow-ready updates using repo and git context
