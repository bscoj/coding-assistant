import type { ChatMessage } from '@chat-template/core';
import { cn } from '@/lib/utils';

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

  return (
    <aside className="hidden w-72 shrink-0 border-l border-white/[0.06] bg-[#0a0f15]/70 backdrop-blur-xl xl:flex xl:flex-col">
      <div className="border-b border-white/[0.06] px-4 py-3">
        <h3 className="font-medium text-sm text-white/86">Activity</h3>
        <p className="text-[11px] text-white/34">Recent tool state, compact by default.</p>
      </div>
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
                  <div className="line-clamp-2 text-[12px] leading-5 text-white/54">{activity.summary}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
