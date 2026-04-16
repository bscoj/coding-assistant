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
  section.lead {
    background: radial-gradient(circle at top right, #1a2029 0%, #0f1115 58%);
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
  ul {
    margin-top: 0.45em;
  }
  li {
    margin: 0.32em 0;
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
  .eyebrow {
    color: #8ce6b0;
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .muted {
    color: #aab4c0;
  }
  section::after {
    color: #6c7685;
    font-size: 0.68rem;
  }
---

<!-- _class: lead -->

<div class="eyebrow">Technical Walkthrough</div>

# Project Technical Walkthrough

## Repo / Project Name

- what the project does
- who this walkthrough is for
- what the audience should understand by the end

---

# Why This Repo Exists

## Problem and purpose

- what problem the repo solves
- what workflow or user need it supports
- why the current structure matters

---

# Repo Shape

## Where the important logic lives

- main backend entrypoint or service layer
- UI surface or API boundary
- config / deployment / infrastructure files
- docs or guides that anchor the workflow

---

# Request Or Execution Flow

## How the system actually moves

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "background": "#0f1115",
    "primaryColor": "#171b22",
    "primaryBorderColor": "#8ce6b0",
    "primaryTextColor": "#f3f5f7",
    "lineColor": "#98a3b3",
    "secondaryColor": "#11161d",
    "tertiaryColor": "#0f1115"
  }
}}%%
flowchart LR
  A["Entry point"] --> B["Core service"]
  B --> C["Model / business logic"]
  B --> D["Persistence / output"]
```

---

# Important Modules

## The pieces that carry the most weight

- module 1: responsibility and why it matters
- module 2: responsibility and why it matters
- module 3: responsibility and why it matters

```ts
// Keep code samples short and specific.
// Show only the snippet that explains the architecture point.
```

---

# Local Development Flow

## How we work with it

- how to run it locally
- key environment or configuration assumptions
- the most common contributor loop

---

# Design Tradeoffs

## What is elegant vs what is messy

- key implementation tradeoff
- operational or UX risk
- where the design is still evolving

---

# What Should Happen Next

## Practical follow-up

- what to harden next
- what to simplify next
- where the roadmap should go from here
