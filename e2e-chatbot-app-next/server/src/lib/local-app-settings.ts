import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvFile, resolveAgentRoot } from './local-agent-config';

export type MemoryMode = 'lean' | 'work' | 'raw';
export type ContextMode = 'personalized' | 'fresh';
export type ResponseMode = 'direct' | 'teach';
export type SqlKnowledgeMode = 'local' | 'lakebase' | 'hybrid';

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

export interface LocalSqlKnowledgeConfig {
  mode: SqlKnowledgeMode;
  lakebase: {
    project: string | null;
    branch: string | null;
    instanceName: string | null;
    configured: boolean;
  };
}

interface LocalAppSettings {
  memoryMode?: MemoryMode;
  contextMode?: ContextMode;
  responseMode?: ResponseMode;
  sqlKnowledgeMode?: SqlKnowledgeMode;
  lakebaseProject?: string | null;
  lakebaseBranch?: string | null;
  lakebaseInstanceName?: string | null;
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

function normalizeSqlKnowledgeMode(value: unknown): SqlKnowledgeMode {
  if (value === 'lakebase') return 'lakebase';
  if (value === 'hybrid') return 'hybrid';
  return 'local';
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
      recentMessages: parseInteger(env.MEMORY_WORK_RECENT_MESSAGES, 28),
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

export function getLocalSqlKnowledgeConfig(): LocalSqlKnowledgeConfig {
  const env = envValues();
  const settings = readSettings();
  const project = normalizeOptionalText(
    settings.lakebaseProject ??
      process.env.LOCAL_LAKEBASE_PROJECT ??
      env.LAKEBASE_AUTOSCALING_PROJECT,
  );
  const branch = normalizeOptionalText(
    settings.lakebaseBranch ??
      process.env.LOCAL_LAKEBASE_BRANCH ??
      env.LAKEBASE_AUTOSCALING_BRANCH,
  );
  const instanceName = normalizeOptionalText(
    settings.lakebaseInstanceName ??
      process.env.LOCAL_LAKEBASE_INSTANCE_NAME ??
      env.LAKEBASE_INSTANCE_NAME,
  );

  return {
    mode: normalizeSqlKnowledgeMode(
      settings.sqlKnowledgeMode ??
        process.env.LOCAL_SQL_KNOWLEDGE_MODE ??
        env.SQL_KNOWLEDGE_MODE,
    ),
    lakebase: {
      project,
      branch,
      instanceName,
      configured: !!instanceName || !!(project && branch),
    },
  };
}

export function setLocalSqlKnowledgeMode(
  mode: SqlKnowledgeMode,
): LocalSqlKnowledgeConfig {
  const settings = readSettings();
  writeSettings({
    ...settings,
    sqlKnowledgeMode: normalizeSqlKnowledgeMode(mode),
  });
  return getLocalSqlKnowledgeConfig();
}

export function setLocalLakebaseConfig(config: {
  project?: string | null;
  branch?: string | null;
  instanceName?: string | null;
}): LocalSqlKnowledgeConfig {
  const settings = readSettings();
  writeSettings({
    ...settings,
    lakebaseProject:
      config.project !== undefined
        ? normalizeOptionalText(config.project)
        : settings.lakebaseProject ?? null,
    lakebaseBranch:
      config.branch !== undefined
        ? normalizeOptionalText(config.branch)
        : settings.lakebaseBranch ?? null,
    lakebaseInstanceName:
      config.instanceName !== undefined
        ? normalizeOptionalText(config.instanceName)
        : settings.lakebaseInstanceName ?? null,
  });
  return getLocalSqlKnowledgeConfig();
}
