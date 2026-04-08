import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import type { Chat, DBMessage } from '@chat-template/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STORE_PATH = path.resolve(__dirname, '../../.local/chat-history.json');

type LocalStore = {
  chats: Chat[];
  messages: DBMessage[];
};

function resolveStorePath() {
  const configured = process.env.LOCAL_CHAT_HISTORY_PATH;
  if (!configured) {
    return DEFAULT_STORE_PATH;
  }
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(path.dirname(DEFAULT_STORE_PATH), configured);
}

export function getLocalChatHistoryPath() {
  return resolveStorePath();
}

function ensureParent(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultStore(): LocalStore {
  return { chats: [], messages: [] };
}

function readStore(): LocalStore {
  const filePath = resolveStorePath();
  ensureParent(filePath);
  if (!fs.existsSync(filePath)) {
    const store = defaultStore();
    fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`);
    return store;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<LocalStore>;
    return {
      chats: Array.isArray(parsed.chats) ? (parsed.chats as Chat[]) : [],
      messages: Array.isArray(parsed.messages) ? (parsed.messages as DBMessage[]) : [],
    };
  } catch {
    const store = defaultStore();
    fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`);
    return store;
  }
}

function writeStore(store: LocalStore) {
  const filePath = resolveStorePath();
  ensureParent(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`);
}

function sortChatsDesc(chats: Chat[]) {
  return [...chats].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function isLocalChatHistoryEnabled() {
  return process.env.LOCAL_CHAT_HISTORY_ENABLED?.toLowerCase() !== 'false';
}

export async function saveLocalChat(chat: Chat) {
  const store = readStore();
  const existingIndex = store.chats.findIndex(item => item.id === chat.id);
  if (existingIndex >= 0) {
    store.chats[existingIndex] = chat;
  } else {
    store.chats.push(chat);
  }
  writeStore(store);
}

export async function getLocalChatById(id: string) {
  const store = readStore();
  return store.chats.find(chat => chat.id === id) ?? null;
}

export async function deleteLocalChatById(id: string) {
  const store = readStore();
  const chat = store.chats.find(item => item.id === id) ?? null;
  store.chats = store.chats.filter(item => item.id !== id);
  store.messages = store.messages.filter(item => item.chatId !== id);
  writeStore(store);
  return chat;
}

export async function getLocalChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  const store = readStore();
  let chats = sortChatsDesc(store.chats.filter(chat => chat.userId === id));

  if (startingAfter) {
    const cursor = chats.find(chat => chat.id === startingAfter);
    if (cursor) {
      chats = chats.filter(chat => new Date(chat.createdAt) > new Date(cursor.createdAt));
    }
  } else if (endingBefore) {
    const cursor = chats.find(chat => chat.id === endingBefore);
    if (cursor) {
      chats = chats.filter(chat => new Date(chat.createdAt) < new Date(cursor.createdAt));
    }
  }

  const hasMore = chats.length > limit;
  return {
    chats: hasMore ? chats.slice(0, limit) : chats,
    hasMore,
  };
}

export async function saveLocalMessages(messages: DBMessage[]) {
  const store = readStore();
  for (const message of messages) {
    const existingIndex = store.messages.findIndex(item => item.id === message.id);
    if (existingIndex >= 0) {
      store.messages[existingIndex] = message;
    } else {
      store.messages.push(message);
    }
  }
  writeStore(store);
}

export async function getLocalMessagesByChatId(id: string) {
  const store = readStore();
  return store.messages
    .filter(message => message.chatId === id)
    .sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

export async function getLocalMessageById(id: string) {
  const store = readStore();
  const message = store.messages.find(item => item.id === id);
  return message ? [message] : [];
}

export async function deleteLocalMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  const store = readStore();
  store.messages = store.messages.filter(
    message =>
      !(message.chatId === chatId && new Date(message.createdAt) >= timestamp),
  );
  writeStore(store);
}

export async function updateLocalChatVisiblityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: 'private' | 'public';
}) {
  const store = readStore();
  store.chats = store.chats.map(chat =>
    chat.id === chatId ? { ...chat, visibility } : chat,
  );
  writeStore(store);
}

export async function updateLocalChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  const store = readStore();
  store.chats = store.chats.map(chat =>
    chat.id === chatId ? { ...chat, title } : chat,
  );
  writeStore(store);
}

export async function updateLocalChatLastContextById({
  chatId,
  context,
}: {
  chatId: string;
  context: LanguageModelV3Usage;
}) {
  const store = readStore();
  store.chats = store.chats.map(chat =>
    chat.id === chatId ? { ...chat, lastContext: context } : chat,
  );
  writeStore(store);
}

export async function checkLocalChatAccess(chatId: string, userId?: string) {
  const chat = await getLocalChatById(chatId);
  if (!chat) {
    return { allowed: false, chat: null, reason: 'not_found' as const };
  }
  if (chat.visibility === 'public') {
    return { allowed: true, chat };
  }
  if (chat.userId !== userId) {
    return { allowed: false, chat, reason: 'forbidden' as const };
  }
  return { allowed: true, chat };
}
