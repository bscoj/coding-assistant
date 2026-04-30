import { createContext, useContext, type ReactNode } from 'react';
import useSWR from 'swr';
import { fetchWithErrorHandlers, fetcher } from '@/lib/utils';

interface RepoConfig {
  path: string | null;
  name: string | null;
  hasGit: boolean;
  updatedAt: string | null;
}

interface ModelConfig {
  defaultModel: string | null;
  availableModels: string[];
}

interface StorageConfig {
  agentRoot: string;
  conversationMemoryDbPath: string;
  sqlMemoryDbPath: string;
  analyticsContextDbPath: string;
  localChatHistoryPath: string;
}

interface ProfileSummary {
  activeCount: number;
  inactiveCount: number;
  learnedCount: number;
  manualCount: number;
  totalCount: number;
  updatedAt: string | null;
}

export type MemoryMode = 'lean' | 'work' | 'raw';
export type ContextMode = 'personalized' | 'fresh';
export type ResponseMode = 'direct' | 'teach';

interface MemoryConfig {
  mode: MemoryMode;
  recentMessages: number;
  summaryThresholdMessages: number;
  maxSummaryWords: number;
}

interface ContextConfig {
  mode: ContextMode;
}

interface ResponseConfig {
  mode: ResponseMode;
}

interface ConfigResponse {
  features: {
    chatHistory: boolean;
    feedback: boolean;
  };
  repo: RepoConfig;
  models: ModelConfig;
  memory: MemoryConfig;
  context: ContextConfig;
  response: ResponseConfig;
  profiles: {
    global: ProfileSummary;
    project: ProfileSummary | null;
  };
  storage: StorageConfig;
  obo?: {
    missingScopes: string[];
  };
}

interface AppConfigContextType {
  config: ConfigResponse | undefined;
  isLoading: boolean;
  error: Error | undefined;
  chatHistoryEnabled: boolean;
  feedbackEnabled: boolean;
  oboMissingScopes: string[];
  repo: RepoConfig | undefined;
  hasRepoConfigured: boolean;
  models: ModelConfig | undefined;
  memory: MemoryConfig | undefined;
  context: ContextConfig | undefined;
  response: ResponseConfig | undefined;
  profiles:
    | {
        global: ProfileSummary;
        project: ProfileSummary | null;
      }
    | undefined;
  storage: StorageConfig | undefined;
  setRepoPath: (path: string | null) => Promise<void>;
  setMemoryMode: (mode: MemoryMode) => Promise<void>;
  setContextMode: (mode: ContextMode) => Promise<void>;
  setResponseMode: (mode: ResponseMode) => Promise<void>;
  refreshConfig: () => Promise<void>;
}

const AppConfigContext = createContext<AppConfigContextType | undefined>(
  undefined,
);

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const { data, error, isLoading, mutate } = useSWR<ConfigResponse>(
    '/api/config',
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Config should be loaded once and cached
      dedupingInterval: 60000, // 1 minute
    },
  );

  async function setRepoPath(path: string | null) {
    const response = await fetchWithErrorHandlers('/api/config/repo', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path }),
    });
    const payload = (await response.json()) as { repo: RepoConfig };
    await mutate(
      (current) =>
        current
          ? {
              ...current,
              repo: payload.repo,
            }
          : current,
      false,
    );
  }

  async function setMemoryMode(mode: MemoryMode) {
    const response = await fetchWithErrorHandlers('/api/config/memory', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode }),
    });
    const payload = (await response.json()) as { memory: MemoryConfig };
    await mutate(
      (current) =>
        current
          ? {
              ...current,
              memory: payload.memory,
            }
          : current,
      false,
    );
  }

  async function setContextMode(mode: ContextMode) {
    const response = await fetchWithErrorHandlers('/api/config/context', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode }),
    });
    const payload = (await response.json()) as { context: ContextConfig };
    await mutate(
      (current) =>
        current
          ? {
              ...current,
              context: payload.context,
            }
          : current,
      false,
    );
  }

  async function setResponseMode(mode: ResponseMode) {
    const response = await fetchWithErrorHandlers('/api/config/response', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode }),
    });
    const payload = (await response.json()) as { response: ResponseConfig };
    await mutate(
      (current) =>
        current
          ? {
              ...current,
              response: payload.response,
            }
          : current,
      false,
    );
  }

  async function refreshConfig() {
    await mutate();
  }

  const value: AppConfigContextType = {
    config: data,
    isLoading,
    error,
    // Default to true until loaded to avoid breaking existing behavior
    chatHistoryEnabled: data?.features.chatHistory ?? true,
    feedbackEnabled: data?.features.feedback ?? false,
    oboMissingScopes: data?.obo?.missingScopes ?? [],
    repo: data?.repo,
    hasRepoConfigured: !!data?.repo?.path,
    models: data?.models,
    memory: data?.memory,
    context: data?.context,
    response: data?.response,
    profiles: data?.profiles,
    storage: data?.storage,
    setRepoPath,
    setMemoryMode,
    setContextMode,
    setResponseMode,
    refreshConfig,
  };

  return (
    <AppConfigContext.Provider value={value}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig() {
  const context = useContext(AppConfigContext);
  if (context === undefined) {
    throw new Error('useAppConfig must be used within an AppConfigProvider');
  }
  return context;
}
