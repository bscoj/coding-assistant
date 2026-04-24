from __future__ import annotations

from typing import Any


PLAYBOOKS = {
    "explore": """Active workflow: repository exploration

- Stay in exploration mode until you can give one coherent answer.
- Build a map first: docs/readme, config, entrypoints, key packages, and tests.
- Chain a few high-signal reads together before answering.
- Synthesize architecture, important flows, risks, and any real gaps instead of narrating every step.""",
    "implement": """Active workflow: implementation

- Confirm the target behavior from the request and inspect the minimum files needed.
- Prefer the smallest correct change set over broad refactors.
- Reuse recent reads and targeted searches instead of rereading large files.
- When edits are needed, stage them cleanly and explain the impact plus the best validation step.""",
    "debug": """Active workflow: debugging

- Anchor on the concrete symptom first: error text, failing path, or incorrect behavior.
- Find the producing code path, likely root cause, and the smallest fix that changes the outcome.
- Call out assumptions, missing evidence, and the most useful verification step.
- Avoid speculative fixes when the repo evidence is incomplete.""",
    "review": """Active workflow: code review

- Findings come first, ordered by severity.
- Focus on bugs, regressions, risky assumptions, and missing validation.
- Reference specific files and lines when possible.
- Keep the summary short after the findings.""",
    "plan": """Active workflow: planning

- Break the work into a small sequence of concrete steps.
- Surface tradeoffs, dependencies, and unknowns before recommending an approach.
- Prefer executable, repo-specific plans over abstract brainstorming.
- If implementation follows, make the next coding step obvious.""",
}


def _latest_user_text(request_items: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for item in request_items:
        if item.get("role") != "user":
            continue
        content = item.get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    parts.append(part["text"])
    return " ".join(parts).strip().lower()


def build_playbook_blocks(request_items: list[dict[str, Any]]) -> list[str]:
    latest = _latest_user_text(request_items)
    if not latest:
        return []

    selected: list[str] = []

    if any(
        token in latest
        for token in (
            "review",
            "code review",
            "look for bugs",
            "review this",
            "find issues",
        )
    ):
        selected.append("review")

    if any(
        token in latest
        for token in (
            "error",
            "failing",
            "failed",
            "bug",
            "broken",
            "traceback",
            "stack trace",
            "can't connect",
            "cannot connect",
            "slow",
        )
    ):
        selected.append("debug")

    if any(
        token in latest
        for token in (
            "explore",
            "inspect",
            "understand",
            "walk me through",
            "explain the repo",
            "repo overview",
            "what does this do",
            "how does this work",
        )
    ):
        selected.append("explore")

    if any(
        token in latest
        for token in (
            "plan",
            "roadmap",
            "brainstorm",
            "design",
            "approach",
            "how should we",
        )
    ):
        selected.append("plan")

    if any(
        token in latest
        for token in (
            "implement",
            "fix",
            "change",
            "update",
            "add",
            "build",
            "create",
            "refactor",
            "write",
        )
    ):
        selected.append("implement")

    deduped: list[str] = []
    for name in selected:
        if name not in deduped:
            deduped.append(name)

    if not deduped:
        return []

    # Keep context focused: at most two concise workflow blocks.
    return [PLAYBOOKS[name] for name in deduped[:2] if name in PLAYBOOKS]
