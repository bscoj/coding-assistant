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
    background: linear-gradient(145deg, #161b22 0%, #0f1115 70%);
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
  p, li {
    color: #d9dee5;
    line-height: 1.45;
  }
  strong {
    color: #8ce6b0;
  }
  code {
    background: #171b22;
    color: #d7f9e5;
    border: 1px solid #2b3240;
    border-radius: 8px;
    padding: 0.12em 0.35em;
  }
  .eyebrow {
    color: #8ce6b0;
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  section::after {
    color: #6c7685;
    font-size: 0.68rem;
  }
---

<!-- _class: lead -->

<div class="eyebrow">Architecture Review</div>

# Architecture Overview

## Repo / System Name

- audience
- scope
- the main architectural question this deck answers

---

# System At A Glance

## The shortest correct explanation

- who interacts with the system
- what the major components are
- what the system is fundamentally responsible for

---

# High-Level Flow

## Boundaries and handoffs

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
  A["Client / Caller"] --> B["UI or API boundary"]
  B --> C["Core service"]
  C --> D["Model / tools / business logic"]
  C --> E["Persistence / state"]
```

---

# Major Components

## What each part owns

- component A: purpose
- component B: purpose
- component C: purpose
- component D: purpose

---

# Data And State

## Where the system remembers things

- what state is persisted
- where context or memory lives
- how configuration flows through the system

---

# Integration Points

## External boundaries

- model providers or external APIs
- auth or identity boundaries
- filesystem / storage access
- deployment assumptions

---

# Tradeoffs

## What shaped the current design

- an intentional design choice
- a constraint that forced complexity
- the most likely weak spot

---

# Recommended Improvements

## What to do next

- what to harden
- what to simplify
- what to scale
