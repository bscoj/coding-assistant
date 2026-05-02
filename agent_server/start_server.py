from pathlib import Path

from dotenv import load_dotenv
from fastapi import Header, HTTPException
from mlflow.genai.agent_server import AgentServer, setup_mlflow_git_based_version_tracking
from pydantic import BaseModel

# Load env vars from .env before importing the agent for proper auth
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

# Need to import the agent to register the functions with the server
import agent_server.agent  # noqa: E402
from agent_server.agent import agent_model_endpoint, available_agent_model_endpoints  # noqa: E402
from agent_server.filesystem_tools import configured_workspace_root, writes_enabled  # noqa: E402
from agent_server.memory_pipeline import memory_runtime_config  # noqa: E402
from agent_server.sql_knowledge_runtime import (  # noqa: E402
    LAKEBASE_BRANCH_HEADER,
    LAKEBASE_INSTANCE_HEADER,
    LAKEBASE_PROJECT_HEADER,
    SQL_KNOWLEDGE_MODE_HEADER,
    lakebase_connection_config,
    normalize_sql_knowledge_mode,
    sql_knowledge_runtime_config,
    sql_knowledge_status,
    sync_sql_knowledge,
)
from agent_server.user_profile import profile_runtime_config  # noqa: E402


def _print_memory_banner() -> None:
    config = memory_runtime_config()
    print("Local memory configuration:")
    print(f"  enabled: {config['enabled']}")
    print(f"  mode: {config['mode']}")
    print(f"  db_path: {config['db_path']}")
    print(f"  summary_threshold_messages: {config['summary_threshold_messages']}")
    print(f"  recent_messages: {config['recent_messages']}")
    print(f"  min_fact_confidence: {config['min_fact_confidence']}")
    print(f"  max_summary_words: {config['max_summary_words']}")
    print(f"  memory_model_endpoint: {config['memory_model_endpoint']}")


def _print_agent_banner() -> None:
    print("Agent model:")
    print(f"  endpoint: {agent_model_endpoint()}")
    print(f"  available_endpoints: {', '.join(available_agent_model_endpoints())}")


def _print_user_profile_banner() -> None:
    config = profile_runtime_config()
    print("Persistent user profile:")
    print(f"  enabled: {config['enabled']}")
    print(f"  global_path: {config['global_path']}")
    print(f"  project_dir: {config['project_dir']}")
    print(f"  min_confidence: {config['min_confidence']}")
    print(f"  max_items: {config['max_items']}")
    print(f"  model_endpoint: {config['model_endpoint']}")


def _print_filesystem_banner() -> None:
    print("Filesystem tools:")
    print(f"  workspace_root: {configured_workspace_root() or '(none selected)'}")
    print(f"  writes_enabled: {writes_enabled()}")
    print("  write_approval_flow: UI allow/deny controls")


def _print_sql_knowledge_banner() -> None:
    config = sql_knowledge_runtime_config(headers={})
    print("SQL knowledge:")
    print(f"  requested_mode: {config['requested_mode']}")
    print(f"  effective_mode: {config['effective_mode']}")
    print(f"  databricks_profile: {config['profile'] or '(default)'}")
    print(f"  lakebase_configured: {config['lakebase_configured']}")
    if config["lakebase_project"] or config["lakebase_branch"]:
        print(
            "  lakebase_autoscaling: "
            f"{config['lakebase_project'] or '(none)'} / {config['lakebase_branch'] or '(none)'}"
        )
    if config["lakebase_instance_name"]:
        print(f"  lakebase_instance: {config['lakebase_instance_name']}")
    if config["lakebase_error"]:
        print(f"  lakebase_error: {config['lakebase_error']}")


class SqlKnowledgeSyncRequest(BaseModel):
    direction: str

agent_server = AgentServer("ResponsesAgent", enable_chat_proxy=True)

# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()


def _sql_knowledge_headers(
    sql_knowledge_mode: str | None,
    lakebase_project: str | None,
    lakebase_branch: str | None,
    lakebase_instance: str | None,
) -> dict[str, str]:
    headers: dict[str, str] = {}
    if sql_knowledge_mode:
        headers[SQL_KNOWLEDGE_MODE_HEADER] = sql_knowledge_mode
    if lakebase_project:
        headers[LAKEBASE_PROJECT_HEADER] = lakebase_project
    if lakebase_branch:
        headers[LAKEBASE_BRANCH_HEADER] = lakebase_branch
    if lakebase_instance:
        headers[LAKEBASE_INSTANCE_HEADER] = lakebase_instance
    return headers


@app.get("/sql-knowledge/status")
def get_sql_knowledge_status(
    workspace_root: str | None = Header(default=None, alias="x-codex-workspace-root"),
    sql_knowledge_mode: str | None = Header(
        default=None,
        alias=SQL_KNOWLEDGE_MODE_HEADER,
    ),
    lakebase_project: str | None = Header(default=None, alias=LAKEBASE_PROJECT_HEADER),
    lakebase_branch: str | None = Header(default=None, alias=LAKEBASE_BRANCH_HEADER),
    lakebase_instance: str | None = Header(default=None, alias=LAKEBASE_INSTANCE_HEADER),
):
    headers = _sql_knowledge_headers(
        sql_knowledge_mode,
        lakebase_project,
        lakebase_branch,
        lakebase_instance,
    )
    requested_mode = normalize_sql_knowledge_mode(sql_knowledge_mode)
    config = lakebase_connection_config(headers)
    return sql_knowledge_status(
        workspace_root=workspace_root or "",
        requested_mode=requested_mode,
        config=config,
    )


@app.post("/sql-knowledge/sync")
def post_sql_knowledge_sync(
    body: SqlKnowledgeSyncRequest,
    workspace_root: str | None = Header(default=None, alias="x-codex-workspace-root"),
    sql_knowledge_mode: str | None = Header(
        default=None,
        alias=SQL_KNOWLEDGE_MODE_HEADER,
    ),
    lakebase_project: str | None = Header(default=None, alias=LAKEBASE_PROJECT_HEADER),
    lakebase_branch: str | None = Header(default=None, alias=LAKEBASE_BRANCH_HEADER),
    lakebase_instance: str | None = Header(default=None, alias=LAKEBASE_INSTANCE_HEADER),
):
    direction = body.direction.strip().lower()
    if direction not in {"push", "pull"}:
        raise HTTPException(status_code=400, detail="direction must be push or pull")

    headers = _sql_knowledge_headers(
        sql_knowledge_mode,
        lakebase_project,
        lakebase_branch,
        lakebase_instance,
    )
    try:
        return sync_sql_knowledge(
            direction=direction,  # type: ignore[arg-type]
            workspace_root=workspace_root or "",
            config=lakebase_connection_config(headers),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def main():
    _print_agent_banner()
    _print_memory_banner()
    _print_user_profile_banner()
    _print_filesystem_banner()
    _print_sql_knowledge_banner()
    agent_server.run(app_import_string="agent_server.start_server:app")


if __name__ == "__main__":
    main()
