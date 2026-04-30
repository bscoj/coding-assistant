import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile, resolveAgentRoot } from './local-agent-config';

const PROFILE_KINDS = new Set([
  'coding_preference',
  'workstyle_preference',
  'user_fact',
  'constraint',
]);
const PROFILE_SOURCES = new Set(['manual', 'learned']);

export type SharedProfileEntry = {
  kind: string;
  content: string;
  status: string;
  confidence: number;
  created_at: string;
  updated_at: string;
  source: 'manual' | 'learned';
};

export type SharedProfileDocument = {
  scope: 'global' | 'project';
  title: string;
  path: string;
  workspace_root: string | null;
  workspace_name: string | null;
  updated_at: string | null;
  entries: SharedProfileEntry[];
};

export type SharedProfileSummary = {
  activeCount: number;
  inactiveCount: number;
  learnedCount: number;
  manualCount: number;
  totalCount: number;
  updatedAt: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function profileEnvValues() {
  const agentRoot = resolveAgentRoot();
  return {
    ...readEnvFile(path.join(agentRoot, '.env.example')),
    ...readEnvFile(path.join(agentRoot, '.env')),
  };
}

function resolveGlobalProfilePath() {
  const configured = process.env.USER_PROFILE_PATH || profileEnvValues().USER_PROFILE_PATH;
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(resolveAgentRoot(), configured);
  }
  return path.resolve(resolveAgentRoot(), '.local', 'user_profile.json');
}

function resolveProjectProfileDir() {
  const configured =
    process.env.PROJECT_PROFILE_DIR || profileEnvValues().PROJECT_PROFILE_DIR;
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(resolveAgentRoot(), configured);
  }
  return path.resolve(resolveAgentRoot(), '.local', 'project_profiles');
}

function sanitizeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '') || 'workspace';
}

function resolveProjectProfilePath(workspaceRoot: string) {
  const resolved = path.resolve(workspaceRoot);
  const digest = crypto
    .createHash('sha256')
    .update(resolved, 'utf8')
    .digest('hex')
    .slice(0, 16);
  return path.join(resolveProjectProfileDir(), `${sanitizeName(path.basename(resolved))}-${digest}.json`);
}

function ensureParent(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultDocument(
  scope: 'global' | 'project',
  workspaceRoot: string | null,
): SharedProfileDocument {
  return {
    scope,
    title:
      scope === 'project'
        ? `Project profile: ${workspaceRoot ? path.basename(workspaceRoot) : 'unknown'}`
        : 'Persistent user profile',
    path: scope === 'project' && workspaceRoot
      ? resolveProjectProfilePath(workspaceRoot)
      : resolveGlobalProfilePath(),
    workspace_root: workspaceRoot,
    workspace_name: workspaceRoot ? path.basename(workspaceRoot) : null,
    updated_at: nowIso(),
    entries: [],
  };
}

function normalizeEntry(raw: Partial<SharedProfileEntry>, timestamp: string): SharedProfileEntry | null {
  const kind = (raw.kind || '').trim();
  const content = (raw.content || '').trim();
  const status = (raw.status || 'active').trim() || 'active';
  if (!PROFILE_KINDS.has(kind) || !content) {
    return null;
  }
  const confidence = Number(raw.confidence ?? 1);
  const normalizedConfidence = Number.isFinite(confidence) ? confidence : 1;
  const source =
    typeof raw.source === 'string' && PROFILE_SOURCES.has(raw.source)
      ? raw.source
      : normalizedConfidence < 1
        ? 'learned'
        : 'manual';
  return {
    kind,
    content,
    status,
    confidence: normalizedConfidence,
    created_at: raw.created_at || timestamp,
    updated_at: timestamp,
    source,
  };
}

function readDocument(scope: 'global' | 'project', workspaceRoot: string | null): SharedProfileDocument {
  const filePath =
    scope === 'project' && workspaceRoot
      ? resolveProjectProfilePath(workspaceRoot)
      : resolveGlobalProfilePath();

  ensureParent(filePath);
  if (!fs.existsSync(filePath)) {
    const doc = defaultDocument(scope, workspaceRoot);
    fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<SharedProfileDocument>;
    const timestamp = nowIso();
    return {
      ...defaultDocument(scope, workspaceRoot),
      ...parsed,
      path: filePath,
      scope,
      workspace_root: workspaceRoot,
      workspace_name: workspaceRoot ? path.basename(workspaceRoot) : null,
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : timestamp,
      entries: Array.isArray(parsed.entries)
        ? parsed.entries
            .map(entry => normalizeEntry(entry, typeof entry?.updated_at === 'string' ? entry.updated_at : timestamp))
            .filter((entry): entry is SharedProfileEntry => entry !== null)
        : [],
    };
  } catch {
    const doc = defaultDocument(scope, workspaceRoot);
    fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
  }
}

function writeDocument(document: SharedProfileDocument) {
  ensureParent(document.path);
  document.updated_at = nowIso();
  fs.writeFileSync(document.path, `${JSON.stringify(document, null, 2)}\n`);
}

function summarizeDocument(document: SharedProfileDocument): SharedProfileSummary {
  const activeEntries = document.entries.filter(entry => entry.status === 'active');
  const inactiveEntries = document.entries.filter(entry => entry.status !== 'active');
  const learnedEntries = activeEntries.filter(entry => entry.source === 'learned');
  const manualEntries = activeEntries.filter(entry => entry.source !== 'learned');

  return {
    activeCount: activeEntries.length,
    inactiveCount: inactiveEntries.length,
    learnedCount: learnedEntries.length,
    manualCount: manualEntries.length,
    totalCount: document.entries.length,
    updatedAt: document.updated_at,
  };
}

export function getSharedProfile(scope: 'global' | 'project', workspaceRoot: string | null): SharedProfileDocument {
  return readDocument(scope, workspaceRoot);
}

export function getSharedProfileSummary(
  scope: 'global' | 'project',
  workspaceRoot: string | null,
): SharedProfileSummary {
  return summarizeDocument(readDocument(scope, workspaceRoot));
}

export function saveSharedProfile(
  scope: 'global' | 'project',
  workspaceRoot: string | null,
  entries: Partial<SharedProfileEntry>[],
) {
  const timestamp = nowIso();
  const document = readDocument(scope, workspaceRoot);
  const normalizedEntries = entries
    .map(entry => normalizeEntry(entry, timestamp))
    .filter((entry): entry is SharedProfileEntry => entry !== null);
  const activeEntries = normalizedEntries.filter(entry => entry.status === 'active');
  const inactiveEntries = normalizedEntries.filter(entry => entry.status !== 'active');
  document.entries = [...activeEntries, ...inactiveEntries];
  writeDocument(document);
  return document;
}
