# Coding Buddy

Local-first repo-aware coding assistant for our team.

This project runs a local chat app and a local Python agent server, then uses Databricks Model Serving for LLM inference. In practice that means:

- the UI runs on your machine
- repo browsing and file editing happen on your machine
- conversation memory and profile state are stored locally
- model calls go to Databricks

If you want the fastest path from clone to working app, start with [TEAM_SETUP.md](TEAM_SETUP.md).

## What It Does

Coding Buddy is built to help with day-to-day repo work:

- inspect a selected local repo
- search and read files in that repo
- propose file edits with explicit approval
- keep local conversation memory
- keep shared user and project preferences
- help with daily project updates through the `project-update` skill

## Local Architecture

Running `uv run start-app` starts three processes:

- Python agent backend: `http://localhost:8000`
- UI backend: `http://localhost:3001`
- frontend: `http://localhost:3002`

The request flow is:

1. browser talks to the local frontend
2. frontend talks to the local UI backend
3. UI backend proxies agent requests to the local Python backend
4. Python backend calls Databricks Model Serving for inference

## Quick Start

1. Clone the repo.
2. Install prerequisites:
   - `uv`
   - Node 20 via `nvm`
   - Databricks CLI
3. Copy the env file:

```bash
cp .env.example .env
```

4. Authenticate to Databricks with a named profile:

```bash
databricks auth login --profile DEFAULT --host https://<your-workspace>.databricks.com
databricks auth profiles
```

5. Set the same profile in `.env`:

```bash
DATABRICKS_CONFIG_PROFILE=DEFAULT
```

6. Fill in the required `.env` values:
   - `AGENT_MODEL_ENDPOINT`
   - `MLFLOW_EXPERIMENT_ID` if you want tracing/feedback
   - optional endpoint overrides for memory/profile extraction

7. Initialize local storage:

```bash
uv run init-local
```

8. Start the app:

```bash
uv run start-app
```

9. Open:

```text
http://localhost:3002
```

## Team Onboarding

For a full start-to-finish setup guide for teammates, see [TEAM_SETUP.md](TEAM_SETUP.md).

That guide covers:

- prerequisites
- Databricks auth with `--profile`
- `.env` setup
- local startup
- ports
- common troubleshooting
- what is stored locally

## Core Features

### Repo-aware coding workflow

- choose the active repo from the UI
- keep filesystem access scoped to that repo
- inspect files, search code, and read targeted snippets
- stage edits before writing anything

### Approval-based file changes

- all writes are staged first
- the UI shows a review card before changes apply
- the user must click `Allow`
- denied changes are not written

### Local memory

- conversation memory is stored locally in SQLite
- Work mode keeps a larger recent raw-message window before summarizing older turns
- Balanced mode keeps a smaller raw window to reduce token usage
- user profile is stored locally as JSON
- project profile is stored locally as JSON
- local chat history can be stored without a database

You can switch memory behavior from `Profile -> Work mode memory`.
Use Work mode for real coding sessions where the agent needs to remember generated code, file paths, decisions, and implementation details across a longer thread.

Use `Profile -> Fresh session` when you want a clean chat that ignores durable user/project profile memory. Fresh mode still lets the current chat remember itself, but it does not inject or update cross-chat profile facts.

### Project update skill

The repo includes one runtime skill today:

- `project-update`

It helps:

- create a daily update file
- refresh status from repo and git activity
- draft a concise ServiceNow-style update

See:

- [SKILLS.md](SKILLS.md)
- [skills/project-update/SKILL.md](skills/project-update/SKILL.md)

## Configuration

The main local config lives in:

- [.env.example](.env.example)
- `.env` after you copy it locally

Most important settings:

- `DATABRICKS_CONFIG_PROFILE`
- `DATABRICKS_HOST` if needed
- `AGENT_MODEL_ENDPOINT`
- `AGENT_AVAILABLE_MODEL_ENDPOINTS`
- `MEMORY_MODE` (`work` or `balanced`)
- `CONTEXT_MODE` (`personalized` or `fresh`)
- `MEMORY_WORK_RECENT_MESSAGES`
- `MEMORY_RECENT_MESSAGES`
- `MEMORY_MODEL_ENDPOINT` optional
- `USER_PROFILE_MODEL_ENDPOINT` optional
- `CHAT_APP_SERVER_PORT`
- `CHAT_APP_CLIENT_PORT`

## Common Commands

Initialize local files:

```bash
uv run init-local
```

Start backend + UI:

```bash
uv run start-app
```

Start backend only:

```bash
uv run start-app --no-ui
```

Use a non-default backend port:

```bash
uv run start-app --port 8001
```

Run the full quickstart flow:

```bash
uv run quickstart
```

## Safe Customization Areas

The most common places to customize are:

- agent instructions and behavior:
  - [agent.py](agent_server/agent.py)
- local tools:
  - [filesystem_tools.py](agent_server/filesystem_tools.py)
- conversation memory:
  - [memory_pipeline.py](agent_server/memory_pipeline.py)
  - [memory_store.py](agent_server/memory_store.py)
- runtime skills:
  - [SKILLS.md](SKILLS.md)
  - [skills/project-update/SKILL.md](skills/project-update/SKILL.md)
- UI components:
  - [e2e-chatbot-app-next/client/src/components](e2e-chatbot-app-next/client/src/components)
- UI backend routes:
  - [e2e-chatbot-app-next/server/src/routes](e2e-chatbot-app-next/server/src/routes)

## Security Notes

This app is local-first, but model inference still goes to Databricks.

Good operating assumptions:

- repo reads happen locally
- file writes happen locally
- model context sent to Databricks may include repo content the agent reads
- local memory and profile state are stored under `.local/`

For a fuller summary, see [CAPABILITIES_AND_LIMITATIONS.md](CAPABILITIES_AND_LIMITATIONS.md).

## Troubleshooting

### Databricks auth issues

Verify the profile exists:

```bash
databricks auth profiles
```

Re-auth if needed:

```bash
databricks auth login --profile DEFAULT --host https://<your-workspace>.databricks.com
```

### App starts but chat does not work

Check:

- the Databricks profile in `.env`
- the selected model endpoint exists
- the backend is running on the expected port
- the UI backend is proxying to the right `API_PROXY`

### Port conflicts

Set these in `.env`:

```bash
CHAT_APP_SERVER_PORT=3101
CHAT_APP_CLIENT_PORT=3102
```

Then start again:

```bash
uv run start-app
```

## Recommended Reading

- [TEAM_SETUP.md](TEAM_SETUP.md)
- [CAPABILITIES_AND_LIMITATIONS.md](CAPABILITIES_AND_LIMITATIONS.md)
- [SKILLS.md](SKILLS.md)
