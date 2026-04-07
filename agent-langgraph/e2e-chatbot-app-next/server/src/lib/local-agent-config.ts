import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_AGENT_ROOT = path.resolve(process.cwd(), '..');

export type LocalAgentModelConfig = {
  defaultModel: string | null;
  availableModels: string[];
};

function resolveAgentRoot() {
  return path.resolve(process.env.LOCAL_AGENT_REPO_ROOT || DEFAULT_AGENT_ROOT);
}

function readEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return {} as Record<string, string>;
  }

  const values: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }
    const [key, ...rest] = line.split('=');
    values[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function parseList(raw: string | undefined | null) {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

export function getLocalAgentModelConfig(): LocalAgentModelConfig {
  const agentRoot = resolveAgentRoot();
  const envValues = {
    ...readEnvFile(path.join(agentRoot, '.env.example')),
    ...readEnvFile(path.join(agentRoot, '.env')),
  };

  const defaultModel =
    process.env.LOCAL_AGENT_DEFAULT_MODEL_ENDPOINT ||
    envValues.AGENT_MODEL_ENDPOINT ||
    null;

  const availableModels = Array.from(
    new Set(
      [
        ...parseList(process.env.LOCAL_AGENT_MODEL_ENDPOINTS),
        ...parseList(envValues.AGENT_AVAILABLE_MODEL_ENDPOINTS),
        defaultModel,
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );

  return {
    defaultModel,
    availableModels,
  };
}
