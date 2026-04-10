import { useState, useCallback } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@chat-template/core';
import { fetchWithErrorHandlers } from '@/lib/utils';

interface ApprovalSubmission {
  approvalRequestId: string;
  toolName: string;
  approve: boolean;
}

interface UseApprovalOptions {
  chatId: string;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
}

/**
 * Hook for handling MCP approval requests.
 *
 * When user approves/denies, this hook:
 * 1. Adds the tool approval response via addToolApprovalResponse()
 * 2. Calls sendMessage() without arguments to trigger continuation (for approvals only)
 */
export function useApproval({
  chatId,
  setMessages,
}: UseApprovalOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(
    null,
  );

  const submitApproval = useCallback(
    async ({ approvalRequestId, toolName, approve }: ApprovalSubmission) => {
      setIsSubmitting(true);
      setPendingApprovalId(approvalRequestId);

      try {
        let nextMessages: ChatMessage[] = [];
        setMessages((currentMessages) =>
          (nextMessages = currentMessages.map((message) => {
            if (message.role !== 'assistant') {
              return message;
            }

            let changed = false;
            const parts = message.parts.map((part) => {
              if (
                part.type !== 'dynamic-tool' ||
                part.toolCallId !== approvalRequestId ||
                part.toolName !== toolName
              ) {
                return part;
              }

              changed = true;

              if (approve) {
                return {
                  ...part,
                  state: 'approval-responded' as const,
                  output: undefined,
                  approval: {
                    id: approvalRequestId,
                    approved: true,
                  },
                };
              }

              return {
                ...part,
                state: 'output-denied' as const,
                output: undefined,
                approval: {
                  id: approvalRequestId,
                  approved: false,
                },
              };
            });

            return changed ? { ...message, parts } : message;
          })),
        );

        const response = await fetchWithErrorHandlers(`/api/chat/${chatId}/approval`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            approvalRequestId,
            approved: approve,
            previousMessages: nextMessages,
          }),
        });

        const payload = (await response.json()) as { message?: ChatMessage | null };
        if (payload.message) {
          setMessages((currentMessages) => [...currentMessages, payload.message as ChatMessage]);
        }
      } catch (error) {
        console.error('Approval submission failed:', error);
      } finally {
        setIsSubmitting(false);
        setPendingApprovalId(null);
      }
    },
    [chatId, setMessages],
  );

  return {
    submitApproval,
    isSubmitting,
    pendingApprovalId,
  };
}
