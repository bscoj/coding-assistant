import asyncio
import logging
import os
from datetime import datetime
from typing import AsyncGenerator, Awaitable, Optional

import litellm
import mlflow
from databricks.sdk import WorkspaceClient
from databricks_langchain import ChatDatabricks, DatabricksMCPServer, DatabricksMultiServerMCPClient
from langchain.agents import create_agent
from langchain_core.tools import tool
from mlflow.genai.agent_server import get_request_headers, invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
    create_text_delta,
    to_chat_completions_input,
)

from agent_server.filesystem_tools import (
    FILESYSTEM_TOOLS,
    apply_staged_write_by_approval_id,
    clear_filesystem_tool_context,
    detect_approval_response,
    set_filesystem_tool_context,
    workspace_root,
)
from agent_server.memory_pipeline import (
    assistant_outputs_to_items,
    build_optimized_messages,
    maybe_refresh_memory,
    recent_messages_limit,
)
from agent_server.memory_store import get_memory_store
from agent_server.user_profile import build_profile_blocks, maybe_refresh_user_profiles
from agent_server.utils import (
    get_databricks_host_from_env,
    assistant_text_output_item,
    get_session_id,
    get_user_workspace_client,
    process_agent_astream_events,
)

logger = logging.getLogger(__name__)
mlflow.langchain.autolog()
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)
litellm.suppress_debug_info = True
sp_workspace_client = WorkspaceClient()


def _run_background(coro: Awaitable[object]) -> None:
    task = asyncio.create_task(coro)

    def _log_failure(done_task: asyncio.Task) -> None:
        try:
            done_task.result()
        except Exception:
            logger.exception("Background task failed.")

    task.add_done_callback(_log_failure)


def current_turn_items(request_items: list[dict]) -> list[dict]:
    approval_items = [
        item
        for item in request_items
        if item.get("type") in {"mcp_approval_response", "function_call_output"}
    ]
    if approval_items:
        return approval_items

    user_items = [item for item in request_items if item.get("role") == "user"]
    if user_items:
        return [user_items[-1]]

    return request_items


def agent_model_endpoint() -> str:
    requested = get_request_headers().get("x-codex-model-endpoint")
    available = available_agent_model_endpoints()
    if requested and requested in available:
        return requested
    return os.getenv("AGENT_MODEL_ENDPOINT", "databricks-gpt-5-2")


def available_agent_model_endpoints() -> list[str]:
    raw = os.getenv("AGENT_AVAILABLE_MODEL_ENDPOINTS", "")
    configured = [value.strip() for value in raw.split(",") if value.strip()]
    default = os.getenv("AGENT_MODEL_ENDPOINT", "databricks-gpt-5-2")
    values = configured or [default]
    if default not in values:
        values.append(default)
    return values


@tool
def get_current_time() -> str:
    """Get the current date and time."""
    return datetime.now().isoformat()


def init_mcp_client(workspace_client: WorkspaceClient) -> DatabricksMultiServerMCPClient:
    host_name = get_databricks_host_from_env()
    return DatabricksMultiServerMCPClient(
        [
            DatabricksMCPServer(
                name="system-ai",
                url=f"{host_name}/api/2.0/mcp/functions/system/ai",
                workspace_client=workspace_client,
            ),
        ]
    )


async def init_agent(workspace_client: Optional[WorkspaceClient] = None):
    tools = [get_current_time, *FILESYSTEM_TOOLS]
    # To use MCP server tools instead, replace the line above with:
    #   mcp_client = init_mcp_client(workspace_client or sp_workspace_client)
    #   try:
    #       tools.extend(await mcp_client.get_tools())
    #   except Exception:
    #       logger.warning("Failed to fetch MCP tools. Continuing without MCP tools.", exc_info=True)
    return create_agent(tools=tools, model=ChatDatabricks(endpoint=agent_model_endpoint()))


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    outputs = [
        event.item
        async for event in stream_handler(request)
        if event.type == "response.output_item.done"
    ]
    return ResponsesAgentResponse(output=outputs)


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    request_items = [i.model_dump() for i in request.input]
    turn_items = current_turn_items(request_items)
    current_workspace_root = str(workspace_root())
    user_profile_block = "\n\n".join(build_profile_blocks(current_workspace_root)) or None
    conversation_id = get_session_id(request)
    approval_request_id, approval_approved = detect_approval_response(turn_items)
    if approval_request_id and approval_approved is True:
        text = apply_staged_write_by_approval_id(approval_request_id)
        output_item = assistant_text_output_item(text)
        yield ResponsesAgentStreamEvent(**create_text_delta(delta=text, item_id=output_item["id"]))
        yield ResponsesAgentStreamEvent(type="response.output_item.done", item=output_item)
        if conversation_id:
            try:
                get_memory_store().save_messages(conversation_id, [output_item])
            except Exception:
                logger.exception("Failed to persist approval-write confirmation.")
        return

    if conversation_id:
        mlflow.update_current_trace(metadata={"mlflow.trace.session": conversation_id})
        store = get_memory_store()
        store.save_messages(conversation_id, turn_items)
        memory_state = store.load_memory_state(
            conversation_id, recent_messages_limit=recent_messages_limit()
        )
        optimized_input = build_optimized_messages(
            turn_items,
            memory_state,
            user_profile_block=user_profile_block,
        )
    else:
        optimized_input = build_optimized_messages(
            turn_items,
            state=None,
            user_profile_block=user_profile_block,
        )

    # By default, uses service principal credentials.
    # For on-behalf-of user authentication, use get_user_workspace_client() instead:
    #   agent = await init_agent(workspace_client=get_user_workspace_client())
    set_filesystem_tool_context(optimized_input)
    try:
        agent = await init_agent()
        messages = {"messages": to_chat_completions_input(optimized_input)}
        output_items = []

        async for event in process_agent_astream_events(
            agent.astream(input=messages, stream_mode=["updates", "messages"])
        ):
            if event.type == "response.output_item.done":
                output_items.append(event.item)
            yield event

        if conversation_id and output_items:
            try:
                get_memory_store().save_messages(
                    conversation_id, assistant_outputs_to_items(output_items)
                )
            except Exception:
                logger.exception("Failed to persist or refresh conversation memory.")
            else:
                _run_background(maybe_refresh_memory(conversation_id))
        if output_items:
            try:
                interaction_items = turn_items + assistant_outputs_to_items(output_items)
            except Exception:
                logger.exception("Failed to refresh persistent user profile.")
            else:
                _run_background(
                    maybe_refresh_user_profiles(
                        interaction_items,
                        current_workspace_root,
                    )
                )
    finally:
        clear_filesystem_tool_context()
