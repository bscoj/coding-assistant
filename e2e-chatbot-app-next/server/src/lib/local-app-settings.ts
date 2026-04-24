import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvFile, resolveAgentRoot } from './local-agent-config';

export type MemoryMode = 'lean' | 'work' | 'raw';
export type ContextMode = 'personalized' | 'fresh';
export type ResponseMode = 'direct' | 'teach';

export interface LocalMemoryConfig {
  mode: MemoryMode;
  recentMessages: number;
  summaryThresholdMessages: number;
  maxSummaryWords: number;
}

export interface LocalContextConfig {
  mode: ContextMode;
}

export interface LocalResponseConfig {
  mode: ResponseMode;
}

interface LocalAppSettings {
  memoryMode?: MemoryMode;
  contextMode?: ContextMode;
  responseMode?: ResponseMode;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = path.resolve(__dirname, '../../.local/app-settings.json');

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function normalizeMemoryMode(value: unknown): MemoryMode {
  if (value === 'raw') return 'raw';
  if (value === 'lean' || value === 'balanced') return 'lean';
  return 'work';
}

function normalizeContextMode(value: unknown): ContextMode {
  return value === 'fresh' ? 'fresh' : 'personalized';
}

function normalizeResponseMode(value: unknown): ResponseMode {
  return value === 'teach' ? 'teach' : 'direct';
}

function readSettings(): LocalAppSettings {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as LocalAppSettings;
  } catch {
    return {};
  }
}

function writeSettings(settings: LocalAppSettings) {
  ensureStoreDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(settings, null, 2));
}

function envValues() {
  const agentRoot = resolveAgentRoot();
  return {
    ...readEnvFile(path.join(agentRoot, '.env.example')),
    ...readEnvFile(path.join(agentRoot, '.env')),
  };
}

function parseInteger(raw: string | undefined, fallback: number) {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getLocalMemoryConfig(): LocalMemoryConfig {
  const env = envValues();
  const settings = readSettings();
  const mode = normalizeMemoryMode(
    settings.memoryMode ?? process.env.LOCAL_MEMORY_MODE ?? env.MEMORY_MODE,
  );

  if (mode === 'raw') {
    return {
      mode,
      recentMessages: parseInteger(env.MEMORY_RAW_RECENT_MESSAGES, 140),
      summaryThresholdMessages: parseInteger(env.MEMORY_RAW_SUMMARY_THRESHOLD_MESSAGES, 20),
      maxSummaryWords: parseInteger(env.MEMORY_RAW_MAX_SUMMARY_WORDS, 1600),
    };
  }

  if (mode === 'work') {
    return {
      mode,
      recentMessages: parseInteger(env.MEMORY_WORK_RECENT_MESSAGES, 60),
      summaryThresholdMessages: parseInteger(env.MEMORY_WORK_SUMMARY_THRESHOLD_MESSAGES, 12),
      maxSummaryWords: parseInteger(env.MEMORY_WORK_MAX_SUMMARY_WORDS, 1000),
    };
  }

  return {
    mode,
    recentMessages: parseInteger(env.MEMORY_RECENT_MESSAGES, 12),
    summaryThresholdMessages: parseInteger(env.MEMORY_SUMMARY_THRESHOLD_MESSAGES, 10),
    maxSummaryWords: parseInteger(env.MEMORY_MAX_SUMMARY_WORDS, 450),
  };
}

export function setLocalMemoryMode(mode: MemoryMode): LocalMemoryConfig {
  const settings = readSettings();
  writeSettings({
    ...settings,
    memoryMode: normalizeMemoryMode(mode),
  });
  return getLocalMemoryConfig();
}

export function getLocalContextConfig(): LocalContextConfig {
  const env = envValues();
  const settings = readSettings();
  return {
    mode: normalizeContextMode(
      settings.contextMode ?? process.env.LOCAL_CONTEXT_MODE ?? env.CONTEXT_MODE,
    ),
  };
}

export function setLocalContextMode(mode: ContextMode): LocalContextConfig {
  const settings = readSettings();
  writeSettings({
    ...settings,
    contextMode: normalizeContextMode(mode),
  });
  return getLocalContextConfig();
}

export function getLocalResponseConfig(): LocalResponseConfig {
  const env = envValues();
  const settings = readSettings();
  return {
    mode: normalizeResponseMode(
      settings.responseMode ?? process.env.LOCAL_RESPONSE_MODE ?? env.RESPONSE_MODE,
    ),
  };
}

export function setLocalResponseMode(mode: ResponseMode): LocalResponseConfig {
  const settings = readSettings();
  writeSettings({
    ...settings,
    responseMode: normalizeResponseMode(mode),
  });
  return getLocalResponseConfig();
}
