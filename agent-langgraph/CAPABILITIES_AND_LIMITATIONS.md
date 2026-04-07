# Capabilities And Limitations

This document describes what the local coding-agent app can and cannot do today. It is intended to make the behavior clear for engineering review and cybersecurity review.

## Architecture

The app has two main parts:

- a local chat UI
- a local Python agent server

The UI runs locally and proxies chat requests to the local agent server. The agent server calls Databricks Model Serving endpoints for LLM inference.

## What The App Can Do

### Conversation handling

- Store full conversation history locally in SQLite.
- Build reduced model context from:
  - recent raw messages
  - rolling conversation summary
  - structured conversation facts
- Persist a global user profile across conversations.
- Persist a project-specific profile for the currently selected repo.

### Filesystem access

- Read files inside the configured workspace root.
- Search file contents inside the configured workspace root.
- List files and directories inside the configured workspace root.
- Build a cached index of the selected repo structure.
- Stage edits to existing files.
- Stage creation of new files.
- Stage grouped multi-file change plans.

### UI features

- Let the user choose the active repo from the UI.
- Restrict file tools to that selected repo.
- Show approval cards with:
  - change summary
  - rationale
  - risk label
  - diff preview
- Require explicit user approval through `Allow` or `Deny`.
- Let the user inspect and edit persistent profile memory from the UI.

## What The App Cannot Do

### No shell or terminal execution

The app does not expose a shell tool.

It cannot:

- run terminal commands
- run tests
- run linters
- run formatters
- execute package-manager commands
- spawn local processes on the user machine

### No silent file modification

The app cannot directly write files without an approval step.

All file changes are staged first. A file change is only applied after the user explicitly clicks `Allow` in the UI approval card.

### No access outside the selected repo

The app cannot read or write arbitrary files on the machine.

Filesystem tools are restricted to a single workspace root. In normal use, that workspace root is the repo selected in the UI. The backend enforces the path boundary and rejects paths outside the selected repo.

### No autonomous external actions

The app does not:

- open applications
- browse arbitrary websites as a tool
- call arbitrary external APIs as a tool
- make system configuration changes
- install software
- manage secrets automatically

## Databricks Dependencies

The app depends on Databricks for model inference.

It requires:

- Databricks authentication configured on the local machine
- one reachable Databricks Model Serving endpoint for the main agent

Optional:

- a separate endpoint for memory summarization
- a separate endpoint for persistent profile extraction

If the memory/profile extraction endpoints are unavailable, the app continues to serve chat requests and keeps local history. Only the derived memory refresh steps are skipped.

## Data Stored Locally

The app stores local state on disk.

Typical files:

- `.local/conversation_memory.db`
- `.local/user_profile.json`
- `.local/project_profiles/*.json`
- `.local/staged_writes.json`
- `.local/workspace_index.json`

These files are local development artifacts and should not be committed.

## Write Approval Model

The write path is intentionally narrow:

1. The agent proposes a change.
2. The backend stores the exact staged change set locally.
3. The UI shows the change for review.
4. The user clicks `Allow` or `Deny`.
5. Only an allowed staged change is applied.

Important properties:

- approval is per staged change set
- approval does not grant broad future write access
- a denied change does not modify files
- the backend applies only the exact staged content that was reviewed

## Memory Model

There are three memory layers:

- conversation memory
  - scoped to one conversation
  - rolling summary plus structured facts
- persistent user profile
  - scoped across all conversations
  - stores durable user preferences and facts
- project profile
  - scoped to one selected repo
  - stores durable repo conventions and constraints

Raw transcripts remain the source of truth for conversation memory.

## Security Boundary Summary

Current trust boundaries:

- repo scoping is enforced in the backend, not only in the UI
- file writes require explicit user approval
- no shell execution capability is present
- local memory is stored on disk under `.local`
- model inference happens through Databricks endpoints, not local model execution

## Operational Risks To Understand

This app is safer than a fully autonomous coding agent, but it still has meaningful behavior to review.

Risks that remain:

- the model can propose risky code edits inside the selected repo
- sensitive information inside the selected repo can be read by the model if the agent chooses to inspect it
- persistent profile memory may retain user preferences or facts longer than intended unless reviewed
- local state files may contain sensitive development context if the repo itself is sensitive

## Recommended Controls

Recommended operating controls:

- only point the app at repos you are comfortable exposing to the configured Databricks model endpoint
- keep `.env` and `.local/` out of version control
- review all write approval cards before clicking `Allow`
- use a dedicated Databricks endpoint for this app if your organization wants tighter auditability
- periodically review and prune the global and project profile memory

## Current Non-Goals

The app is not currently trying to be:

- a fully autonomous agent
- a remote code execution agent
- a machine-wide assistant
- a background automation runner
- a privilege-escalation tool

Its current design goal is narrower:

- inspect code in one selected repo
- reason over code with Databricks-hosted LLMs
- prepare edits
- apply only user-approved edits
