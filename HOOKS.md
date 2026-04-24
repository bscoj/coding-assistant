# Runtime Hooks

Coding Buddy now has a lightweight local hook system inspired by the hook
patterns in tools like Codex and Claude Code.

The goal is to keep the base prompt lean while still letting a repo provide:

- extra task-specific instructions
- local event tracing for debugging slow or noisy runs

## Built-in behavior

The backend emits local JSONL event records to:

- `.local/runtime_hook_events.jsonl`

Events include:

- `SessionStart`
- `BeforeAgent`
- `PromptBudget`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `ApprovalApplied`
- `Stop`
- `StopFailure`

This stays local to your machine.

`PromptBudget` records an estimated prompt-cost breakdown by block, including
items like repo instructions, profile memory, task scratchpad, tool memory,
conversation memory, and recent raw message context.

## Repo-local hook file

You can add a hook file to the selected repo at:

- `.coding-buddy/hooks.json`
- `.coding-buddy/hooks.local.json`

Example:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "instruction_file",
        "path": "docs/agent/session-start.md"
      }
    ],
    "BeforeAgent": [
      {
        "type": "instruction_text",
        "content": "Prefer package-level commands over root-level commands in this monorepo."
      }
    ]
  }
}
```

## Supported hook action types

### `instruction_text`

Inject a short system block before the agent run.

```json
{
  "type": "instruction_text",
  "content": "Always validate SQL changes against the gold layer first."
}
```

### `instruction_file`

Inject a markdown file from inside the selected repo.

```json
{
  "type": "instruction_file",
  "path": "docs/agent/sql-guidelines.md"
}
```

## Current scope

This version is intentionally conservative:

- hooks can inject instructions
- hooks do not run arbitrary shell commands
- tool/session events are logged locally for observability

If we want the next step after this, it should be controlled post-edit hooks for
formatting, linting, and tests.
