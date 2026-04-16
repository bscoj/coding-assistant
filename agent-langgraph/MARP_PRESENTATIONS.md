# Marp Presentation Support

This repo now includes first-class support for creating [Marp](https://marp.app/) markdown presentations from the selected repo context.

## What The Agent Can Do

The agent can:

- inspect the selected repo
- propose a presentation outline
- generate a Marp markdown deck
- revise the deck based on feedback
- stage the deck file for approval before writing it

The first version is intentionally markdown-first:

- it generates `.md` Marp decks
- it does not automatically render/export PDF, HTML, or PPTX

## Recommended Prompts

Examples:

- `Create a Marp deck explaining this repo to engineers`
- `Make a 7-slide architecture presentation from this project`
- `Create a stakeholder summary deck for this repo`
- `Propose an outline for a Marp walkthrough of this codebase`
- `Write the full deck in docs/presentations/architecture-overview.md`

## Default Workflow

When asked for a presentation, the agent should:

1. inspect the repo with repo-aware tools
2. propose an outline first unless the user asks for direct generation
3. generate a valid Marp markdown file
4. stage the deck file for approval

## Templates

Starter templates live in:

- `skills/marp/templates/technical-walkthrough.md`
- `skills/marp/templates/architecture-overview.md`
- `skills/marp/templates/stakeholder-summary.md`

Runtime skill instructions live in:

- `skills/marp/SKILL.md`

The agent should use these as structural references, not as rigid output.

## Output Conventions

Recommended default path:

- `docs/presentations/<slug>.md`

Recommended Marp frontmatter:

```md
---
marp: true
theme: default
paginate: true
size: 16:9
---
```

## Guidance

- keep slides concise
- prefer 6-10 slides unless the user specifies otherwise
- use small targeted code snippets instead of large file dumps
- use repo evidence, not generic filler
- adapt deck depth to the audience
