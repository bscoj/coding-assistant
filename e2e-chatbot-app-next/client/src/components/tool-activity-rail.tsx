import type { ChatMessage } from '@chat-template/core';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Wrench } from 'lucide-react';
import { useLocalStorage } from 'usehooks-ts';

type Activity = {
  id: string;
  toolName: string;
  state: string;
  serverName?: string;
  summary?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function summarizeInput(input: unknown): string | undefined {
  if (!isObject(input)) return undefined;
  if (typeof input.summary === 'string') return input.summary;
  if (typeof input.path === 'string' && typeof input.mode === 'string') {
    return `${input.mode} ${input.path}`;
  }
  return undefined;
}

function activityVariant(state: string) {
  if (state === 'output-available')
    return 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300';
  if (state === 'approval-requested')
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300';
  if (state === 'output-denied')
    return 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300';
  return 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300';
}

function extractActivities(messages: ChatMessage[]): Activity[] {
  const activities: Activity[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'dynamic-tool') continue;
      activities.push({
        id: part.toolCallId,
        toolName: part.toolName,
        state: part.state,
        serverName: part.callProviderMetadata?.databricks?.mcpServerName?.toString(),
        summary: summarizeInput(part.input),
      });
    }
  }
  return activities.slice(-12).reverse();
}

export function ToolActivityRail({ messages }: { messages: ChatMessage[] }) {
  const activities = extractActivities(messages);
  const [collapsed, setCollapsed] = useLocalStorage(
    'tool-activity-rail-collapsed',
    false,
  );

  return (
    <aside
      className={cn(
        'hidden shrink-0 border-l border-white/[0.06] bg-[#0a0f15]/70 backdrop-blur-xl transition-[width] duration-200 xl:flex xl:flex-col',
        collapsed ? 'w-16' : 'w-72',
      )}
    >
      <div
        className={cn(
          'border-b border-white/[0.06]',
          collapsed ? 'px-2 py-3' : 'px-4 py-3',
        )}
      >
        {collapsed ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="flex size-9 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-white/68 transition hover:bg-white/[0.08] hover:text-white"
              title="Expand activity"
              aria-label="Expand activity"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-sm text-white/86">Activity</h3>
              <p className="text-[11px] text-white/34">
                Recent tool state, compact by default.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="flex size-8 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-white/62 transition hover:bg-white/[0.08] hover:text-white"
              title="Collapse activity"
              aria-label="Collapse activity"
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>
        )}
      </div>
      {collapsed ? (
        <div className="flex flex-1 flex-col items-center gap-3 px-2 py-4">
          <div className="flex size-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-white/72">
            <Wrench className="size-4" />
          </div>
          <div className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-white/68">
            {activities.length}
          </div>
          <div className="[writing-mode:vertical-rl] rotate-180 text-[10px] uppercase tracking-[0.22em] text-white/32">
            Activity
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3">
          {activities.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-white/40">
              Tool activity will appear here as the agent explores files,
              proposes edits, and requests permission.
            </div>
          ) : (
            <div className="space-y-2">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className="space-y-1.5 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-[13px] text-white/84">
                      {activity.toolName}
                    </span>
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 font-medium text-[11px]',
                        activityVariant(activity.state),
                      )}
                    >
                      {activity.state.replaceAll('-', ' ')}
                    </span>
                  </div>
                  {activity.serverName && (
                    <div className="font-mono text-[11px] text-white/34">
                      {activity.serverName}
                    </div>
                  )}
                  {activity.summary && (
                    <div className="line-clamp-2 text-[12px] leading-5 text-white/54">
                      {activity.summary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
