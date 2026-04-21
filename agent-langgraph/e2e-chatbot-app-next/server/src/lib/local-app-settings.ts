import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvFile, resolveAgentRoot } from './local-agent-config';

export type MemoryMode = 'balanced' | 'work';

export interface LocalMemoryConfig {
  mode: MemoryMode;
  recentMessages: number;
  summaryThresholdMessages: number;
  maxSummaryWords: number;
}

interface LocalAppSettings {
  memoryMode?: MemoryMode;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = path.resolve(__dirname, '../../.local/app-settings.json');

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function normalizeMemoryMode(value: unknown): MemoryMode {
  return value === 'balanced' ? 'balanced' : 'work';
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

  if (mode === 'work') {
    return {
      mode,
      recentMessages: parseInteger(env.MEMORY_WORK_RECENT_MESSAGES, 24),
      summaryThresholdMessages: parseInteger(env.MEMORY_WORK_SUMMARY_THRESHOLD_MESSAGES, 8),
      maxSummaryWords: parseInteger(env.MEMORY_WORK_MAX_SUMMARY_WORDS, 1000),
    };
  }

  return {
    mode,
    recentMessages: parseInteger(env.MEMORY_RECENT_MESSAGES, 8),
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
