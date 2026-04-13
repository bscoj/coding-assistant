from pathlib import Path

from dotenv import load_dotenv
from mlflow.genai.agent_server import AgentServer, setup_mlflow_git_based_version_tracking

# Load env vars from .env before importing the agent for proper auth
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

# Need to import the agent to register the functions with the server
import agent_server.agent  # noqa: E402
from agent_server.agent import agent_model_endpoint, available_agent_model_endpoints  # noqa: E402
from agent_server.filesystem_tools import workspace_root, writes_enabled  # noqa: E402
from agent_server.memory_pipeline import memory_runtime_config  # noqa: E402
from agent_server.user_profile import profile_runtime_config  # noqa: E402


def _print_memory_banner() -> None:
    config = memory_runtime_config()
    print("Local memory configuration:")
    print(f"  enabled: {config['enabled']}")
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
    print(f"  workspace_root: {workspace_root()}")
    print(f"  writes_enabled: {writes_enabled()}")
    print("  write_approval_prefix: APPROVE_WRITE:<operation_id>")

agent_server = AgentServer("ResponsesAgent", enable_chat_proxy=True)

# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()


def main():
    _print_agent_banner()
    _print_memory_banner()
    _print_user_profile_banner()
    _print_filesystem_banner()
    agent_server.run(app_import_string="agent_server.start_server:app")


if __name__ == "__main__":
    main()
