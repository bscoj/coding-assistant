# Team Setup Guide

This is the teammate onboarding guide for Coding Buddy.

The goal is simple: get from clone to a working local app quickly, with the least amount of guesswork.

## What You Are Setting Up

Coding Buddy has three local pieces:

- Python agent backend
- UI backend
- frontend

The app runs locally, but model inference uses Databricks Model Serving.

## Prerequisites

Install these first:

1. `uv`
2. Node 20
3. Databricks CLI

Recommended:

- install Node through `nvm`
- use the latest Databricks CLI

Helpful references:

- `uv`: [https://docs.astral.sh/uv/getting-started/installation/](https://docs.astral.sh/uv/getting-started/installation/)
- `nvm`: [https://github.com/nvm-sh/nvm](https://github.com/nvm-sh/nvm)
- Databricks CLI: [https://docs.databricks.com/dev-tools/cli/install.html](https://docs.databricks.com/dev-tools/cli/install.html)

After installing Node:

```bash
nvm use 20
```

## 1. Clone The Repo

```bash
git clone <repo-url>
cd agent-langgraph
```

## 2. Create Local Env File

```bash
cp .env.example .env
```

You will edit `.env` in the next steps.

## 3. Authenticate To Databricks

Use a named Databricks CLI profile. This is the important part for the team setup.

Example:

```bash
databricks auth login --profile DEFAULT --host https://<your-workspace>.databricks.com
```

Then verify it exists:

```bash
databricks auth profiles
```

If your team uses a different shared naming convention, use that profile name consistently.

## 4. Set The Same Profile In `.env`

Open `.env` and set:

```bash
DATABRICKS_CONFIG_PROFILE=DEFAULT
```

If you are using PAT-based auth instead of CLI OAuth, also set:

```bash
DATABRICKS_HOST=https://<your-workspace>.databricks.com
DATABRICKS_TOKEN=<your-token>
```

For most teammates, CLI OAuth with `databricks auth login --profile ...` is the preferred setup.

## 5. Fill In Required `.env` Values

At minimum, confirm these values:

```bash
DATABRICKS_CONFIG_PROFILE=DEFAULT
AGENT_MODEL_ENDPOINT=<your-databricks-serving-endpoint>
```

Optional but commonly useful:

```bash
AGENT_AVAILABLE_MODEL_ENDPOINTS=<endpoint-a>,<endpoint-b>
MEMORY_MODE=work
CONTEXT_MODE=personalized
MEMORY_MODEL_ENDPOINT=<optional-memory-endpoint>
USER_PROFILE_MODEL_ENDPOINT=<optional-profile-endpoint>
MLFLOW_EXPERIMENT_ID=<optional-if-using-tracing-or-feedback>
```

If your machine already needs non-default UI ports, set them too:

```bash
CHAT_APP_SERVER_PORT=3101
CHAT_APP_CLIENT_PORT=3102
```

## 6. Initialize Local Storage

This creates local storage files and prepares the memory database path:

```bash
uv run init-local
```

Typical local data created under `.local/`:

- `conversation_memory.db`
- `user_profile.json`
- `project_profiles/`
- `staged_writes.json`

## 7. Start The App

Use the one-command local startup:

```bash
uv run start-app
```

Default local addresses:

- backend: `http://localhost:8000`
- UI backend: `http://localhost:3001`
- frontend: `http://localhost:3002`

Then open:

```text
http://localhost:3002
```

If you changed UI ports in `.env`, open the matching frontend port instead.

## 8. First-Time Sanity Check

Once the app is open:

1. make sure the chat loads
2. open the repo picker and choose your local repo
3. send a small prompt like:
   - `give me a quick overview of this repo`
4. confirm the model responds

If the app loads but inference fails, the most common issue is Databricks auth or endpoint configuration.

## Daily Workflow

Typical usage:

1. start the app
2. select the repo you want the assistant to inspect
3. ask it to explore, explain, or propose changes
4. review any write approvals before allowing them

The agent is intentionally approval-based for file writes.

## Included Capabilities

### Repo-aware coding help

- repo exploration
- file search
- targeted file reads
- approval-based file edits

### Local memory

- local conversation memory
- Work mode: keeps more recent raw messages in context before summarizing older turns
- Balanced mode: keeps fewer raw messages to reduce token usage
- shared user profile
- project profile per repo

Use `Profile -> Work mode memory` in the UI to switch modes. Work mode is better for active coding because generated code, file paths, and implementation decisions stay in raw context longer.

Use `Profile -> Fresh session` for clean ideation. Fresh mode ignores durable user/project profile memory and does not write new profile facts, while still keeping the current chat coherent.

### Project update skill

The repo currently includes one runtime skill:

- `project-update`

Examples:

- `Create today's project update file`
- `Refresh my daily update from this repo`
- `Draft a ServiceNow update from today's work`

## Common Commands

Start everything:

```bash
uv run start-app
```

Start backend only:

```bash
uv run start-app --no-ui
```

Use a different backend port:

```bash
uv run start-app --port 8001
```

Run the full guided setup:

```bash
uv run quickstart
```

## Troubleshooting

### `Cannot connect to API`

Check:

- backend is running
- the model endpoint in `.env` is correct
- Databricks auth is valid

Re-verify auth:

```bash
databricks auth profiles
```

Re-login if needed:

```bash
databricks auth login --profile DEFAULT --host https://<your-workspace>.databricks.com
```

### Port already in use

Set alternate UI ports in `.env`:

```bash
CHAT_APP_SERVER_PORT=3101
CHAT_APP_CLIENT_PORT=3102
```

Then run:

```bash
uv run start-app
```

### App loads, but repo actions fail

Check that:

- a repo is selected in the UI
- the selected path is the repo you intended
- the backend was restarted after pulling new code

### Databricks profile confusion

Be explicit and consistent:

```bash
databricks auth login --profile DEFAULT --host https://<your-workspace>.databricks.com
```

Then in `.env`:

```bash
DATABRICKS_CONFIG_PROFILE=DEFAULT
```

Do not rely on an implicit default if the team is sharing instructions.

## Safe Customization Areas

Good places to extend the app:

- agent behavior:
  - `agent_server/agent.py`
- local tools:
  - `agent_server/filesystem_tools.py`
- memory behavior:
  - `agent_server/memory_pipeline.py`
  - `agent_server/memory_store.py`
- skills:
  - `skills/`
  - `SKILLS.md`
- UI:
  - `e2e-chatbot-app-next/client/src/components/`
- UI backend routes:
  - `e2e-chatbot-app-next/server/src/routes/`

## Before You Hand It To Someone Else

Recommended checklist:

- make sure `.env.example` still reflects the real required variables
- keep `.env` and `.local/` out of git
- verify `uv run start-app` still works on a clean clone
- verify Databricks auth instructions still match current team practice

## Related Docs

- [README.md](README.md)
- [CAPABILITIES_AND_LIMITATIONS.md](CAPABILITIES_AND_LIMITATIONS.md)
- [SKILLS.md](SKILLS.md)
