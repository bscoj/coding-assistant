# Marp Skill

Use this skill when the user asks for a Marp presentation, slide deck, walkthrough, architecture presentation, or stakeholder summary from the selected repo.

## Goals

- inspect the selected repo
- identify the right audience and story
- propose an outline first unless the user explicitly asks for direct generation
- generate valid Marp markdown
- stage the resulting deck file for approval before writing it

## Workflow

1. Understand the audience and purpose if the user provided them.
2. Inspect the repo using repo-aware tools:
   - `workspace_overview()`
   - `find_files_by_name()`
   - `search_files()`
   - `search_code_blocks()`
   - `read_file()`
3. Build a short outline first:
   - title
   - audience
   - objective
   - 6-10 slides unless otherwise requested
4. Generate a Marp deck in markdown.
5. Prefer writing to:
   - `docs/presentations/<slug>.md`
   unless the user asks for another location.
6. Use staged file writes for deck creation.

## Marp Rules

- Include valid frontmatter:

```md
---
marp: true
theme: default
paginate: true
size: 16:9
---
```

- Separate slides with `---`
- Keep slides concise
- Prefer one idea per slide
- Prefer small targeted code snippets over large dumps
- Use repo evidence, not generic filler
- Tailor deck depth to the audience

## Templates

Use the templates in this skill directory as references:

- `templates/technical-walkthrough.md`
- `templates/architecture-overview.md`
- `templates/stakeholder-summary.md`

Do not copy them blindly. Adapt them to the repo and request.

## Deck Types

- Technical walkthrough
- Architecture overview
- Stakeholder summary

## Non-Goals

- Do not automatically render/export PDF, HTML, or PPTX
- Do not overstuff slides with implementation detail

