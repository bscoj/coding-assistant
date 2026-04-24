import asyncio
import logging
import os
from datetime import datetime
from time import perf_counter
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
    build_task_scratchpad_block,
    build_tool_memory_block,
    clear_filesystem_tool_context,
    detect_approval_response,
    record_task_request,
    set_filesystem_tool_context,
    workspace_root,
)
from agent_server.chat_history_tools import CHAT_HISTORY_TOOLS
from agent_server.analytics_context_tools import ANALYTICS_CONTEXT_TOOLS
from agent_server.memory_pipeline import (
    assistant_outputs_to_items,
    build_optimized_messages,
    maybe_refresh_memory,
    normalize_memory_mode,
    recent_messages_limit,
)
from agent_server.memory_store import get_memory_store
from agent_server.playbooks import build_playbook_blocks
from agent_server.repo_instructions import build_repo_instruction_blocks
from agent_server.runtime_hooks import (
    build_runtime_hook_blocks,
    emit_runtime_hook_event,
    wrap_tools_with_runtime_hooks,
)
from agent_server.sql_memory_tools import SQL_MEMORY_TOOLS
from agent_server.skills import build_skill_blocks
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

AGENT_SYSTEM_PROMPT = """You are Coding Buddy, a repo-aware coding assistant.

Core behavior:
- Be concise, practical, and accurate.
- Respect repo-native instructions and active workflow blocks when they are injected.
- Prefer understanding the repo before proposing changes.
- Minimize redundant tool use. Reuse recent file reads and targeted searches instead of rereading whole files.
- Prefer workspace_overview(), find_files_by_name(), recent_file_reads(), targeted search_files(), and search_code_blocks() before broad reads.
- For ML or data-science repos, prefer ml_repo_overview() early so you can orient on training, evaluation, data pipelines, serving, and likely risks in one pass.
- For SQL or analytics tasks, prefer analytics_context_overview(), search_analytics_tables(), search_analytics_joins(), search_analytics_metrics(), suggest_sql_starting_points(), validated_sql_store_overview(), search_validated_sql_patterns(), and search_validated_sql_by_table_or_join() before broad repo search so you can reuse trusted tables, joins, and metrics.
- When the user confirms a SQL query is correct or trusted, save it with save_validated_sql_pattern() or save_validated_sql_file().
- Only register analytics table, join, or metric context when the user explicitly asks to save or curate trusted analytics knowledge.
- Before finalizing important SQL, run verify_sql_query() and use the findings to improve the answer.
- If the user refers to code, errors, or decisions from earlier in this same chat, use search_chat_history() or read_chat_turn() before guessing.
- Use injected skill blocks when they are present for task-specific workflows.
- Do not assume a skill is active unless it was injected for the current request.
- When the user asks you to explore, understand, inspect, or figure out a repo, stay in exploration mode until you can give one coherent answer.
- In exploration mode, do not stop after one or two file reads if important gaps remain. Chain a few high-signal tool calls together, then synthesize.
- Only stop exploration early if you hit a real blocker or the user explicitly wants a quick first-pass answer.
- When explaining ML work, teach while you solve: state what the component does, why it matters, common failure modes, and the next best validation step.
- After changing code, run the most targeted verification you reasonably can and report what you checked.

File changes:
- Use staged write tools for all file edits.
- Never ask the user to type approval tokens manually. The UI provides Allow / Deny controls for file changes.
"""


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


def requested_memory_mode() -> str:
    return normalize_memory_mode(get_request_headers().get("x-codex-memory-mode"))


def requested_context_mode() -> str:
    requested = (get_request_headers().get("x-codex-context-mode") or "").strip().lower()
    return "fresh" if requested == "fresh" else "personalized"


def requested_response_mode() -> str:
    requested = (get_request_headers().get("x-codex-response-mode") or "").strip().lower()
    return "teach" if requested == "teach" else "direct"


def response_style_block() -> str | None:
    if requested_response_mode() != "teach":
        return None
    return """Teach mode

Solve the task directly, but also add concise teaching value:
- briefly explain why the chosen approach is right
- call out the main tradeoff or failure mode to watch
- end with the next best validation step or learning takeaway
- keep the explanation practical and compact"""


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


async def init_agent(
    workspace_root_override: str | None = None,
    workspace_client: Optional[WorkspaceClient] = None,
):
    tools = [
        get_current_time,
        *FILESYSTEM_TOOLS,
        *CHAT_HISTORY_TOOLS,
        *ANALYTICS_CONTEXT_TOOLS,
        *SQL_MEMORY_TOOLS,
    ]
    tools = wrap_tools_with_runtime_hooks(tools, workspace_root_override)
    # To use MCP server tools instead, replace the line above with:
    #   mcp_client = init_mcp_client(workspace_client or sp_workspace_client)
    #   try:
    #       tools.extend(await mcp_client.get_tools())
    #   except Exception:
    #       logger.warning("Failed to fetch MCP tools. Continuing without MCP tools.", exc_info=True)
    return create_agent(
        tools=tools,
        model=ChatDatabricks(endpoint=agent_model_endpoint()),
        system_prompt=AGENT_SYSTEM_PROMPT,
    )


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
    request_started = perf_counter()
    output_items: list[dict] = []
    run_error: str | None = None
    record_task_request(turn_items)
    emit_runtime_hook_event(
        current_workspace_root,
        "SessionStart",
        {
            "conversation_id": get_session_id(request),
            "memory_mode": requested_memory_mode(),
            "context_mode": requested_context_mode(),
            "response_mode": requested_response_mode(),
        },
    )
    task_scratchpad_block = build_task_scratchpad_block()
    tool_memory_block = build_tool_memory_block()
    skill_blocks = build_skill_blocks(turn_items)
    workflow_blocks = build_playbook_blocks(turn_items)
    repo_instruction_blocks = build_repo_instruction_blocks(current_workspace_root)
    hook_instruction_blocks = [
        *build_runtime_hook_blocks(current_workspace_root, "SessionStart"),
        *build_runtime_hook_blocks(current_workspace_root, "BeforeAgent"),
    ]
    conversation_id = get_session_id(request)
    memory_mode = requested_memory_mode()
    context_mode = requested_context_mode()
    response_mode = requested_response_mode()
    style_block = response_style_block()
    user_profile_block = (
        "\n\n".join(build_profile_blocks(current_workspace_root)) or None
        if context_mode != "fresh"
        else None
    )
    approval_request_id, approval_approved = detect_approval_response(turn_items)
    if approval_request_id and approval_approved is True:
        text = apply_staged_write_by_approval_id(approval_request_id)
        emit_runtime_hook_event(
            current_workspace_root,
            "ApprovalApplied",
            {
                "conversation_id": conversation_id,
                "approval_request_id": approval_request_id,
            },
        )
        output_item = assistant_text_output_item(text)
        yield ResponsesAgentStreamEvent(**create_text_delta(delta=text, item_id=output_item["id"]))
        yield ResponsesAgentStreamEvent(type="response.output_item.done", item=output_item)
        if conversation_id:
            try:
                get_memory_store().save_messages(conversation_id, [output_item])
            except Exception:
                logger.exception("Failed to persist approval-write confirmation.")
            else:
                _run_background(
                    maybe_refresh_memory(
                        conversation_id,
                        mode=memory_mode,
                        repo=current_workspace_root,
                    )
                )
        emit_runtime_hook_event(
            current_workspace_root,
            "Stop",
            {
                "conversation_id": conversation_id,
                "duration_ms": round((perf_counter() - request_started) * 1000, 1),
                "output_item_count": 1,
                "error": None,
            },
        )
        return

    if conversation_id:
        mlflow.update_current_trace(metadata={"mlflow.trace.session": conversation_id})
        store = get_memory_store()
        store.save_messages(conversation_id, turn_items)
        memory_state = store.load_memory_state(
            conversation_id, recent_messages_limit=recent_messages_limit(memory_mode)
        )
        optimized_input = build_optimized_messages(
            turn_items,
            memory_state,
            memory_mode=memory_mode,
            user_profile_block=user_profile_block,
            repo_instruction_blocks=repo_instruction_blocks,
            hook_instruction_blocks=hook_instruction_blocks,
            task_scratchpad_block=task_scratchpad_block,
            tool_memory_block=tool_memory_block,
            skill_blocks=skill_blocks,
            workflow_blocks=workflow_blocks,
            response_style_block=style_block,
        )
    else:
        optimized_input = build_optimized_messages(
            turn_items,
            state=None,
            memory_mode=memory_mode,
            user_profile_block=user_profile_block,
            repo_instruction_blocks=repo_instruction_blocks,
            hook_instruction_blocks=hook_instruction_blocks,
            task_scratchpad_block=task_scratchpad_block,
            tool_memory_block=tool_memory_block,
            skill_blocks=skill_blocks,
            workflow_blocks=workflow_blocks,
            response_style_block=style_block,
        )

    # By default, uses service principal credentials.
    # For on-behalf-of user authentication, use get_user_workspace_client() instead:
    #   agent = await init_agent(workspace_client=get_user_workspace_client())
    set_filesystem_tool_context(optimized_input)
    try:
        emit_runtime_hook_event(
            current_workspace_root,
            "BeforeAgent",
            {
                "conversation_id": conversation_id,
                "memory_mode": memory_mode,
                "context_mode": context_mode,
                "response_mode": response_mode,
                "repo_instruction_blocks": len(repo_instruction_blocks),
                "workflow_blocks": len(workflow_blocks),
                "skill_blocks": len(skill_blocks),
            },
        )
        agent = await init_agent(workspace_root_override=current_workspace_root)
        messages = {"messages": to_chat_completions_input(optimized_input)}

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
                _run_background(
                    maybe_refresh_memory(
                        conversation_id,
                        mode=memory_mode,
                        repo=current_workspace_root,
                    )
                )
        if output_items and context_mode != "fresh":
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
    except Exception as exc:
        run_error = str(exc)
        emit_runtime_hook_event(
            current_workspace_root,
            "StopFailure",
            {
                "conversation_id": conversation_id,
                "error": run_error,
                "duration_ms": round((perf_counter() - request_started) * 1000, 1),
            },
        )
        raise
    finally:
        emit_runtime_hook_event(
            current_workspace_root,
            "Stop",
            {
                "conversation_id": conversation_id,
                "duration_ms": round((perf_counter() - request_started) * 1000, 1),
                "output_item_count": len(output_items),
                "error": run_error,
            },
        )
        clear_filesystem_tool_context()
