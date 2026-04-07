import logging
import uuid
from typing import Any, AsyncGenerator, AsyncIterator, Optional

from databricks.sdk import WorkspaceClient
from databricks_langchain.chat_models import json
from langchain.messages import AIMessageChunk, ToolMessage
from mlflow.genai.agent_server import get_request_headers
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentStreamEvent,
    create_text_delta,
    output_to_responses_items_stream,
)

from agent_server.filesystem_tools import is_staged_write_marker, parse_staged_write_marker


def get_session_id(request: ResponsesAgentRequest) -> str | None:
    if request.context and request.context.conversation_id:
        return request.context.conversation_id
    if request.custom_inputs and isinstance(request.custom_inputs, dict):
        return request.custom_inputs.get("session_id")
    return None


def get_user_workspace_client() -> WorkspaceClient:
    token = get_request_headers().get("x-forwarded-access-token")
    return WorkspaceClient(token=token, auth_type="pat")


def get_databricks_host_from_env() -> Optional[str]:
    try:
        w = WorkspaceClient()
        return w.config.host
    except Exception as e:
        logging.exception(f"Error getting databricks host from env: {e}")
        return None


async def process_agent_astream_events(
    async_stream: AsyncIterator[Any],
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    """
    Generic helper to process agent stream events and yield ResponsesAgentStreamEvent objects.

    Args:
        async_stream: The async iterator from agent.astream()
    """
    async for event in async_stream:
        if event[0] == "updates":
            for node_data in event[1].values():
                if len(node_data.get("messages", [])) > 0:
                    normal_messages = []
                    for msg in node_data["messages"]:
                        if isinstance(msg, ToolMessage) and not isinstance(msg.content, str):
                            msg.content = json.dumps(msg.content)
                        if isinstance(msg, ToolMessage) and isinstance(msg.content, str):
                            if is_staged_write_marker(msg.content):
                                marker = parse_staged_write_marker(msg.content)
                                yield ResponsesAgentStreamEvent(
                                    type="response.output_item.done",
                                    item={
                                        "type": "mcp_approval_request",
                                        "id": marker["request_id"],
                                        "name": marker["tool_name"],
                                        "arguments": json.dumps(
                                            {
                                                "summary": marker.get("summary"),
                                                "rationale": marker.get("rationale"),
                                                "riskLevel": marker.get("risk_level"),
                                                "workspaceRoot": marker.get("workspace_root"),
                                                "instruction": marker.get("instruction"),
                                                "changes": marker.get("changes", []),
                                            }
                                        ),
                                        "server_label": marker["server_label"],
                                    },
                                    output_index=0,
                                    sequence_number=0,
                                )
                                continue
                        normal_messages.append(msg)
                    if normal_messages:
                        for item in output_to_responses_items_stream(normal_messages):
                            yield item
        elif event[0] == "messages":
            try:
                chunk = event[1][0]
                if isinstance(chunk, AIMessageChunk) and (content := chunk.content):
                    yield ResponsesAgentStreamEvent(
                        **create_text_delta(delta=content, item_id=chunk.id)
                    )
            except Exception as e:
                logging.exception(f"Error processing agent stream event: {e}")


def assistant_text_output_item(text: str) -> dict[str, Any]:
    return {
        "id": f"msg_{uuid.uuid4().hex}",
        "content": [
            {
                "annotations": [],
                "text": text,
                "type": "output_text",
                "logprobs": None,
            }
        ],
        "role": "assistant",
        "status": "completed",
        "type": "message",
    }
