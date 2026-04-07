import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_AGENT_ROOT = path.resolve(__dirname, '../../../../');
const PROFILE_KINDS = new Set([
  'coding_preference',
  'workstyle_preference',
  'user_fact',
  'constraint',
]);

export type SharedProfileEntry = {
  kind: string;
  content: string;
  status: string;
  confidence: number;
  created_at: string;
  updated_at: string;
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

function nowIso() {
  return new Date().toISOString();
}

function resolveAgentRoot() {
  return path.resolve(process.env.LOCAL_AGENT_REPO_ROOT || DEFAULT_AGENT_ROOT);
}

function resolveGlobalProfilePath() {
  const configured = process.env.USER_PROFILE_PATH;
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(resolveAgentRoot(), configured);
  }
  return path.resolve(resolveAgentRoot(), '.local', 'user_profile.json');
}

function resolveProjectProfileDir() {
  const configured = process.env.PROJECT_PROFILE_DIR;
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
  return {
    kind,
    content,
    status,
    confidence: Number(raw.confidence ?? 1),
    created_at: raw.created_at || timestamp,
    updated_at: timestamp,
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

export function getSharedProfile(scope: 'global' | 'project', workspaceRoot: string | null): SharedProfileDocument {
  return readDocument(scope, workspaceRoot);
}

export function saveSharedProfile(
  scope: 'global' | 'project',
  workspaceRoot: string | null,
  entries: Partial<SharedProfileEntry>[],
) {
  const timestamp = nowIso();
  const document = readDocument(scope, workspaceRoot);
  const activeEntries = entries
    .map(entry => normalizeEntry(entry, timestamp))
    .filter((entry): entry is SharedProfileEntry => entry !== null && entry.status === 'active');
  const inactiveEntries = entries
    .map(entry => normalizeEntry(entry, timestamp))
    .filter((entry): entry is SharedProfileEntry => entry !== null && entry.status !== 'active');
  document.entries = [...activeEntries, ...inactiveEntries];
  writeDocument(document);
  return document;
}
