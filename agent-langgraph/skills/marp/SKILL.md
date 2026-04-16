# Marp Skill

Use this skill when the user asks for a Marp presentation, slide deck, walkthrough, architecture presentation, or stakeholder summary from the selected repo.

## Goals

- inspect the selected repo
- identify the right audience and story
- propose an outline first unless the user explicitly asks for direct generation
- generate valid Marp markdown
- generate decks that feel polished, deliberate, and aligned with the app's dark visual style
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

- Include valid frontmatter.
- Include a `style:` block in the frontmatter so the deck has an intentional visual system by default.
- Separate slides with `---`
- Keep slides concise.
- Prefer one idea per slide.
- Prefer small targeted code snippets over large dumps.
- Use repo evidence, not generic filler.
- Tailor deck depth to the audience.

Minimum frontmatter pattern:

```md
---
marp: true
theme: default
paginate: true
size: 16:9
style: |
  section {
    background: #0f1115;
    color: #f3f5f7;
    font-family: "Aptos", "Segoe UI", sans-serif;
    padding: 56px 64px;
  }
  h1 {
    color: #ffffff;
    font-size: 2.05rem;
    margin-bottom: 0.18em;
  }
  h2 {
    color: #8ce6b0;
    font-size: 0.95rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 0.5em;
  }
  h3, strong {
    color: #8ce6b0;
  }
  p, li {
    color: #d9dee5;
    line-height: 1.45;
  }
  code {
    background: #171b22;
    color: #d7f9e5;
    border: 1px solid #2b3240;
    border-radius: 8px;
    padding: 0.12em 0.35em;
  }
  pre {
    background: #11161d;
    border: 1px solid #2a313d;
    border-radius: 16px;
    padding: 18px 20px;
  }
  pre code {
    background: transparent;
    border: 0;
    color: #e8edf3;
    padding: 0;
  }
  blockquote {
    border-left: 4px solid #8ce6b0;
    color: #e6f5ed;
    margin: 1em 0;
    padding-left: 1em;
  }
  section::after {
    color: #6c7685;
    font-size: 0.68rem;
  }
---
```

## Visual Direction

The presentation should feel like the app:

- dark, minimal, and polished
- high contrast, not washed out
- intentional accent color, not default corporate blue
- technical and confident, not generic and fluffy

Default visual language:

- background: charcoal / near-black
- text: soft white / light gray
- accent: muted green similar to the app chrome
- code blocks: dark neutral surfaces with bright readable text

Avoid:

- generic AI deck phrasing
- giant centered bullet dumps
- rainbow accent colors
- glossy startup gradients
- generic stock-illustration vibes
- filler slides like "In conclusion" or "Thank you" unless explicitly requested

## Slide Craft Rules

- Prefer 5-9 strong slides over 12 weak ones.
- Keep bullets to 2-4 per slide when possible.
- Each slide should answer one question clearly.
- Use specific repo language: real file names, modules, workflows, and tradeoffs.
- If a slide uses code, keep it to the minimum snippet that proves the point.
- If a slide uses a diagram, keep the node count low and the flow obvious.
- Prefer strong titles over vague ones like "Overview" or "Details".
- Mix slide rhythms: use a lead slide, a few explanation slides, one diagram slide, one code or implementation slide, and one tradeoffs/next-steps slide.

## Diagram Rules

When using Mermaid:

- prefer left-to-right flowcharts
- keep diagrams under 6-7 nodes unless the user asks for more detail
- use short labels
- emphasize boundaries and handoffs
- avoid crisscrossing arrows

Use Mermaid init config similar to:

````md
```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "background": "#0f1115",
    "primaryColor": "#171b22",
    "primaryBorderColor": "#8ce6b0",
    "primaryTextColor": "#f3f5f7",
    "lineColor": "#9aa4b2",
    "secondaryColor": "#11161d",
    "tertiaryColor": "#0f1115"
  }
}}%%
flowchart LR
  A["Client"] --> B["UI"]
  B --> C["Agent Server"]
  C --> D["Model + Tools"]
```
````

## Presentation Tone

- sound like a sharp human technical presenter
- be direct and grounded
- state tradeoffs honestly
- do not oversell
- do not use generic hype language like "revolutionary", "seamless", or "cutting-edge" unless the user explicitly wants marketing tone

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
