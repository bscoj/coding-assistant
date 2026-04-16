# Responses API Agent

This template defines a conversational agent app. The app comes with a built-in chat UI, but also exposes an API endpoint for invoking the agent so that you can serve your UI elsewhere (e.g. on your website or in a mobile app).

The agent in this template implements the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) interface. It has access to a single tool; the [built-in code interpreter tool](https://docs.databricks.com/aws/en/generative-ai/agent-framework/code-interpreter-tools#built-in-python-executor-tool) (`system.ai.python_exec`) on Databricks. You can customize agent code and test it via the API or UI.

The agent input and output format are defined by MLflow's ResponsesAgent interface, which closely follows the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) interface. See [the MLflow docs](https://mlflow.org/docs/latest/genai/flavors/responses-agent-intro/) for input and output formats for streaming and non-streaming requests, tracing requirements, and other agent authoring details.

## Build with AI Assistance

We recommend using AI coding assistants (Claude Code, Cursor, GitHub Copilot) to customize and deploy this template. Agent Skills in `.claude/skills/` provide step-by-step guidance for common tasks like setup, adding tools, and deployment. These skills are automatically detected by Claude, Cursor, and GitHub Copilot.

This local app also supports runtime task skills for its own agent behavior. See [SKILLS.md](SKILLS.md) for the local skill format and activation model.

## Quick start

Run the `uv run quickstart` script to quickly set up your local environment and start the agent server. At any step, if there are issues, refer to the manual local development loop setup below.

This script will:

1. Verify uv, nvm, and Databricks CLI installations
2. Configure Databricks authentication
3. Configure agent tracing, by creating and linking an MLflow experiment to your app
4. Start the agent server and chat app

```bash
uv run quickstart
```

After the setup is complete, you can start the agent server and the chat app locally with one command:

```bash
uv run start-app
```

This starts:

- the agent server at `http://localhost:8000`
- the UI backend at `http://localhost:3001`
- the bundled chat UI at `http://localhost:3002`

`uv run start-app` is the recommended local entry point. It:

- starts the Python agent backend
- starts the nested UI app
- wires `API_PROXY` automatically to the local agent backend
- enables local auth bypass for the UI by default

If you need custom ports, set these in `.env` before starting:

```bash
CHAT_APP_SERVER_PORT=3001
CHAT_APP_CLIENT_PORT=3002
```

**Next steps**: see [modifying your agent](#modifying-your-agent) to customize and iterate on the agent code.

## Databricks endpoint configuration

This app is designed to work with Databricks Model Serving chat endpoints.

Set these values in `.env`:

- `AGENT_MODEL_ENDPOINT`: the main Databricks chat model endpoint the agent should use
- `AGENT_AVAILABLE_MODEL_ENDPOINTS`: optional comma-separated allowlist for UI model switching
- `MEMORY_MODEL_ENDPOINT`: optional override for conversation-memory summarization and fact extraction
- `USER_PROFILE_MODEL_ENDPOINT`: optional override for persistent user/project profile extraction

If you do not set the optional memory/profile endpoint overrides, they inherit from `AGENT_MODEL_ENDPOINT`.

Typical local configuration:

```bash
AGENT_MODEL_ENDPOINT=your-chat-endpoint
AGENT_AVAILABLE_MODEL_ENDPOINTS=your-chat-endpoint,another-chat-endpoint
# Optional
# MEMORY_MODEL_ENDPOINT=your-memory-endpoint
# USER_PROFILE_MODEL_ENDPOINT=your-memory-endpoint
```

This means you can:

- use one Databricks endpoint for everything
- use a stronger or cheaper endpoint for memory/profile updates
- keep the UI and backend running locally while all model inference stays on Databricks

## Local conversation memory

This template now supports local SQLite-backed conversation memory for local development. When a conversation ID is present, the agent stores the full transcript locally, keeps a rolling summary of older messages, extracts structured conversation facts, and only sends the summary plus recent messages back to the model.

To initialize local files with the memory database path and a starter `.env`, run:

```bash
uv run init-local
```

The defaults are:

- SQLite database at `.local/conversation_memory.db`
- Summarize once there are at least `10` older unsummarized messages
- Keep the last `8` raw messages in prompt context
- Ignore extracted facts below `0.65` confidence

These values can be overridden in `.env` via `MEMORY_DB_PATH`, `MEMORY_SUMMARY_THRESHOLD_MESSAGES`, `MEMORY_RECENT_MESSAGES`, `MEMORY_MIN_FACT_CONFIDENCE`, and `MEMORY_MAX_SUMMARY_WORDS`.

If the memory summarization model is unavailable, the app still persists full local chat history and continues serving requests; only summary/fact refresh is skipped until model access is available.

## Persistent user and project profiles

The agent maintains:

- a global JSON profile for durable cross-conversation user context
- repo-scoped JSON profiles for durable project conventions and constraints

The defaults are:

- Global profile file at `.local/user_profile.json`
- Project profile directory at `.local/project_profiles/`
- Confidence threshold `0.70`
- Up to `40` active profile entries retained
- Categories: `coding_preference`, `workstyle_preference`, `user_fact`, `constraint`

These profiles are separate from per-conversation memory:

- conversation memory stores transcript-derived context for one chat only
- the global profile stores durable preferences and facts that should persist across all chats
- the project profile stores durable repo-scoped preferences, facts, and constraints

The agent injects the global profile on every request, and injects the project profile for the currently selected workspace root. If the profile extraction model is unavailable, requests still continue normally; only profile refresh is skipped.

These values can be overridden in `.env` via `USER_PROFILE_PATH`, `PROJECT_PROFILE_DIR`, `USER_PROFILE_MIN_CONFIDENCE`, `USER_PROFILE_MAX_ITEMS`, and `USER_PROFILE_MODEL_ENDPOINT`.

## Security and capability summary

For a detailed description of what the app can and cannot do, including file access boundaries and approval requirements, see [CAPABILITIES_AND_LIMITATIONS.md](CAPABILITIES_AND_LIMITATIONS.md).

## Marp presentations

The agent can also help create [Marp](https://marp.app/) markdown presentations from the selected repo.

The intended workflow is:

- inspect the repo
- propose a deck outline
- generate a Marp markdown file
- stage the deck file for approval before writing it

Starter templates and guidance live in:

- [MARP_PRESENTATIONS.md](MARP_PRESENTATIONS.md)
- [skills/marp/SKILL.md](skills/marp/SKILL.md)
- `skills/marp/templates/technical-walkthrough.md`
- `skills/marp/templates/architecture-overview.md`
- `skills/marp/templates/stakeholder-summary.md`

Examples:

- `Create a Marp deck explaining this repo to engineers`
- `Make a 7-slide architecture presentation from this project`
- `Create a stakeholder summary deck for this codebase`

The first version is markdown-first: it generates Marp `.md` files but does not automatically render/export them.

## Local filesystem tools

The agent also exposes local filesystem tools for local development:

- `workspace_overview`: cached repo structure and important files
- `find_files_by_name`: fast path/name lookup using the cached workspace index
- `list_files`: list files/directories inside the configured workspace root
- `search_files`: search file contents
- `read_file`: read a file with line numbers
- `stage_file_write`: stage a create/overwrite
- `stage_patch_edit`: stage an exact-text patch edit for an existing file
- `stage_change_plan`: stage a grouped multi-file plan for one approval action
- `apply_staged_write`: apply a staged write after explicit approval
- `show_staged_write`: inspect a staged write

These tools are scoped to `FILES_WORKSPACE_ROOT`, which defaults to the repo root. Writes are guarded by a staged approval flow. The agent must first stage a write, then the user must explicitly reply with:
In the bundled chat UI, staged writes render as an approval card with `Allow` and `Deny` buttons. An approved write applies only that exact staged change. This keeps local editing possible without allowing silent file modification.

The chat UI also includes:

- a right-side activity rail for recent tool calls and approvals
- richer diff review for local filesystem change requests
- grouped approvals for multi-file change plans

## Manual local development loop setup

1. **Set up your local environment**
   Install `uv` (python package manager), `nvm` (node version manager), and the Databricks CLI:

   - [`uv` installation docs](https://docs.astral.sh/uv/getting-started/installation/)
   - [`nvm` installation](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating)
     - Run the following to use Node 20 LTS:
       ```bash
       nvm use 20
       ```
   - [`databricks CLI` installation](https://docs.databricks.com/aws/en/dev-tools/cli/install)

2. **Set up local authentication to Databricks**

   In order to access Databricks resources from your local machine while developing your agent, you need to authenticate with Databricks. Choose one of the following options:

   **Option 1: OAuth via Databricks CLI (Recommended)**

   Authenticate with Databricks using the CLI. See the [CLI OAuth documentation](https://docs.databricks.com/aws/en/dev-tools/cli/authentication#oauth-user-to-machine-u2m-authentication).

   ```bash
   uv run init-local
   cp .env.example .env  # only needed if you skipped init-local
   databricks auth login
   ```

   Set the `DATABRICKS_CONFIG_PROFILE` environment variable in your .env file to the profile you used to authenticate:

   ```bash
   DATABRICKS_CONFIG_PROFILE="DEFAULT" # change to the profile name you chose
   ```

   **Option 2: Personal Access Token (PAT)**

   See the [PAT documentation](https://docs.databricks.com/aws/en/dev-tools/auth/pat#databricks-personal-access-tokens-for-workspace-users).

   ```bash
   # Add these to your .env file
   DATABRICKS_HOST="https://host.databricks.com"
   DATABRICKS_TOKEN="dapi_token"
   ```

   See the [Databricks SDK authentication docs](https://docs.databricks.com/aws/en/dev-tools/sdk-python#authenticate-the-databricks-sdk-for-python-with-your-databricks-account-or-workspace).

3. **Create and link an MLflow experiment to your app**

   Create an MLflow experiment to enable tracing and version tracking. This is automatically done by the `uv run quickstart` script.

   Create the MLflow experiment via the CLI:

   ```bash
   DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)
   databricks experiments create-experiment /Users/$DATABRICKS_USERNAME/agents-on-apps
   ```

   Make a copy of `.env.example` to `.env` and update the `MLFLOW_EXPERIMENT_ID` in your `.env` file with the experiment ID you created. The `.env` file will be automatically loaded when starting the server.

   ```bash
   cp .env.example .env
   # Edit .env and fill in your experiment ID
   ```

   See the [MLflow experiments documentation](https://docs.databricks.com/aws/en/mlflow/experiments#create-experiment-from-the-workspace).

4. **Test your agent locally**

   Start up the agent server and chat UI locally:

   ```bash
   uv run start-app
   ```

   Query your agent via the UI (`http://localhost:3002`) or REST API:

   If you run the nested UI app directly from `e2e-chatbot-app-next`, the recommended local settings are:

   ```bash
   LOCAL_AUTH_BYPASS=true
   CHAT_APP_SERVER_PORT=3001
   CHAT_APP_CLIENT_PORT=3002
   CHAT_APP_CORS_ORIGIN=http://localhost:3002
   API_PROXY=http://localhost:8000/invocations
   ```

   To run the backend only:

   ```bash
   uv run start-app --no-ui
   ```

   **Advanced server options:**

   ```bash
   uv run start-server --reload   # hot-reload the server on code changes
   uv run start-server --port 8001 # change the port the server listens on
   uv run start-server --workers 4 # run the server with multiple workers
   ```

   - Example streaming request:
     ```bash
     curl -X POST http://localhost:8000/invocations \
     -H "Content-Type: application/json" \
     -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'
     ```
   - Example non-streaming request:
     ```bash
     curl -X POST http://localhost:8000/invocations  \
     -H "Content-Type: application/json" \
     -d '{ "input": [{ "role": "user", "content": "hi" }] }'
     ```

## Modifying your agent

See the [LangGraph documentation](https://docs.langchain.com/oss/python/langgraph/quickstart) for more information on how to edit your own agent.

Required files for hosting with MLflow `AgentServer`:

- `agent.py`: Contains your agent logic. Modify this file to create your custom agent. For example, you can [add agent tools](https://docs.databricks.com/aws/en/generative-ai/agent-framework/agent-tool) to give your agent additional capabilities
- `start_server.py`: Initializes and runs the MLflow `AgentServer` with agent_type="ResponsesAgent". You don't have to modify this file for most common use cases, but can add additional server routes (e.g. a `/metrics` endpoint) here

**Common customization questions:**

**Q: Can I add additional files or folders to my agent?**
Yes. Add additional files or folders as needed. Ensure the script within `pyproject.toml` runs the correct script that starts the server and sets up MLflow tracing.

**Q: How do I add dependencies to my agent?**
Run `uv add <package_name>` (e.g., `uv add "mlflow-skinny[databricks]"`). See the [python pyproject.toml guide](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/#dependencies-and-requirements).

**Q: Can I add custom tracing beyond the built-in tracing?**
Yes. This template uses MLflow's agent server, which comes with automatic tracing for agent logic decorated with `@invoke()` and `@stream()`. It also uses [MLflow autologging APIs](https://mlflow.org/docs/latest/genai/tracing/#one-line-auto-tracing-integrations) to capture traces from LLM invocations. However, you can add additional instrumentation to capture more granular trace information when your agent runs. See the [MLflow tracing documentation](https://docs.databricks.com/aws/en/mlflow3/genai/tracing/app-instrumentation/).

**Q: How can I extend this example with additional tools and capabilities?**
This template can be extended by integrating additional MCP servers, Vector Search Indexes, UC Functions, and other Databricks tools. See the ["Agent Framework Tools Documentation"](https://docs.databricks.com/aws/en/generative-ai/agent-framework/agent-tool).

## Evaluating your agent

Evaluate your agent by calling the invoke function you defined for the agent locally.

- Update your `evaluate_agent.py` file with the preferred evaluation dataset and scorers.

Run the evaluation using the evaluation script:

```bash
uv run agent-evaluate
```

After it completes, open the MLflow UI link for your experiment to inspect results.

## Deploying to Databricks Apps

This template uses [Databricks Asset Bundles (DABs)](https://docs.databricks.com/aws/en/dev-tools/bundles/) for deployment. The `databricks.yml` file defines the app configuration and resource permissions.

Ensure you have the [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/tutorial) installed and configured.

1. **Run the pre-flight check**

   Start the agent locally, send a test request, and verify the response to catch configuration and code errors early:

   ```bash
   uv run preflight
   ```

2. **Validate the bundle configuration**

   Catch any configuration errors before deploying:

   ```bash
   databricks bundle validate
   ```

3. **Deploy the bundle**

   This uploads your code and configures resources (MLflow experiment, serving endpoints, etc.) defined in `databricks.yml`:

   ```bash
   databricks bundle deploy
   ```

4. **Start or restart the app**

   ```bash
   databricks bundle run agent_langgraph
   ```

   > **Note:** `bundle deploy` only uploads files and configures resources. `bundle run` is **required** to actually start/restart the app with the new code.

   To grant access to additional resources (serving endpoints, genie spaces, UC Functions, Vector Search), add them to `databricks.yml` and redeploy. See the [Databricks Apps resources documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources).

   **On-behalf-of (OBO) User Authentication**: Use `get_user_workspace_client()` from `agent_server.utils` to authenticate as the requesting user instead of the app service principal. See the [OBO authentication documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth?language=Streamlit#retrieve-user-authorization-credentials).

5. **Query your agent hosted on Databricks Apps**

   You must use a Databricks OAuth token to query agents hosted on Databricks Apps. See [Query an agent](https://docs.databricks.com/aws/en/generative-ai/agent-framework/query-agent) for full details.

   **Using the Databricks OpenAI client (Python):**

   ```bash
   uv pip install databricks-openai
   ```

   ```python
   from databricks.sdk import WorkspaceClient
   from databricks_openai import DatabricksOpenAI

   w = WorkspaceClient()
   client = DatabricksOpenAI(workspace_client=w)

   # Non-streaming
   response = client.responses.create(
       model="apps/<app-name>",
       input=[{"role": "user", "content": "hi"}],
   )
   print(response)

   # Streaming
   streaming_response = client.responses.create(
       model="apps/<app-name>",
       input=[{"role": "user", "content": "hi"}],
       stream=True,
   )
   for chunk in streaming_response:
       print(chunk)
   ```

   **Using curl:**

   ```bash
   # Generate an OAuth token
   databricks auth login --host <https://host.databricks.com>
   databricks auth token
   ```

   ```bash
   # Streaming request
   curl --request POST \
     --url <app-url>.databricksapps.com/responses \
     --header "Authorization: Bearer <oauth-token>" \
     --header "Content-Type: application/json" \
     --data '{
       "input": [{ "role": "user", "content": "hi" }],
       "stream": true
     }'
   ```

   ```bash
   # Non-streaming request
   curl --request POST \
     --url <app-url>.databricksapps.com/responses \
     --header "Authorization: Bearer <oauth-token>" \
     --header "Content-Type: application/json" \
     --data '{
       "input": [{ "role": "user", "content": "hi" }]
     }'
   ```

For future updates, run `databricks bundle deploy` and `databricks bundle run agent_langgraph` to redeploy.

### Common Issues

- **`databricks bundle deploy` fails with "An app with the same name already exists"**

  This happens when an app with the same name was previously created outside of DABs. To fix, bind the existing app to your bundle:

  ```bash
  # 1. Get the existing app's config (note the budget_policy_id if present)
  databricks apps get <app-name> --output json | jq '{name, budget_policy_id, description}'

  # 2. Update databricks.yml to include budget_policy_id if it was returned above

  # 3. Bind the existing app to your bundle
  databricks bundle deployment bind agent_langgraph <app-name> --auto-approve

  # 4. Deploy
  databricks bundle deploy
  ```

  Alternatively, delete the existing app and deploy fresh: `databricks apps delete <app-name>` (this permanently removes the app's URL and service principal).

- **`databricks bundle deploy` fails with "Provider produced inconsistent result after apply"**

  The existing app has server-side configuration (like `budget_policy_id`) that doesn't match your `databricks.yml`. Run `databricks apps get <app-name> --output json` and sync any missing fields to your `databricks.yml`.

- **App is running old code after `databricks bundle deploy`**

  `bundle deploy` only uploads files and configures resources. You must run `databricks bundle run agent_langgraph` to actually start/restart the app with the new code.

### FAQ

- For a streaming response, I see a 200 OK in the logs, but an error in the actual stream. What's going on?
  - This is expected behavior. The initial 200 OK confirms stream setup; streaming errors don't affect this status.
- When querying my agent, I get a 302 error. What's going on?
  - Use an OAuth token. PATs are not supported for querying agents.
