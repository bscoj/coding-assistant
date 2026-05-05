import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import {
  convertToModelMessages,
  createUIMessageStream,
  streamText,
  generateText,
  type LanguageModelUsage,
  pipeUIMessageStreamToResponse,
} from 'ai';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';

// Convert ai's LanguageModelUsage to @ai-sdk/provider's LanguageModelV3Usage
function toV3Usage(usage: LanguageModelUsage): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: undefined,
      reasoning: undefined,
    },
  };
}
import {
  authMiddleware,
  requireAuth,
  requireChatAccess,
  getIdFromRequest,
} from '../middleware/auth';
import {
  deleteChatById,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatLastContextById,
  updateChatVisiblityById,
  isDatabaseAvailable,
  updateChatTitleById,
  type Chat,
  type DBMessage,
} from '@chat-template/db';
import {
  type ChatMessage,
  checkChatAccess,
  convertToUIMessages,
  generateUUID,
  myProvider,
  postRequestBodySchema,
  type PostRequestBody,
  StreamCache,
  type VisibilityType,
  CONTEXT_HEADER_CONVERSATION_ID,
  CONTEXT_HEADER_USER_ID,
} from '@chat-template/core';
import { ChatSDKError } from '@chat-template/core/errors';
import { storeMessageMeta } from '../lib/message-meta-store';
import { drainStreamToWriter, fallbackToGenerateText } from '../lib/stream-fallback';
import { shouldFailFastForLocalApiProxy } from '../lib/local-api-proxy';
import { getLocalRepoConfig } from '../lib/local-repo-store';
import {
  checkLocalChatAccess,
  deleteLocalChatById,
  getLocalMessagesByChatId,
  isLocalChatHistoryEnabled,
  saveLocalChat,
  saveLocalMessages,
  updateLocalChatLastContextById,
  updateLocalChatTitleById,
  updateLocalChatVisiblityById,
} from '../lib/local-chat-store';
import {
  getLocalContextConfig,
  getLocalMemoryConfig,
  getLocalResponseConfig,
  getLocalSqlKnowledgeConfig,
} from '../lib/local-app-settings';

export const chatRouter: RouterType = Router();
const NO_WORKSPACE_SELECTED_MARKER = '__NO_WORKSPACE_SELECTED__';

const streamCache = new StreamCache();
// Apply auth middleware to all chat routes
chatRouter.use(authMiddleware);

function normalizeLegacyApprovalParts(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.parts)) {
      return message;
    }

    let changed = false;
    const parts = message.parts.map((part) => {
      if (
        part?.type !== 'dynamic-tool' ||
        part?.state !== 'output-available' ||
        !part?.output ||
        typeof part.output !== 'object' ||
        !('__approvalStatus__' in part.output)
      ) {
        return part;
      }

      changed = true;
      const approved = Boolean((part.output as { __approvalStatus__?: unknown }).__approvalStatus__);
      const approvalId =
        part.approval?.id ??
        (typeof part.toolCallId === 'string' ? part.toolCallId : undefined);

      if (!approvalId) {
        return part;
      }

      if (!approved) {
        return {
          ...part,
          state: 'output-denied' as const,
          output: undefined,
          approval: {
            id: approvalId,
            approved: false,
          },
        };
      }

      return {
        ...part,
        state: 'approval-responded' as const,
        output: undefined,
        approval: {
          id: approvalId,
          approved: true,
        },
      };
    });

    return changed ? { ...message, parts } : message;
  });
}

function shouldUseLocalHistory(dbAvailable: boolean) {
  return !dbAvailable && isLocalChatHistoryEnabled();
}

function extractAssistantTextFromResponsesOutput(output: unknown): string {
  if (!Array.isArray(output)) {
    return '';
  }

  const parts: string[] = [];
  for (const item of output) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    if ((item as { role?: string }).role !== 'assistant') {
      continue;
    }
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const chunk of content) {
      if (
        typeof chunk === 'object' &&
        chunk !== null &&
        (chunk as { type?: string }).type === 'output_text' &&
        typeof (chunk as { text?: string }).text === 'string'
      ) {
        parts.push((chunk as { text: string }).text);
      }
    }
  }

  return parts.join('').trim();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isStreamingGuardrailError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('output guardrail') &&
    message.includes('streaming mode')
  );
}

function hasTokenUsage(usage: LanguageModelUsage | undefined): boolean {
  if (!usage) {
    return false;
  }

  return (
    (usage.inputTokens ?? 0) > 0 ||
    (usage.outputTokens ?? 0) > 0 ||
    (usage.totalTokens ?? 0) > 0
  );
}

function isVisibilityType(value: unknown): value is VisibilityType {
  return value === 'private' || value === 'public';
}

function parseClientMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeLegacyApprovalParts(
    value.filter((message): message is ChatMessage => {
      return (
        typeof message === 'object' &&
        message !== null &&
        typeof (message as { id?: unknown }).id === 'string' &&
        typeof (message as { role?: unknown }).role === 'string' &&
        Array.isArray((message as { parts?: unknown }).parts)
      );
    }),
  );
}

function stringifyForCompaction(value: unknown, maxLength = 4000): string {
  if (typeof value === 'string') {
    return truncatePreserveWords(value.replace(/\s+/g, ' ').trim(), maxLength);
  }

  try {
    const json = JSON.stringify(value, null, 2);
    return truncatePreserveWords(json, maxLength);
  } catch {
    return truncatePreserveWords(String(value), maxLength);
  }
}

function formatPartForCompaction(part: unknown): string {
  if (typeof part !== 'object' || part === null) {
    return '';
  }

  const typed = part as {
    type?: unknown;
    text?: unknown;
    data?: unknown;
    state?: unknown;
    toolName?: unknown;
    input?: unknown;
    output?: unknown;
    result?: unknown;
    errorText?: unknown;
  };
  const type = typeof typed.type === 'string' ? typed.type : 'part';

  if (type === 'text' && typeof typed.text === 'string') {
    return typed.text.trim();
  }

  if (type.startsWith('source-') || type === 'step-start') {
    return '';
  }

  if (type.startsWith('data-')) {
    const value = stringifyForCompaction(typed.data, 1600);
    return value ? `[${type}] ${value}` : '';
  }

  if (type.includes('tool') || typeof typed.toolName === 'string') {
    const segments = [
      `Tool${typeof typed.toolName === 'string' ? ` ${typed.toolName}` : ''}`,
      typeof typed.state === 'string' ? `state=${typed.state}` : undefined,
      typed.input !== undefined
        ? `input=${stringifyForCompaction(typed.input, 1600)}`
        : undefined,
      typed.output !== undefined
        ? `output=${stringifyForCompaction(typed.output, 2400)}`
        : undefined,
      typed.result !== undefined
        ? `result=${stringifyForCompaction(typed.result, 2400)}`
        : undefined,
      typed.errorText !== undefined
        ? `error=${stringifyForCompaction(typed.errorText, 1200)}`
        : undefined,
    ].filter(Boolean);

    return segments.join('\n');
  }

  return `[${type}] ${stringifyForCompaction(part, 1200)}`;
}

function truncateMiddlePreserveEnds(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }

  const headLength = Math.floor(maxLength * 0.35);
  const tailLength = maxLength - headLength;
  const omitted = input.length - headLength - tailLength;

  return `${input.slice(0, headLength)}\n\n[... omitted ${omitted.toLocaleString()} characters from the middle of the chat transcript ...]\n\n${input.slice(-tailLength)}`;
}

function messagesToCompactionTranscript(messages: ChatMessage[]) {
  const blocks = messages.map((message, index) => {
    const createdAt = message.metadata?.createdAt
      ? ` at ${message.metadata.createdAt}`
      : '';
    const content = message.parts
      .map(formatPartForCompaction)
      .filter(Boolean)
      .join('\n\n')
      .trim();

    return `### ${index + 1}. ${message.role}${createdAt}\n${content || '[non-text or empty message]'}`;
  });

  return truncateMiddlePreserveEnds(blocks.join('\n\n'), 90000);
}

function extractFileHints(text: string) {
  const matches = text.match(
    /(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|py|md|yml|yaml|json|sql|css|scss|html))/g,
  );
  if (!matches) {
    return [];
  }

  return Array.from(
    new Set(matches.map(match => match.trim()).filter(Boolean)),
  ).slice(0, 24);
}

function extractCodeBlocks(text: string) {
  const blocks = Array.from(text.matchAll(/```[\s\S]*?```/g))
    .map(match => match[0])
    .filter(Boolean);

  return blocks.slice(-4).map(block => truncatePreserveWords(block, 2400));
}

function fallbackCompactionSummary({
  messages,
  transcript,
  title,
}: {
  messages: ChatMessage[];
  transcript: string;
  title: string;
}) {
  const firstUser = messages.find(message => message.role === 'user');
  const recentMessages = messages.slice(-8);
  const fileHints = extractFileHints(transcript);
  const codeBlocks = extractCodeBlocks(transcript);
  const objective = firstUser
    ? firstUser.parts
        .map(formatPartForCompaction)
        .filter(Boolean)
        .join('\n\n')
        .trim()
    : '';

  return [
    '# Compacted Handoff',
    '',
    '## Main Objective',
    objective
      ? truncatePreserveWords(objective, 1800)
      : `Continue the work from "${title}".`,
    '',
    '## Current State',
    `This handoff was generated from ${messages.length} messages. The model summary call was unavailable, so this fallback preserves the main objective, recent transcript, file hints, and recent code blocks.`,
    '',
    '## Important Files',
    fileHints.length > 0 ? fileHints.map(file => `- ${file}`).join('\n') : '- No file paths were detected.',
    '',
    '## Recent Conversation',
    recentMessages
      .map((message, index) => {
        const text = message.parts
          .map(formatPartForCompaction)
          .filter(Boolean)
          .join('\n\n');
        return `### ${index + 1}. ${message.role}\n${truncatePreserveWords(text || '[empty]', 2200)}`;
      })
      .join('\n\n'),
    '',
    '## Recent Code',
    codeBlocks.length > 0 ? codeBlocks.join('\n\n') : 'No code blocks were detected.',
    '',
    '## Next Step',
    'Use this handoff as the context for the fresh session and continue from the most recent user request.',
  ].join('\n');
}

function normalizeCompactionSummary(summary: string, fallback: string) {
  const cleaned = summary
    .replace(/^[`"'\s]+|[`"'\s]+$/g, '')
    .trim();

  if (!cleaned) {
    return fallback;
  }

  return cleaned.startsWith('#')
    ? cleaned
    : `# Compacted Handoff\n\n${cleaned}`;
}

async function generateCompactionSummary({
  messages,
  title,
  modelId,
}: {
  messages: ChatMessage[];
  title: string;
  modelId: string;
}) {
  const transcript = messagesToCompactionTranscript(messages);
  const fallback = fallbackCompactionSummary({ messages, transcript, title });

  try {
    const model = await myProvider.languageModel(modelId || 'title-model');
    const failFastForLocalApiProxy = shouldFailFastForLocalApiProxy();
    const { text } = await generateText({
      model,
      ...(failFastForLocalApiProxy ? { maxRetries: 0 } : {}),
      maxOutputTokens: 2400,
      system: `You compress long coding-agent conversations into precise handoff summaries for a fresh session.

Return Markdown only with these sections:
# Compacted Handoff
## Main Objective
## Current State
## Important Decisions
## Files And Code
## Errors And Gotchas
## Data, SQL, Or Databricks Context
## Open Questions
## Next Steps

Rules:
- Preserve exact file paths, function names, commands, schema/table names, endpoint names, settings, and branch names.
- Preserve important code snippets only when they are needed to continue safely.
- Prefer concrete state over narrative.
- Remove small talk, repetition, and stale exploration.
- Keep the result concise enough to seed a new chat, but do not lose production-relevant implementation details.`,
      prompt: [
        `Chat title: ${title}`,
        `Message count: ${messages.length}`,
        '',
        'Transcript:',
        transcript,
      ].join('\n'),
    });

    return normalizeCompactionSummary(text, fallback);
  } catch (error) {
    console.warn('[Compact Chat] Model summary failed; using fallback', error);
    return fallback;
  }
}

function compactedChatTitle(title: string) {
  const cleaned = title.replace(/^Compacted:\s*/i, '').trim() || 'Chat';
  return truncatePreserveWords(`Compacted: ${cleaned}`, 64);
}

function buildCompactionSeedMessage({
  oldChatId,
  title,
  summary,
}: {
  oldChatId: string;
  title: string;
  summary: string;
}) {
  return [
    `Compacted conversation handoff from "${title}" (${oldChatId}).`,
    '',
    'Use this as the starting context for this fresh session. Do not ask me to repeat prior details unless something is ambiguous.',
    '',
    summary,
  ].join('\n');
}

/**
 * POST /api/chat - Send a message and get streaming response
 *
 * When the database is disabled, this route falls back to local JSON-backed
 * chat persistence if LOCAL_CHAT_HISTORY_ENABLED is not set to false.
 */
chatRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const dbAvailable = isDatabaseAvailable();
  if (!dbAvailable) {
    console.log(
      `[Chat] Database unavailable - ${
        shouldUseLocalHistory(dbAvailable)
          ? 'using local chat history'
          : 'running in ephemeral mode'
      }`,
    );
  }

  let requestBody: PostRequestBody;

  try {
    requestBody = postRequestBodySchema.parse(req.body);
  } catch (_) {
    console.error('Error parsing request body:', _);
    const error = new ChatSDKError('bad_request:api');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType: _selectedVisibilityType,
    }: {
      id: string;
      message?: ChatMessage;
      selectedChatModel: string;
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = req.session;
    if (!session) {
      const error = new ChatSDKError('unauthorized:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    const { chat, allowed, reason } = shouldUseLocalHistory(dbAvailable)
      ? await checkLocalChatAccess(id, session?.user.id)
      : await checkChatAccess(id, session?.user.id);

    if (reason !== 'not_found' && !allowed) {
      const error = new ChatSDKError('forbidden:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    let titlePromise: Promise<string | null> | undefined;

    if (!chat) {
      // Only create new chat if we have a message (not a continuation)
      if (message) {
        const chatRecord = {
          id,
          userId: session.user.id,
          title: 'New chat',
          visibility: 'private',
          createdAt: new Date(),
          lastContext: null,
        };
        if (dbAvailable) {
          await saveChat(chatRecord);
        } else if (isLocalChatHistoryEnabled()) {
          await saveLocalChat(chatRecord);
        }

        titlePromise = generateTitleFromUserMessage({ message })
          .then(async (title) => {
            if (dbAvailable) {
              await updateChatTitleById({ chatId: id, title });
            } else if (isLocalChatHistoryEnabled()) {
              await updateLocalChatTitleById({ chatId: id, title });
            }
            return title;
          })
          .catch(async (error) => {
            console.error('Error generating title:', error);
            const textFromUserMessage = message?.parts.find(
              (part) => part.type === 'text',
            )?.text;
            if (textFromUserMessage) {
              const fallback = truncatePreserveWords(
                textFromUserMessage,
                128,
              );
              if (dbAvailable) {
                await updateChatTitleById({ chatId: id, title: fallback });
              } else if (isLocalChatHistoryEnabled()) {
                await updateLocalChatTitleById({ chatId: id, title: fallback });
              }
              return fallback;
            }
            return null;
          });
      }
    } else {
      if (chat.userId !== session.user.id) {
        const error = new ChatSDKError('forbidden:chat');
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
    }

    const messagesFromDb = dbAvailable
      ? await getMessagesByChatId({ id })
      : shouldUseLocalHistory(dbAvailable)
        ? await getLocalMessagesByChatId(id)
        : [];

    // Use previousMessages from request body when:
    // 1. Ephemeral mode (DB not available) - always use client-side messages
    // 2. Continuation request (no message) - tool results only exist client-side
    const useClientMessages =
      !dbAvailable || (!message && requestBody.previousMessages);
    const normalizedPreviousMessages = normalizeLegacyApprovalParts(
      requestBody.previousMessages ?? [],
    );
    const previousMessages = useClientMessages
      ? normalizedPreviousMessages
      : normalizeLegacyApprovalParts(convertToUIMessages(messagesFromDb));

    // If message is provided, add it to the list and save it
    // If not (continuation/regeneration), just use previous messages
    let uiMessages: ChatMessage[];
    if (message) {
      uiMessages = [...previousMessages, message];
      const persistedMessage = {
        chatId: id,
        id: message.id,
        role: 'user',
        parts: message.parts,
        attachments: [],
        createdAt: new Date(),
        traceId: null,
      };
      if (dbAvailable) {
        await saveMessages({ messages: [persistedMessage] });
      } else if (shouldUseLocalHistory(dbAvailable)) {
        await saveLocalMessages([persistedMessage]);
      }
    } else {
      // Continuation: use existing messages without adding new user message
      uiMessages = previousMessages as ChatMessage[];

      // For continuations with database enabled, save any updated assistant messages
      // This ensures tool-result parts (like MCP approval responses) are persisted
      if ((dbAvailable || shouldUseLocalHistory(dbAvailable)) && normalizedPreviousMessages.length > 0) {
        const assistantMessages = normalizedPreviousMessages.filter(
          (m: ChatMessage) => m.role === 'assistant',
        );
        if (assistantMessages.length > 0) {
          const persistedMessages = assistantMessages.map((m: ChatMessage) => ({
            chatId: id,
            id: m.id,
            role: m.role,
            parts: m.parts,
            attachments: [],
            createdAt: m.metadata?.createdAt
              ? new Date(m.metadata.createdAt)
              : new Date(),
            traceId: null,
          }));
          if (dbAvailable) {
            await saveMessages({ messages: persistedMessages });
          } else {
            await saveLocalMessages(persistedMessages);
          }

          // Check if this is an MCP denial - if so, we're done (no need to call LLM)
          // Denial is indicated by a dynamic-tool part with state 'output-denied'
          // or with approval.approved === false
          const hasMcpDenial = normalizedPreviousMessages.some(
            (m: ChatMessage) =>
              m.parts?.some(
                (p) =>
                  p.type === 'dynamic-tool' &&
                  (p.state === 'output-denied' ||
                    ('approval' in p && p.approval?.approved === false)),
              ),
          );

          if (hasMcpDenial) {
            // We don't need to call the LLM because the user has denied the tool call
            res.end();
            return;
          }
        }
      }
    }

    // Clear any previous active stream for this chat
    streamCache.clearActiveStream(id);

    let finalUsage: LanguageModelUsage | undefined;
    let finalFinishReason:
      | 'stop'
      | 'length'
      | 'content-filter'
      | 'tool-calls'
      | 'error'
      | 'other'
      | undefined;
    let traceId: string | null = null;
    const streamId = generateUUID();
    let activeWriter:
      | {
          write: (chunk: { type: string; data: unknown }) => void;
        }
      | null = null;
    let hasWrittenMemoryStatus = false;

    const model = await myProvider.languageModel(selectedChatModel);
    const modelMessages = await convertToModelMessages(uiMessages, {
      ignoreIncompleteToolCalls: true,
    });
    const repo = getLocalRepoConfig();
    const memory = getLocalMemoryConfig();
    const context = getLocalContextConfig();
    const responseMode = getLocalResponseConfig();
    const sqlKnowledge = getLocalSqlKnowledgeConfig();
    const failFastForLocalApiProxy = shouldFailFastForLocalApiProxy();
    const requestHeaders = {
      [CONTEXT_HEADER_CONVERSATION_ID]: id,
      [CONTEXT_HEADER_USER_ID]: session.user.email ?? session.user.id,
      'x-codex-memory-mode': memory.mode,
      'x-codex-context-mode': context.mode,
      'x-codex-response-mode': responseMode.mode,
      'x-codex-sql-knowledge-mode': sqlKnowledge.mode,
      ...(sqlKnowledge.lakebase.project
        ? { 'x-codex-lakebase-project': sqlKnowledge.lakebase.project }
        : {}),
      ...(sqlKnowledge.lakebase.branch
        ? { 'x-codex-lakebase-branch': sqlKnowledge.lakebase.branch }
        : {}),
      ...(sqlKnowledge.lakebase.instanceName
        ? { 'x-codex-lakebase-instance': sqlKnowledge.lakebase.instanceName }
        : {}),
      ...(selectedChatModel
        ? { 'x-codex-model-endpoint': selectedChatModel }
        : {}),
      'x-codex-workspace-root': repo.path ?? NO_WORKSPACE_SELECTED_MARKER,
      // Forward OBO user token to the backend/serving endpoint
      ...(req.headers['x-forwarded-access-token']
        ? { 'x-forwarded-access-token': req.headers['x-forwarded-access-token'] as string }
        : {}),
    };

    const baseModelParams = {
      model,
      messages: modelMessages,
      ...(failFastForLocalApiProxy ? { maxRetries: 0 } : {}),
      providerOptions: {
        databricks: { includeTrace: true },
      },
      headers: requestHeaders,
    } as const;

    let result: ReturnType<typeof streamText> | undefined;
    let streamInitError: unknown;

    try {
      result = streamText({
        ...baseModelParams,
        includeRawChunks: true,
        onChunk: ({ chunk }) => {
          if (chunk.type === 'raw') {
            const raw = chunk.rawValue as any;
            if (
              !hasWrittenMemoryStatus &&
              raw?.type === 'response.output_item.done' &&
              raw?.item?.type === 'codex_status' &&
              raw?.item?.status === 'memory_compaction' &&
              activeWriter
            ) {
              hasWrittenMemoryStatus = true;
              activeWriter.write({
                type: 'data-memoryStatus',
                data:
                  typeof raw?.item?.message === 'string'
                    ? raw.item.message
                    : 'Compressing memory...',
              });
            }
            if (
              raw?.type === 'response.output_item.done' &&
              raw?.item?.type === 'codex_status' &&
              raw?.item?.status === 'context_pack' &&
              activeWriter
            ) {
              activeWriter.write({
                type: 'data-agentFocus',
                data: {
                  message:
                    typeof raw?.item?.message === 'string'
                      ? raw.item.message
                      : 'Built repo focus',
                  ...(typeof raw?.item?.details === 'object' &&
                  raw.item.details !== null
                    ? raw.item.details
                    : {}),
                },
              });
            }
            // Extract trace in Databricks serving endpoint output format, if present
            if (raw?.type === 'response.output_item.done') {
              const traceIdFromChunk =
                raw?.databricks_output?.trace?.info?.trace_id;
              if (typeof traceIdFromChunk === 'string') {
                traceId = traceIdFromChunk;
              }
            }
            // Extract trace from MLflow AgentServer output format, if present
            if (!traceId && typeof raw?.trace_id === 'string') {
              traceId = raw.trace_id;
            }
          }
        },
        onFinish: ({ usage, totalUsage, finishReason }) => {
          finalUsage = hasTokenUsage(totalUsage) ? totalUsage : usage;
          finalFinishReason = finishReason;
        },
      });
    } catch (error) {
      streamInitError = error;
      console.warn(
        '[Chat] Streaming initialization failed; will fall back to generateText',
        {
          message: getErrorMessage(error),
          guardrailStreamingMismatch: isStreamingGuardrailError(error),
        },
      );
    }

    /**
     * We manually read from toUIMessageStream instead of using writer.merge
     * so the execute promise (and thus the outer stream) stays alive if we
     * need to fall back to generateText after a streaming error.
     */
    const stream = createUIMessageStream({
      // Pass originalMessages so that continuation responses reuse the existing
      // assistant message ID. Without this, handleUIMessageStreamFinish generates
      // a fresh ID, causing the client to push a second assistant message instead
      // of replacing the existing one.
      originalMessages: uiMessages,
      // The DB Message.id column is typed as uuid, so we must generate UUIDs
      // rather than the AI SDK's default short-id format (e.g. "Xt8nZiQRj1fS4yiU").
      generateId: generateUUID,
      execute: async ({ writer }) => {
        activeWriter = writer;
        let hasWrittenFinish = false;
        const writeChunk = (chunk: { type: string; [key: string]: unknown }) => {
          if (chunk.type === 'finish') {
            hasWrittenFinish = true;
          }
          writer.write(chunk);
        };
        const writeUsageIfAvailable = () => {
          if (!finalUsage) {
            return;
          }
          writeChunk({ type: 'data-usage', data: finalUsage });
        };
        const syncResultUsage = async () => {
          if (!result) {
            return;
          }

          const [totalUsageResult, finishReasonResult] = await Promise.allSettled([
            result.totalUsage,
            result.finishReason,
          ]);

          if (
            totalUsageResult.status === 'fulfilled' &&
            hasTokenUsage(totalUsageResult.value)
          ) {
            finalUsage = totalUsageResult.value;
          }

          if (
            !finalFinishReason &&
            finishReasonResult.status === 'fulfilled'
          ) {
            finalFinishReason = finishReasonResult.value;
          }
        };
        const finishStream = () => {
          if (hasWrittenFinish) {
            return;
          }
          writeChunk({
            type: 'finish',
            finishReason: finalFinishReason ?? (finalUsage ? 'stop' : 'error'),
          });
        };

        const runGenerateFallback = async (reason: string) => {
          console.log(`[Chat] ${reason}; falling back to generateText...`);
          const fallbackResult = await fallbackToGenerateText(
            baseModelParams,
            { write: writeChunk },
          );

          finalUsage = fallbackResult?.usage;
          traceId = fallbackResult?.traceId ?? null;
        };

        if (!result) {
          await runGenerateFallback(
            streamInitError
              ? `Streaming unavailable (${getErrorMessage(streamInitError)})`
              : 'Streaming unavailable',
          );

          if (titlePromise) {
            const generatedTitle = await resolveTitleQuickly(titlePromise);
            if (generatedTitle) {
              writeChunk({ type: 'data-title', data: generatedTitle });
            }
          }

          writeUsageIfAvailable();
          writeChunk({ type: 'data-traceId', data: traceId });
          finishStream();
          activeWriter = null;
          return;
        }

        // Manually drain the AI stream so we can append the traceId data part
        // after all model chunks are processed (traceId is captured via onChunk).
        // result.toUIMessageStream() converts TextStreamPart → UIMessageChunk:
        // - text-delta: maps TextStreamPart.text → UIMessageChunk.delta
        // - start-step/finish-step: strips extra fields
        // - finish: strips rawFinishReason/totalUsage
        // - raw: dropped (trace_id captured via onChunk above)
        try {
          const aiStream = result.toUIMessageStream<ChatMessage>({
            sendReasoning: true,
            sendSources: true,
            sendFinish: false,
            onError: (error) => {
              const msg = getErrorMessage(error);
              writer.onError?.(error);
              return msg;
            },
          });

          const { failed, errorText } = await drainStreamToWriter(aiStream, writer);

          if (failed) {
            await runGenerateFallback(
              errorText ? `Streaming failed (${errorText})` : 'Streaming failed',
            );
          }

          await syncResultUsage();
        } catch (error) {
          console.warn(
            '[Chat] Streaming execution failed; will fall back to generateText',
            {
              message: getErrorMessage(error),
              guardrailStreamingMismatch: isStreamingGuardrailError(error),
            },
          );
          await runGenerateFallback(
            `Streaming execution failed (${getErrorMessage(error)})`,
          );
        }

        if (titlePromise) {
          const generatedTitle = await resolveTitleQuickly(titlePromise);
          if (generatedTitle) {
            writeChunk({ type: 'data-title', data: generatedTitle });
          }
        }

        writeUsageIfAvailable();
        // Write traceId so the client knows whether feedback is supported.
        writeChunk({ type: 'data-traceId', data: traceId });
        finishStream();
        activeWriter = null;
      },
      onFinish: async ({ responseMessage }) => {
        // Store in-memory for ephemeral mode (also useful when DB is available)
        storeMessageMeta(responseMessage.id, id, traceId);

        try {
          const responseParts = [...(responseMessage.parts ?? [])];
          if (
            finalUsage &&
            !responseParts.some((part) => part.type === 'data-usage')
          ) {
            responseParts.push({
              type: 'data-usage',
              data: finalUsage,
            } as ChatMessage['parts'][number]);
          }
          if (
            !responseParts.some((part) => part.type === 'data-traceId')
          ) {
            responseParts.push({
              type: 'data-traceId',
              data: traceId,
            } as ChatMessage['parts'][number]);
          }
          const persistedResponse = {
            id: responseMessage.id,
            role: responseMessage.role,
            parts: responseParts,
            createdAt: new Date(),
            attachments: [],
            chatId: id,
            traceId,
          };
          if (dbAvailable) {
            await saveMessages({
              messages: [persistedResponse],
            });
          } else if (shouldUseLocalHistory(dbAvailable)) {
            await saveLocalMessages([persistedResponse]);
          }
        } catch (err) {
          console.error('[onFinish] Failed to save assistant message:', err);
        }

        if (finalUsage) {
          try {
            if (dbAvailable) {
              await updateChatLastContextById({
                chatId: id,
                context: toV3Usage(finalUsage),
              });
            } else if (shouldUseLocalHistory(dbAvailable)) {
              await updateLocalChatLastContextById({
                chatId: id,
                context: toV3Usage(finalUsage),
              });
            }
          } catch (err) {
            console.warn('Unable to persist last usage for chat', id, err);
          }
        }

        streamCache.clearActiveStream(id);
      },
    });

    pipeUIMessageStreamToResponse({
      stream,
      response: res,
      consumeSseStream({ stream }) {
        streamCache.storeStream({
          streamId,
          chatId: id,
          stream,
        });
      },
    });
  } catch (error) {
    console.error('[Chat] Caught error in chat API:', {
      errorType: error?.constructor?.name,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      error,
    });

    if (error instanceof ChatSDKError) {
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    const chatError = new ChatSDKError('offline:chat');
    const response = chatError.toResponse();
    return res.status(response.status).json(response.json);
  }
});

/**
 * POST /api/chat/:id/compact - Summarize a long chat into a fresh session.
 */
chatRouter.post('/:id/compact', requireAuth, async (req: Request, res: Response) => {
  const session = req.session;
  if (!session) {
    const error = new ChatSDKError('unauthorized:chat');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  const dbAvailable = isDatabaseAvailable();
  const useLocalHistory = shouldUseLocalHistory(dbAvailable);

  if (!dbAvailable && !useLocalHistory) {
    const error = new ChatSDKError(
      'bad_request:api',
      'Compaction requires database or local chat history to be enabled.',
    );
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  try {
    const oldChatId = getIdFromRequest(req);
    if (!oldChatId) {
      const error = new ChatSDKError('bad_request:api');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    const { chat, allowed, reason } = useLocalHistory
      ? await checkLocalChatAccess(oldChatId, session.user.id)
      : await checkChatAccess(oldChatId, session.user.id);

    const clientMessages = parseClientMessages(req.body?.previousMessages);

    if (reason !== 'not_found' && !allowed) {
      const error = new ChatSDKError('forbidden:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    if (!chat && clientMessages.length === 0) {
      const error = new ChatSDKError('not_found:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    if (chat && chat.userId !== session.user.id) {
      const error = new ChatSDKError('forbidden:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    const storedMessages = dbAvailable
      ? convertToUIMessages(await getMessagesByChatId({ id: oldChatId }))
      : useLocalHistory
        ? convertToUIMessages(await getLocalMessagesByChatId(oldChatId))
        : [];
    const sourceMessages = normalizeLegacyApprovalParts(
      clientMessages.length > storedMessages.length
        ? clientMessages
        : storedMessages,
    );

    if (sourceMessages.length === 0) {
      const error = new ChatSDKError(
        'bad_request:api',
        'There are no messages to compact.',
      );
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    const sourceTitle = chat?.title ?? 'Unsaved chat';
    const modelId =
      typeof req.body?.selectedChatModel === 'string' &&
      req.body.selectedChatModel.trim()
        ? req.body.selectedChatModel.trim()
        : 'title-model';
    const summary = await generateCompactionSummary({
      messages: sourceMessages,
      title: sourceTitle,
      modelId,
    });

    const newChatId = generateUUID();
    const title = compactedChatTitle(sourceTitle);
    const visibility: VisibilityType = isVisibilityType(req.body?.selectedVisibilityType)
      ? req.body.selectedVisibilityType
      : isVisibilityType(chat?.visibility)
        ? chat.visibility
        : 'private';
    const now = new Date();
    const chatRecord: Chat = {
      id: newChatId,
      userId: session.user.id,
      title,
      visibility,
      createdAt: now,
      lastContext: null,
    };
    const seedText = buildCompactionSeedMessage({
      oldChatId,
      title: sourceTitle,
      summary,
    });
    const seededMessages: DBMessage[] = [
      {
        chatId: newChatId,
        id: generateUUID(),
        role: 'user',
        parts: [{ type: 'text' as const, text: seedText }],
        attachments: [],
        createdAt: now,
        traceId: null,
      },
      {
        chatId: newChatId,
        id: generateUUID(),
        role: 'assistant',
        parts: [
          {
            type: 'text' as const,
            text: 'Ready to continue from this compacted handoff.',
          },
        ],
        attachments: [],
        createdAt: new Date(now.getTime() + 1),
        traceId: null,
      },
    ];

    if (dbAvailable) {
      await saveChat(chatRecord);
      await saveMessages({ messages: seededMessages });
    } else {
      await saveLocalChat(chatRecord);
      await saveLocalMessages(seededMessages);
    }

    return res.status(200).json({
      chatId: newChatId,
      title,
      messageCount: sourceMessages.length,
      summary,
    });
  } catch (error) {
    console.error('[Compact Chat] Failed to compact chat:', error);
    if (error instanceof ChatSDKError) {
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    const chatError = new ChatSDKError(
      'offline:chat',
      error instanceof Error ? error.message : String(error),
    );
    const response = chatError.toResponse();
    return res.status(response.status).json(response.json);
  }
});

chatRouter.post('/:id/approval', requireAuth, async (req: Request, res: Response) => {
  const session = req.session;
  if (!session) {
    const error = new ChatSDKError('unauthorized:chat');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  const dbAvailable = isDatabaseAvailable();
  const chatId = req.params.id;
  const approvalRequestId = req.body?.approvalRequestId;
  const approvalRequestIds = Array.isArray(req.body?.approvalRequestIds)
    ? req.body.approvalRequestIds.filter((value: unknown): value is string => typeof value === 'string')
    : typeof approvalRequestId === 'string'
      ? [approvalRequestId]
      : [];
  const approved = req.body?.approved;
  const previousMessages = normalizeLegacyApprovalParts(
    Array.isArray(req.body?.previousMessages) ? req.body.previousMessages : [],
  );

  if (approvalRequestIds.length === 0 || typeof approved !== 'boolean') {
    return res.status(400).json({
      code: 'bad_request:api',
      cause: 'approvalRequestIds and approved are required',
    });
  }

  const { chat, allowed, reason } = shouldUseLocalHistory(dbAvailable)
    ? await checkLocalChatAccess(chatId, session.user.id)
    : await checkChatAccess(chatId, session.user.id);

  if (reason !== 'not_found' && !allowed) {
    const error = new ChatSDKError('forbidden:chat');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  if (!chat) {
    return res.status(404).json({
      code: 'not_found:chat',
      cause: 'Chat not found',
    });
  }

  if (chat.userId !== session.user.id) {
    const error = new ChatSDKError('forbidden:chat');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  if (previousMessages.length > 0) {
    const assistantMessages = previousMessages.filter(
      (m: ChatMessage) => m.role === 'assistant',
    );
    if (assistantMessages.length > 0) {
      const persistedMessages = assistantMessages.map((m: ChatMessage) => ({
        chatId,
        id: m.id,
        role: m.role,
        parts: m.parts,
        attachments: [],
        createdAt: m.metadata?.createdAt
          ? new Date(m.metadata.createdAt)
          : new Date(),
        traceId: null,
      }));

      if (dbAvailable) {
        await saveMessages({ messages: persistedMessages });
      } else if (shouldUseLocalHistory(dbAvailable)) {
        await saveLocalMessages(persistedMessages);
      }
    }
  }

  if (!approved) {
    return res.status(200).json({ message: null });
  }

  const agentBackendUrl = process.env.API_PROXY;
  if (!agentBackendUrl) {
    return res.status(400).json({
      code: 'bad_request:api',
      cause: 'Approval continuation requires API_PROXY to be configured',
    });
  }

  const repo = getLocalRepoConfig();
  const memory = getLocalMemoryConfig();
  const context = getLocalContextConfig();
  const responseMode = getLocalResponseConfig();
  const sqlKnowledge = getLocalSqlKnowledgeConfig();

  const sharedHeaders = {
    'Content-Type': 'application/json',
    'x-codex-memory-mode': memory.mode,
    'x-codex-context-mode': context.mode,
    'x-codex-response-mode': responseMode.mode,
    'x-codex-sql-knowledge-mode': sqlKnowledge.mode,
    ...(sqlKnowledge.lakebase.project
      ? { 'x-codex-lakebase-project': sqlKnowledge.lakebase.project }
      : {}),
    ...(sqlKnowledge.lakebase.branch
      ? { 'x-codex-lakebase-branch': sqlKnowledge.lakebase.branch }
      : {}),
    ...(sqlKnowledge.lakebase.instanceName
      ? { 'x-codex-lakebase-instance': sqlKnowledge.lakebase.instanceName }
      : {}),
    'x-codex-workspace-root': repo.path ?? NO_WORKSPACE_SELECTED_MARKER,
    ...(req.headers['x-forwarded-access-token']
      ? {
          'x-forwarded-access-token': req.headers[
            'x-forwarded-access-token'
          ] as string,
        }
      : {}),
    ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
  };

  const responseTexts: string[] = [];

  for (const requestId of approvalRequestIds) {
    const agentResponse = await fetch(agentBackendUrl, {
      method: 'POST',
      headers: sharedHeaders,
      body: JSON.stringify({
        input: [
          {
            type: 'mcp_approval_response',
            approval_request_id: requestId,
            approve: true,
          },
        ],
        context: {
          conversation_id: chatId,
          user_id: session.user.email ?? session.user.id,
        },
      }),
    });

    if (!agentResponse.ok) {
      const errorText = await agentResponse.text();
      return res.status(agentResponse.status).json({
        code: 'bad_request:api',
        cause: errorText || 'Approval continuation failed',
      });
    }

    const agentPayload = (await agentResponse.json()) as { output?: unknown };
    const text = extractAssistantTextFromResponsesOutput(agentPayload.output);
    if (text) {
      responseTexts.push(text);
    }
  }

  const text = responseTexts.join('\n\n');
  const assistantMessage: ChatMessage = {
    id: generateUUID(),
    role: 'assistant',
    parts: text ? [{ type: 'text', text }] : [],
    metadata: {
      createdAt: new Date().toISOString(),
    },
  };

  if (assistantMessage.parts.length > 0) {
    const persistedResponse = {
      id: assistantMessage.id,
      role: assistantMessage.role,
      parts: assistantMessage.parts,
      createdAt: new Date(),
      attachments: [],
      chatId,
      traceId: null,
    };

    if (dbAvailable) {
      await saveMessages({
        messages: [persistedResponse],
      });
    } else if (shouldUseLocalHistory(dbAvailable)) {
      await saveLocalMessages([persistedResponse]);
    }
  }

  return res.status(200).json({ message: assistantMessage });
});

/**
 * DELETE /api/chat?id=:id - Delete a chat
 */
chatRouter.delete(
  '/:id',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    const id = getIdFromRequest(req);
    if (!id) return;

    const deletedChat = shouldUseLocalHistory(isDatabaseAvailable())
      ? await deleteLocalChatById(id)
      : await deleteChatById({ id });
    return res.status(200).json(deletedChat);
  },
);

/**
 * GET /api/chat/:id
 */

chatRouter.get(
  '/:id',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    const id = getIdFromRequest(req);
    if (!id) return;

    const { chat } = shouldUseLocalHistory(isDatabaseAvailable())
      ? await checkLocalChatAccess(id, req.session?.user.id)
      : await checkChatAccess(id, req.session?.user.id);

    return res.status(200).json(chat);
  },
);

/**
 * GET /api/chat/:id/stream - Resume a stream
 */
chatRouter.get(
  '/:id/stream',
  [requireAuth],
  async (req: Request, res: Response) => {
    const chatId = getIdFromRequest(req);
    if (!chatId) return;
    const cursor = req.headers['x-resume-stream-cursor'] as string;

    console.log(`[Stream Resume] Cursor: ${cursor}`);

    console.log(`[Stream Resume] GET request for chat ${chatId}`);

    // Check if there's an active stream for this chat first
    const streamId = streamCache.getActiveStreamId(chatId);

    if (!streamId) {
      console.log(`[Stream Resume] No active stream for chat ${chatId}`);
      const streamError = new ChatSDKError('empty:stream');
      const response = streamError.toResponse();
      return res.status(response.status).json(response.json);
    }

    const { allowed, reason } = shouldUseLocalHistory(isDatabaseAvailable())
      ? await checkLocalChatAccess(chatId, req.session?.user.id)
      : await checkChatAccess(chatId, req.session?.user.id);

    // If chat doesn't exist in DB, it's a temporary chat from the homepage - allow it
    if (reason === 'not_found') {
      console.log(
        `[Stream Resume] Resuming stream for temporary chat ${chatId} (not yet in DB)`,
      );
    } else if (!allowed) {
      console.log(
        `[Stream Resume] User ${req.session?.user.id} does not have access to chat ${chatId} (reason: ${reason})`,
      );
      const streamError = new ChatSDKError('forbidden:chat', reason);
      const response = streamError.toResponse();
      return res.status(response.status).json(response.json);
    }

    // Get all cached chunks for this stream
    const stream = streamCache.getStream(streamId, {
      cursor: cursor ? Number.parseInt(cursor) : undefined,
    });

    if (!stream) {
      console.log(`[Stream Resume] No stream found for ${streamId}`);
      const streamError = new ChatSDKError('empty:stream');
      const response = streamError.toResponse();
      return res.status(response.status).json(response.json);
    }

    console.log(`[Stream Resume] Resuming stream ${streamId}`);

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Pipe the cached stream directly to the response
    stream.pipe(res);

    // Handle stream errors
    stream.on('error', (error) => {
      console.error('[Stream Resume] Stream error:', error);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });
  },
);

/**
 * POST /api/chat/title - Generate title from message
 */
chatRouter.post('/title', requireAuth, async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    const title = await generateTitleFromUserMessage({ message });
    res.json({ title });
  } catch (error) {
    console.error('Error generating title:', error);
    res.status(500).json({ error: 'Failed to generate title' });
  }
});

/**
 * PATCH /api/chat/:id/visibility - Update chat visibility
 */
chatRouter.patch(
  '/:id/visibility',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    try {
      res.status(403).json({ error: 'Chat sharing is disabled in this app' });
    } catch (error) {
      console.error('Error updating visibility:', error);
      res.status(500).json({ error: 'Failed to update visibility' });
    }
  },
);

chatRouter.patch(
  '/:id/title',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    try {
      const id = getIdFromRequest(req);
      if (!id) return;
      const title = String(req.body?.title ?? '').trim();

      if (!title) {
        return res.status(400).json({ error: 'Title is required' });
      }

      if (shouldUseLocalHistory(isDatabaseAvailable())) {
        await updateLocalChatTitleById({ chatId: id, title });
      } else {
        await updateChatTitleById({ chatId: id, title });
      }
      res.json({ success: true, title });
    } catch (error) {
      console.error('Error updating title:', error);
      res.status(500).json({ error: 'Failed to update title' });
    }
  },
);

// Helper function to generate title from user message
async function generateTitleFromUserMessage({
  message,
  maxMessageLength = 256,
}: {
  message: ChatMessage;
  maxMessageLength?: number;
}) {
  const model = await myProvider.languageModel('title-model');
  const fallbackTitle = fallbackTitleFromMessage(message, maxMessageLength);
  const failFastForLocalApiProxy = shouldFailFastForLocalApiProxy();

  // Truncate each text part to the maxMessageLength
  const truncatedMessage = {
    ...message,
    parts: message.parts.map((part) =>
      part.type === 'text'
        ? { ...part, text: part.text.slice(0, maxMessageLength) }
        : part,
    ),
  };

  const { text: title } = await generateText({
    model,
    ...(failFastForLocalApiProxy ? { maxRetries: 0 } : {}),
    system: `\n
    - generate a short, neutral chat title based on the user's first message
    - respond with title text only
    - do not write as the assistant or continue the conversation
    - do not use quotes, ellipses, colons, emojis, or sentence fragments like "Nah, it's not..."
    - prefer a concise noun phrase or task summary
    - use title case when natural
    - keep it under 48 characters and at most 6 words`,
    prompt: JSON.stringify(truncatedMessage),
  });

  return normalizeGeneratedTitle(title, fallbackTitle);
}

function fallbackTitleFromMessage(
  message: ChatMessage,
  maxMessageLength: number,
): string {
  const text = message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .slice(0, maxMessageLength)
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return 'New chat';

  const cleaned = text
    .replace(/^[`"'\s]+|[`"'\s]+$/g, '')
    .replace(/^(hey|hi|hello|nah|no|yes|yep|okay|ok|please)\b[,\s-]*/i, '')
    .replace(/^(can you|could you|would you|help me|i need to|i want to|let'?s)\b[,\s-]*/i, '')
    .replace(/[.?!].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const source = cleaned || text;
  const words = source.split(/\s+/).filter(Boolean).slice(0, 6);
  const compact = words.join(' ');
  const normalized = compact
    .replace(/[^a-zA-Z0-9/&()+\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return truncatePreserveWords(toTitleCase(normalized || 'New chat'), 48);
}

function normalizeGeneratedTitle(title: string, fallbackTitle: string): string {
  const compact = title
    .replace(/\s+/g, ' ')
    .replace(/^[`"'“”'‘’\s]+|[`"'“”'‘’\s]+$/g, '')
    .trim();

  if (!compact) return fallbackTitle;

  const firstLine = compact.split('\n')[0]?.trim() ?? '';
  const cleaned = firstLine
    .replace(/^[`"'“”'‘’]+|[`"'“”'‘’]+$/g, '')
    .replace(/\.\.\.+/g, '')
    .replace(/[:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const looksConversational =
    /^(nah|no|yes|yep|okay|ok|sure|i can|i will|i'll|let me|here'?s|this repo|that repo)\b/i.test(
      cleaned,
    ) || /[.!?]$/.test(cleaned);

  const tooLong = cleaned.length > 48 || cleaned.split(/\s+/).length > 8;

  if (!cleaned || looksConversational || tooLong) {
    return fallbackTitle;
  }

  return truncatePreserveWords(cleaned, 48);
}

function toTitleCase(input: string): string {
  return input.replace(/\b([a-z])([a-z]*)/gi, (_, head: string, tail: string) => {
    return head.toUpperCase() + tail.toLowerCase();
  });
}

async function resolveTitleQuickly(
  titlePromise: Promise<string | null>,
  timeoutMs = 600,
): Promise<string | null> {
  return Promise.race<string | null>([
    titlePromise,
    new Promise<string | null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

function truncatePreserveWords(input: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  if (input.length <= maxLength) return input;

  // Take the raw slice first
  const slice = input.slice(0, maxLength);

  // Find the last whitespace within the slice
  const lastSpaceIndex = slice.lastIndexOf(' ');

  // If no whitespace found, we must break mid-word
  if (lastSpaceIndex === -1) {
    return slice;
  }

  // If the whitespace is too close to the start (e.g., leading space),
  // fallback to mid-word break to avoid returning an empty string
  if (lastSpaceIndex === 0) {
    return slice;
  }

  return slice.slice(0, lastSpaceIndex);
}
