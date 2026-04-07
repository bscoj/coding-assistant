import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LocalRepoConfig {
  path: string | null;
  name: string | null;
  hasGit: boolean;
  updatedAt: string | null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = path.resolve(__dirname, '../../.local/active-repo.json');

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function normalizeConfig(raw?: Partial<LocalRepoConfig>): LocalRepoConfig {
  return {
    path: raw?.path ?? null,
    name: raw?.name ?? null,
    hasGit: raw?.hasGit ?? false,
    updatedAt: raw?.updatedAt ?? null,
  };
}

export function getLocalRepoConfig(): LocalRepoConfig {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return normalizeConfig();
    }
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as Partial<LocalRepoConfig>;
    return normalizeConfig(raw);
  } catch {
    return normalizeConfig();
  }
}

export function validateRepoPath(repoPath: string): LocalRepoConfig {
  const resolved = path.resolve(repoPath);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error('Repository path must be a directory');
  }

  const hasGit = fs.existsSync(path.join(resolved, '.git'));
  return {
    path: resolved,
    name: path.basename(resolved),
    hasGit,
    updatedAt: new Date().toISOString(),
  };
}

export function setLocalRepoConfig(repoPath: string): LocalRepoConfig {
  const config = validateRepoPath(repoPath);
  ensureStoreDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(config, null, 2));
  return config;
}

export function clearLocalRepoConfig(): LocalRepoConfig {
  ensureStoreDir();
  const config = normalizeConfig();
  fs.writeFileSync(STORE_PATH, JSON.stringify(config, null, 2));
  return config;
}
