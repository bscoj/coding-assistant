import logging
import uuid
from typing import Any, AsyncGenerator, AsyncIterator, Optional

from databricks.sdk import WorkspaceClient
from databricks_langchain.chat_models import json
from langchain.messages import AIMessage, AIMessageChunk, ToolMessage
from mlflow.genai.agent_server import get_request_headers
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentStreamEvent,
    create_text_delta,
    output_to_responses_items_stream,
)

from agent_server.filesystem_tools import (
    approval_payload_for_staged_write,
    is_staged_write_marker,
    parse_staged_write_marker,
)


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


def _response_usage_from_usage_metadata(usage_metadata: Any) -> dict[str, Any] | None:
    if usage_metadata is None:
        return None

    if isinstance(usage_metadata, dict):
        input_tokens = usage_metadata.get("input_tokens")
        output_tokens = usage_metadata.get("output_tokens")
        total_tokens = usage_metadata.get("total_tokens")
        input_token_details = usage_metadata.get("input_token_details") or {}
        output_token_details = usage_metadata.get("output_token_details") or {}
    else:
        input_tokens = getattr(usage_metadata, "input_tokens", None)
        output_tokens = getattr(usage_metadata, "output_tokens", None)
        total_tokens = getattr(usage_metadata, "total_tokens", None)
        input_token_details = getattr(usage_metadata, "input_token_details", None) or {}
        output_token_details = getattr(usage_metadata, "output_token_details", None) or {}

    if input_tokens is None and output_tokens is None and total_tokens is None:
        return None

    resolved_input = input_tokens or 0
    resolved_output = output_tokens or 0
    resolved_total = total_tokens or (resolved_input + resolved_output)

    def _detail_value(source: Any, key: str) -> int:
        if isinstance(source, dict):
            return int(source.get(key) or 0)
        return int(getattr(source, key, 0) or 0)

    return {
        "input_tokens": int(resolved_input),
        "input_tokens_details": {
            "cached_tokens": _detail_value(input_token_details, "cache_read"),
        },
        "output_tokens": int(resolved_output),
        "output_tokens_details": {
            "reasoning_tokens": _detail_value(output_token_details, "reasoning"),
        },
        "total_tokens": int(resolved_total),
    }


async def process_agent_astream_events(
    async_stream: AsyncIterator[Any],
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    """
    Generic helper to process agent stream events and yield ResponsesAgentStreamEvent objects.

    Args:
        async_stream: The async iterator from agent.astream()
    """
    latest_usage: dict[str, Any] | None = None
    response_id: str | None = None

    async for event in async_stream:
        if event[0] == "updates":
            for node_data in event[1].values():
                if len(node_data.get("messages", [])) > 0:
                    normal_messages = []
                    for msg in node_data["messages"]:
                        if response_id is None:
                            response_id = getattr(msg, "id", None)
                        usage = _response_usage_from_usage_metadata(
                            getattr(msg, "usage_metadata", None),
                        )
                        if usage:
                            latest_usage = usage
                        if isinstance(msg, ToolMessage) and not isinstance(msg.content, str):
                            msg.content = json.dumps(msg.content)
                        if isinstance(msg, ToolMessage) and isinstance(msg.content, str):
                            if is_staged_write_marker(msg.content):
                                marker = parse_staged_write_marker(msg.content)
                                approval_payload = approval_payload_for_staged_write(
                                    marker["request_id"],
                                    marker,
                                )
                                yield ResponsesAgentStreamEvent(
                                    type="response.output_item.done",
                                    item={
                                        "type": "mcp_approval_request",
                                        "id": marker["request_id"],
                                        "name": marker["tool_name"],
                                        "arguments": json.dumps(approval_payload),
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
                if isinstance(chunk, (AIMessage, AIMessageChunk)):
                    if response_id is None:
                        response_id = getattr(chunk, "id", None)
                    usage = _response_usage_from_usage_metadata(
                        getattr(chunk, "usage_metadata", None),
                    )
                    if usage:
                        latest_usage = usage
                if isinstance(chunk, AIMessageChunk) and (content := chunk.content):
                    yield ResponsesAgentStreamEvent(
                        **create_text_delta(delta=content, item_id=chunk.id)
                    )
            except Exception as e:
                logging.exception(f"Error processing agent stream event: {e}")

    if latest_usage:
        yield ResponsesAgentStreamEvent(
            type="responses.completed",
            response={
                "id": response_id or f"resp_{uuid.uuid4().hex}",
                "status": "completed",
                "usage": latest_usage,
            },
        )


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
