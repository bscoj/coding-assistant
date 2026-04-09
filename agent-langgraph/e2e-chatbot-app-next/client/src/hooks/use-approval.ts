import { useState, useCallback } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@chat-template/core';

interface ApprovalSubmission {
  approvalRequestId: string;
  toolName: string;
  approve: boolean;
}

interface UseApprovalOptions {
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
}

/**
 * Hook for handling MCP approval requests.
 *
 * When user approves/denies, this hook:
 * 1. Adds the tool approval response via addToolApprovalResponse()
 * 2. Calls sendMessage() without arguments to trigger continuation (for approvals only)
 */
export function useApproval({
  setMessages,
  sendMessage,
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
        setMessages((currentMessages) =>
          currentMessages.map((message) => {
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
          }),
        );

        // Only trigger continuation for approvals
        // For denials, the UI state is updated and we don't need server response
        if (approve) {
          await sendMessage();
        }
      } catch (error) {
        console.error('Approval submission failed:', error);
      } finally {
        setIsSubmitting(false);
        setPendingApprovalId(null);
      }
    },
    [sendMessage, setMessages],
  );

  return {
    submitApproval,
    isSubmitting,
    pendingApprovalId,
  };
}
