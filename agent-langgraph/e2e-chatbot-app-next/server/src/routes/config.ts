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
import { pickFolder } from '../lib/folder-picker';
import {
  getLocalChatHistoryPath,
  isLocalChatHistoryEnabled,
} from '../lib/local-chat-store';
import {
  getSharedProfile,
  saveSharedProfile,
} from '../lib/shared-profile-store';

export const configRouter: RouterType = Router();

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
    storage: {
      agentRoot: storage.agentRoot,
      conversationMemoryDbPath: storage.conversationMemoryDbPath,
      localChatHistoryPath: getLocalChatHistoryPath(),
    },
    obo: {
      missingScopes,
    },
  });
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
