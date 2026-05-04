import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { isDatabaseAvailable } from '@chat-template/db';
import { getEndpointOboInfo } from '@chat-template/ai-sdk-providers';
import {
  clearLocalRepoConfig,
  getLocalRepoConfig,
  setLocalRepoConfig,
} from '../lib/local-repo-store';
import {
  getLocalAgentModelConfig,
  getLocalAgentStorageConfig,
} from '../lib/local-agent-config';
import {
  getLocalContextConfig,
  getLocalMemoryConfig,
  getLocalResponseConfig,
  getLocalSqlKnowledgeConfig,
  setLocalLakebaseConfig,
  setLocalContextMode,
  setLocalMemoryMode,
  setLocalResponseMode,
  setLocalSqlKnowledgeMode,
  type ContextMode,
  type MemoryMode,
  type ResponseMode,
  type SqlKnowledgeMode,
} from '../lib/local-app-settings';
import {
  formatLocalApiProxyUnavailableMessage,
  getConfiguredAgentRouteUrl,
} from '../lib/local-api-proxy';
import { pickFolder } from '../lib/folder-picker';
import {
  getLocalChatHistoryPath,
  isLocalChatHistoryEnabled,
} from '../lib/local-chat-store';
import {
  getSharedProfile,
  getSharedProfileSummary,
  saveSharedProfile,
} from '../lib/shared-profile-store';

export const configRouter: RouterType = Router();
const NO_WORKSPACE_SELECTED_MARKER = '__NO_WORKSPACE_SELECTED__';

/**
 * Extract OAuth scopes from a JWT token (without verification).
 * Databricks tokens use 'scope' (space-separated string) or 'scp' (array).
 */
function getScopesFromToken(token: string): string[] {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return [];
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    if (typeof payload.scope === 'string') return payload.scope.split(' ');
    if (Array.isArray(payload.scp)) return payload.scp as string[];
    return [];
  } catch {
    return [];
  }
}

/**
 * GET /api/config - Get application configuration
 * Returns feature flags and OBO status based on environment configuration.
 * If the user's OBO token is present, decodes it to check which required
 * scopes are missing — the banner only shows missing scopes.
 */
configRouter.get('/', async (req: Request, res: Response) => {
  const oboInfo = await getEndpointOboInfo();
  const repo = getLocalRepoConfig();
  const models = getLocalAgentModelConfig();
  const storage = getLocalAgentStorageConfig();
  const memory = getLocalMemoryConfig();
  const context = getLocalContextConfig();
  const responseMode = getLocalResponseConfig();
  const sqlKnowledge = getLocalSqlKnowledgeConfig();
  const globalProfileSummary = getSharedProfileSummary('global', null);
  const projectProfileSummary = repo.path
    ? getSharedProfileSummary('project', repo.path)
    : null;

  let missingScopes = oboInfo.endpointRequiredScopes;

  // If the user has an OBO token, check which scopes are already present
  const userToken = req.headers['x-forwarded-access-token'] as string | undefined;
  if (userToken && oboInfo.isEndpointOboEnabled) {
    const tokenScopes = getScopesFromToken(userToken);
    // A required scope like "sql.statement-execution" is satisfied by
    // an exact match OR by its parent prefix (e.g. "sql")
    missingScopes = oboInfo.endpointRequiredScopes.filter(required => {
      const parent = required.split('.')[0];
      return !tokenScopes.some(ts => ts === required || ts === parent);
    });
  }

  res.json({
    features: {
      chatHistory: isDatabaseAvailable() || isLocalChatHistoryEnabled(),
      feedback: !!process.env.MLFLOW_EXPERIMENT_ID,
    },
    repo,
    models,
    memory,
    context,
    response: responseMode,
    sqlKnowledge,
    profiles: {
      global: globalProfileSummary,
      project: projectProfileSummary,
    },
    storage: {
      agentRoot: storage.agentRoot,
      conversationMemoryDbPath: storage.conversationMemoryDbPath,
      sqlMemoryDbPath: storage.sqlMemoryDbPath,
      analyticsContextDbPath: storage.analyticsContextDbPath,
      localChatHistoryPath: getLocalChatHistoryPath(),
    },
    obo: {
      missingScopes,
    },
  });
});

function buildSqlKnowledgeProxyHeaders(req: Request) {
  const repo = getLocalRepoConfig();
  const sqlKnowledge = getLocalSqlKnowledgeConfig();
  return {
    'Content-Type': 'application/json',
    'x-codex-workspace-root': repo.path ?? NO_WORKSPACE_SELECTED_MARKER,
    'x-codex-sql-knowledge-mode': sqlKnowledge.mode,
    ...(sqlKnowledge.lakebase.connectionString
      ? { 'x-codex-lakebase-database-url': sqlKnowledge.lakebase.connectionString }
      : {}),
    ...(sqlKnowledge.lakebase.project
      ? { 'x-codex-lakebase-project': sqlKnowledge.lakebase.project }
      : {}),
    ...(sqlKnowledge.lakebase.branch
      ? { 'x-codex-lakebase-branch': sqlKnowledge.lakebase.branch }
      : {}),
    ...(sqlKnowledge.lakebase.instanceName
      ? { 'x-codex-lakebase-instance': sqlKnowledge.lakebase.instanceName }
      : {}),
    ...(req.headers['x-forwarded-access-token']
      ? {
          'x-forwarded-access-token': req.headers[
            'x-forwarded-access-token'
          ] as string,
        }
      : {}),
    ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
  };
}

async function proxySqlKnowledgeRequest(
  req: Request,
  res: Response,
  pathname: string,
  init: { method: string; body?: string },
) {
  const targetUrl = getConfiguredAgentRouteUrl(pathname);
  if (!targetUrl) {
    res.status(400).json({
      code: 'bad_request:api',
      cause:
        'SQL knowledge sync requires API_PROXY to be configured so the local app can reach the agent backend.',
    });
    return;
  }

  try {
    const agentResponse = await fetch(targetUrl, {
      method: init.method,
      headers: buildSqlKnowledgeProxyHeaders(req),
      body: init.body,
    });
    const text = await agentResponse.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }
    if (!agentResponse.ok) {
      const cause =
        typeof payload === 'object' &&
        payload !== null &&
        'detail' in payload &&
        typeof (payload as { detail?: unknown }).detail === 'string'
          ? (payload as { detail: string }).detail
          : text || `Agent backend returned ${agentResponse.status}`;
      res.status(agentResponse.status).json({
        code: 'bad_request:api',
        cause,
      });
      return;
    }
    res.status(agentResponse.status).json(payload ?? {});
  } catch (error) {
    const defaultMessage =
      error instanceof Error ? error.message : String(error);
    res.status(502).json({
      code: 'bad_request:api',
      cause: formatLocalApiProxyUnavailableMessage(defaultMessage),
    });
  }
}

configRouter.put('/context', async (req: Request, res: Response) => {
  const mode = req.body?.mode;

  if (mode !== 'personalized' && mode !== 'fresh') {
    res.status(400).json({
      code: 'bad_request:api',
      cause: 'mode must be personalized or fresh',
    });
    return;
  }

  const context = setLocalContextMode(mode as ContextMode);
  res.json({ context });
});

configRouter.put('/memory', async (req: Request, res: Response) => {
  const mode = req.body?.mode;

  if (mode !== 'lean' && mode !== 'work' && mode !== 'raw') {
    res.status(400).json({
      code: 'bad_request:api',
      cause: 'mode must be lean, work, or raw',
    });
    return;
  }

  const memory = setLocalMemoryMode(mode as MemoryMode);
  res.json({ memory });
});

configRouter.put('/response', async (req: Request, res: Response) => {
  const mode = req.body?.mode;

  if (mode !== 'direct' && mode !== 'teach') {
    res.status(400).json({
      code: 'bad_request:api',
      cause: 'mode must be direct or teach',
    });
    return;
  }

  const responseMode = setLocalResponseMode(mode as ResponseMode);
  res.json({ response: responseMode });
});

configRouter.put('/sql-knowledge', async (req: Request, res: Response) => {
  const mode = req.body?.mode;
  const lakebase = req.body?.lakebase;

  let sqlKnowledge = getLocalSqlKnowledgeConfig();

  if (mode !== undefined) {
    if (mode !== 'local' && mode !== 'lakebase' && mode !== 'hybrid') {
      res.status(400).json({
        code: 'bad_request:api',
        cause: 'mode must be local, lakebase, or hybrid',
      });
      return;
    }
    sqlKnowledge = setLocalSqlKnowledgeMode(mode as SqlKnowledgeMode);
  }

  if (lakebase !== undefined) {
    if (typeof lakebase !== 'object' || lakebase === null) {
      res.status(400).json({
        code: 'bad_request:api',
        cause: 'lakebase must be an object',
      });
      return;
    }
    sqlKnowledge = setLocalLakebaseConfig({
      connectionString:
        'connectionString' in lakebase
          ? ((lakebase as { connectionString?: unknown }).connectionString as
              | string
              | null)
          : undefined,
      project:
        'project' in lakebase
          ? ((lakebase as { project?: unknown }).project as string | null)
          : undefined,
      branch:
        'branch' in lakebase
          ? ((lakebase as { branch?: unknown }).branch as string | null)
          : undefined,
      instanceName:
        'instanceName' in lakebase
          ? ((lakebase as { instanceName?: unknown }).instanceName as
              | string
              | null)
          : undefined,
    });
  }

  res.json({ sqlKnowledge });
});

configRouter.put('/repo', async (req: Request, res: Response) => {
  const repoPath = req.body?.path;

  if (repoPath === null || repoPath === '') {
    const repo = clearLocalRepoConfig();
    res.json({ repo });
    return;
  }

  if (typeof repoPath !== 'string') {
    res.status(400).json({
      code: 'bad_request:api',
      cause: 'path must be a string',
    });
    return;
  }

  try {
    const repo = setLocalRepoConfig(repoPath);
    res.json({ repo });
  } catch (error) {
    res.status(400).json({
      code: 'bad_request:api',
      cause: error instanceof Error ? error.message : String(error),
    });
  }
});

configRouter.get('/sql-knowledge/status', async (req: Request, res: Response) => {
  await proxySqlKnowledgeRequest(req, res, '/sql-knowledge/status', {
    method: 'GET',
  });
});

configRouter.post('/sql-knowledge/sync', async (req: Request, res: Response) => {
  const direction = req.body?.direction;
  if (direction !== 'push' && direction !== 'pull') {
    res.status(400).json({
      code: 'bad_request:api',
      cause: 'direction must be push or pull',
    });
    return;
  }
  await proxySqlKnowledgeRequest(req, res, '/sql-knowledge/sync', {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
});

configRouter.post('/repo/browse', async (_req: Request, res: Response) => {
  try {
    const selectedPath = await pickFolder();
    if (!selectedPath) {
      res.status(204).end();
      return;
    }

    const repo = setLocalRepoConfig(selectedPath);
    res.json({ repo });
  } catch (error) {
    res.status(400).json({
      code: 'bad_request:api',
      cause: error instanceof Error ? error.message : String(error),
    });
  }
});

configRouter.get('/profile', async (req: Request, res: Response) => {
  const scope = req.query.scope === 'project' ? 'project' : 'global';
  const repo = getLocalRepoConfig();

  if (scope === 'project' && !repo.path) {
    res.json({
      scope,
      title: 'Project profile',
      path: null,
      workspace_root: null,
      workspace_name: null,
      updated_at: null,
      entries: [],
    });
    return;
  }

  const profile = getSharedProfile(scope, scope === 'project' ? repo.path : null);
  res.json(profile);
});

configRouter.put('/profile', async (req: Request, res: Response) => {
  const scope = req.body?.scope === 'project' ? 'project' : 'global';
  const entries = req.body?.entries;
  const repo = getLocalRepoConfig();

  if (!Array.isArray(entries)) {
    res.status(400).json({
      code: 'bad_request:api',
      cause: 'entries must be an array',
    });
    return;
  }

  if (scope === 'project' && !repo.path) {
    res.status(400).json({
      code: 'bad_request:api',
      cause: 'Select a repository before editing the project profile',
    });
    return;
  }

  const profile = saveSharedProfile(scope, scope === 'project' ? repo.path : null, entries);
  res.json(profile);
});
