import { useNavigate } from 'react-router-dom';
import { lazy, Suspense, useState } from 'react';

import { SidebarToggle } from '@/components/sidebar-toggle';
import { Button } from '@/components/ui/button';
import { Cpu, MessageSquareOff, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { useConfig } from '@/hooks/use-config';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PlusIcon, CloudOffIcon } from './icons';
import { cn } from '../lib/utils';
import { Skeleton } from './ui/skeleton';
import type { LanguageModelUsage } from 'ai';
import { formatUsageInline, formatUsageLine } from '@/lib/token-usage';

const RepoPicker = lazy(() =>
  import('./repo-picker').then((module) => ({ default: module.RepoPicker })),
);
const ProfileSheet = lazy(() =>
  import('./profile-sheet').then((module) => ({ default: module.ProfileSheet })),
);
const ModelPicker = lazy(() =>
  import('./model-picker').then((module) => ({ default: module.ModelPicker })),
);

const DOCS_URL =
  'https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app';

const OBO_DOCS_URL =
  'https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app#enable-user-authorization';

function OboScopeBanner({ missingScopes }: { missingScopes: string[] }) {
  if (missingScopes.length === 0) return null;

  return (
    <div className="w-full border-b border-red-500/20 bg-red-50 dark:bg-red-950/20 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <TriangleAlert className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
        <p className="text-sm text-red-700 dark:text-red-400">
          This endpoint requires on-behalf-of user authorization. Add these
          scopes to your app:{' '}
          <strong>{missingScopes.join(', ')}</strong>.{' '}
          <a
            href={OBO_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Learn more
          </a>
        </p>
      </div>
    </div>
  );
}

export function ChatHeader({
  title,
  empty,
  isLoadingTitle,
  selectedModel,
  onSelectModel,
  totalTokenUsage,
  latestTokenUsage,
}: {
  title?: string,
  empty?: boolean,
  isLoadingTitle?: boolean,
  selectedModel?: string,
  onSelectModel?: (model: string) => void,
  totalTokenUsage?: LanguageModelUsage,
  latestTokenUsage?: LanguageModelUsage,
}) {
  const navigate = useNavigate();
  const {
    chatHistoryEnabled,
    feedbackEnabled,
    oboMissingScopes,
    repo,
    models,
    profiles,
  } = useConfig();
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const modelLabel = selectedModel ?? models?.defaultModel ?? 'Select Model';
  const totalUsageLine = formatUsageLine(totalTokenUsage);
  const totalUsageInline = formatUsageInline(totalTokenUsage);
  const totalStoredPreferences =
    (profiles?.global.activeCount ?? 0) + (profiles?.project?.activeCount ?? 0);
  const totalLearnedPreferences =
    (profiles?.global.learnedCount ?? 0) + (profiles?.project?.learnedCount ?? 0);

  return (
    <>
      <header className={cn("sticky top-0 z-20 flex h-[56px] items-center gap-2 bg-background/72 px-4 backdrop-blur-xl", {
        "border-b border-white/[0.08]": !empty,
      })}>
        {/* Toggle visible on mobile only — desktop toggle lives inside the sidebar */}
        <div className="md:hidden">
          <SidebarToggle forceOpenIcon />
        </div>

        {(title || isLoadingTitle) &&
          <h4 className="truncate text-[15px] font-medium tracking-[0.01em] text-white/90">
            {isLoadingTitle ?
              <Skeleton className="h-5 w-32 bg-white/[0.08]" /> :
              title
            }
          </h4>
        }

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8 max-w-[220px] rounded-full border-white/[0.08] bg-white/[0.04] px-3 text-xs text-white/80 hover:bg-white/[0.08] hover:text-white"
            onClick={() => setModelPickerOpen(true)}
          >
            <Cpu className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{modelLabel}</span>
          </Button>
          {totalUsageInline && (
            <div
              className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] text-white/70"
              title={totalUsageLine ?? undefined}
            >
              {totalUsageInline}
            </div>
          )}
          <Button
            variant="outline"
            className="h-8 max-w-[180px] rounded-full border-white/[0.08] bg-white/[0.04] px-3 text-xs text-white/80 hover:bg-white/[0.08] hover:text-white"
            onClick={() => setRepoPickerOpen(true)}
          >
            <span className="truncate">{repo?.name ?? 'Select Repo'}</span>
          </Button>
          <Button
            variant="outline"
            className="h-8 rounded-full border-white/[0.12] bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))] px-3 text-xs text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.13),rgba(255,255,255,0.06))] hover:text-white"
            onClick={() => setProfileOpen(true)}
          >
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5 text-white/72" />
            Profile
            {totalStoredPreferences > 0 ? (
              <span
                className={cn(
                  'ml-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                  totalLearnedPreferences > 0
                    ? 'bg-emerald-300/14 text-emerald-100'
                    : 'bg-white/[0.08] text-white/72',
                )}
                title={`${totalStoredPreferences} stored preferences`}
              >
                {totalStoredPreferences}
              </span>
            ) : null}
          </Button>
          {!chatHistoryEnabled && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-foreground/80 text-xs hover:bg-white/[0.08] hover:text-foreground"
                  >
                    <CloudOffIcon className="h-3 w-3" />
                    <span className="hidden sm:inline">Ephemeral</span>
                  </a>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Chat history disabled — conversations are not saved. Click to learn more.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {!feedbackEnabled && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-foreground/80 text-xs hover:bg-white/[0.08] hover:text-foreground"
                  >
                    <MessageSquareOff className="h-3 w-3" />
                    <span className="hidden sm:inline">Feedback disabled</span>
                  </a>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Feedback submission disabled. Click to learn more.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {/* New Chat button — mobile only; desktop uses the sidebar rail */}
          <Button
            variant="default"
            className="order-2 ml-auto h-8 rounded-full bg-white text-black hover:bg-white/90 px-3 md:hidden"
            onClick={() => {
              navigate('/');
            }}
          >
            <PlusIcon />
            <span>New Chat</span>
          </Button>
        </div>
      </header>

      <OboScopeBanner missingScopes={oboMissingScopes} />
      {repoPickerOpen ? (
        <Suspense fallback={null}>
          <RepoPicker open={repoPickerOpen} onOpenChange={setRepoPickerOpen} />
        </Suspense>
      ) : null}
      {profileOpen ? (
        <Suspense fallback={null}>
          <ProfileSheet open={profileOpen} onOpenChange={setProfileOpen} />
        </Suspense>
      ) : null}
      {modelPickerOpen ? (
        <Suspense fallback={null}>
          <ModelPicker
            open={modelPickerOpen}
            onOpenChange={setModelPickerOpen}
            selectedModel={selectedModel ?? ''}
            onSelectModel={(model) => {
              onSelectModel?.(model);
              setModelPickerOpen(false);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
