import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  ChevronDownIcon,
  FileCode2Icon,
  ServerIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldXIcon,
} from 'lucide-react';
import type { ToolUIPart } from 'ai';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import {
  ToolContainer,
  ToolContent,
  ToolInput,
  ToolOutput,
  ToolStatusBadge,
  type ToolState,
} from './tool';
import { CodeBlock } from './code-block';

// MCP-specific container with distinct styling
type McpToolProps = Parameters<typeof ToolContainer>[0];

export const McpTool = ({ className, ...props }: McpToolProps) => (
  <ToolContainer
    className={cn(
      'overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#171717] shadow-[0_18px_60px_rgba(0,0,0,0.24)]',
      className,
    )}
    {...props}
  />
);

// Re-export shared components for convenience
export {
  ToolContent as McpToolContent,
  ToolOutput as McpToolOutput,
};

// MCP-specific header with banner
type McpToolHeaderProps = {
  serverName?: string;
  toolName: string;
  input?: ToolUIPart['input'];
  state: ToolState;
  // Used when state is 'approval-responded' to determine approval outcome
  approved?: boolean;
  className?: string;
};

// Badge component for approval status in the banner
// Uses AI SDK native tool states directly
type ApprovalStatusBadgeProps = {
  state: ToolState;
  // Used when state is 'approval-responded' to determine approval outcome
  approved?: boolean;
};

const ApprovalStatusBadge = ({ state, approved }: ApprovalStatusBadgeProps) => {
  // Pending: waiting for user approval
  if (state === 'approval-requested') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300"
        data-testid="mcp-approval-status-pending"
      >
        <ShieldAlertIcon className="size-3" />
        <span>Pending</span>
      </span>
    );
  }

  // Allowed: tool executed successfully or user approved (waiting for execution)
  if (
    state === 'output-available' ||
    (state === 'approval-responded' && approved === true)
  ) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300"
        data-testid="mcp-approval-status-allowed"
      >
        <ShieldCheckIcon className="size-3" />
        <span>Allowed</span>
      </span>
    );
  }

  // Denied: user explicitly denied the tool
  if (
    state === 'output-denied' ||
    (state === 'approval-responded' && approved === false)
  ) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-300"
        data-testid="mcp-approval-status-denied"
      >
        <ShieldXIcon className="size-3" />
        <span>Denied</span>
      </span>
    );
  }

  // Fallback for any other state - show as pending
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300"
      data-testid="mcp-approval-status-pending"
    >
      <ShieldAlertIcon className="size-3" />
      <span>Pending</span>
    </span>
  );
};

export const McpToolHeader = ({
  className,
  serverName,
  toolName,
  input,
  state,
  approved,
}: McpToolHeaderProps) => {
  const headerCopy = formatHeaderCopy(toolName, input);

  return (
  <div className="border-b border-white/[0.08] bg-transparent">
    {/* MCP Banner */}
    <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-2 text-[11px]">
      <ServerIcon className="size-3 text-white/34" />
      <span className="font-medium uppercase tracking-[0.16em] text-white/34">
        Approval Request
      </span>
      {serverName && (
        <>
          <span className="text-white/16">•</span>
          <span className="truncate text-white/40">{serverName}</span>
        </>
      )}
      <span className="text-white/16">•</span>
      <ApprovalStatusBadge state={state} approved={approved} />
    </div>
    {/* Tool header */}
    <CollapsibleTrigger
      className={cn(
        'flex w-full min-w-0 items-center justify-between gap-2 px-4 py-3 hover:bg-white/[0.03] transition-colors',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {headerCopy.isFileWrite ? (
          <FileCode2Icon className="size-4 shrink-0 text-white/40" />
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium text-white/90">
            {headerCopy.title}
          </div>
          {headerCopy.subtitle ? (
            <div className="truncate text-[12px] text-white/42">
              {headerCopy.subtitle}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* Only show tool status badge when tool is running/completed (approved) */}
        {(state === 'output-available' ||
          (state === 'approval-responded' && approved === true)) && (
          <ToolStatusBadge state={state} />
        )}
        <ChevronDownIcon className="size-4 text-white/38" />
      </div>
    </CollapsibleTrigger>
  </div>
  );
};

type FileWriteChange = {
  path?: string;
  mode?: string;
  content?: string;
  preview?: string;
};

type FileWriteReview = {
  summary?: string;
  rationale?: string;
  workspaceRoot?: string;
  riskLevel?: string;
  changes: FileWriteChange[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseFileWriteReview(input: unknown): FileWriteReview | null {
  if (!isObject(input)) return null;

  const parsedChanges: FileWriteChange[] = [];

  if (Array.isArray(input.changes)) {
    for (const change of input.changes) {
      if (!isObject(change)) continue;
      const path = typeof change.path === 'string' ? change.path : undefined;
      const mode = typeof change.mode === 'string' ? change.mode : undefined;
      const content =
        typeof change.content === 'string'
          ? change.content
          : typeof change.newContent === 'string'
            ? change.newContent
            : undefined;
      const preview =
        typeof change.preview === 'string' ? change.preview : undefined;

      if (path || mode || content || preview) {
        parsedChanges.push({ path, mode, content, preview });
      }
    }
  }

  if (parsedChanges.length === 0) {
    const path = typeof input.path === 'string' ? input.path : undefined;
    const mode = typeof input.mode === 'string' ? input.mode : undefined;
    const content =
      typeof input.content === 'string'
        ? input.content
        : typeof input.newContent === 'string'
          ? input.newContent
          : undefined;
    const preview =
      typeof input.preview === 'string' ? input.preview : undefined;

    if (path || mode || content || preview) {
      parsedChanges.push({ path, mode, content, preview });
    }
  }

  if (parsedChanges.length === 0) {
    return null;
  }

  return {
    summary: typeof input.summary === 'string' ? input.summary : undefined,
    rationale: typeof input.rationale === 'string' ? input.rationale : undefined,
    workspaceRoot:
      typeof input.workspaceRoot === 'string' ? input.workspaceRoot : undefined,
    riskLevel:
      typeof input.riskLevel === 'string' ? input.riskLevel : undefined,
    changes: parsedChanges,
  };
}

function inputSectionLabel(toolName?: string, isFileWrite?: boolean) {
  if (isFileWrite) return 'Proposed file changes';
  if (toolName) return 'Request details';
  return 'Parameters';
}

function humanizeToolName(toolName: string) {
  return toolName
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatHeaderCopy(toolName: string, input: unknown) {
  const review = parseFileWriteReview(input);
  if (!review) {
    return {
      title: humanizeToolName(toolName),
      subtitle: undefined as string | undefined,
      isFileWrite: false,
    };
  }

  const count = review.changes.length;
  const title = `${count} file change${count === 1 ? '' : 's'}`;
  const paths = review.changes
    .map((change) => change.path)
    .filter((path): path is string => Boolean(path));

  let subtitle: string | undefined;
  if (count === 1) {
    subtitle = paths[0] ?? review.summary ?? review.rationale;
  } else if (paths.length > 0) {
    subtitle =
      paths.length === 1 ? paths[0] : `${paths[0]} +${paths.length - 1} more`;
  } else {
    subtitle = review.summary ?? review.rationale;
  }

  return {
    title,
    subtitle,
    isFileWrite: true,
  };
}

type McpToolInputProps = ComponentProps<'div'> & {
  input: ToolUIPart['input'];
  toolName?: string;
};

export const McpToolInput = ({
  className,
  input,
  toolName,
  ...props
}: McpToolInputProps) => {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const review = useMemo(() => parseFileWriteReview(input), [input]);

  if (!review) {
    return (
      <ToolInput
        className={cn('px-4 pb-4', className)}
        input={input}
        {...props}
      />
    );
  }

  return (
    <div className={cn('space-y-3 overflow-hidden px-4 pb-4', className)} {...props}>
      <div className="space-y-2">
        <h4 className="font-medium text-[11px] uppercase tracking-[0.18em] text-white/36">
          {inputSectionLabel(toolName, true)}
        </h4>
        {(review.summary || review.rationale) && (
          <div className="rounded-2xl border border-white/[0.06] bg-[#101214] px-4 py-3 text-sm text-white/70">
            {review.summary ? (
              <div className="font-medium text-white/88">{review.summary}</div>
            ) : null}
            {review.rationale ? (
              <div className={cn('text-white/58', review.summary && 'mt-1')}>
                {review.rationale}
              </div>
            ) : null}
          </div>
        )}
        {review.workspaceRoot ? (
          <div className="rounded-2xl border border-white/[0.06] bg-[#101214] px-4 py-3 text-sm">
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/34">
              Target repo
            </div>
            <div className="mt-1 break-all text-white/68">{review.workspaceRoot}</div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        {review.changes.map((change, index) => {
          const path = change.path ?? `File ${index + 1}`;
          const isOpen = openPath === path || (openPath === null && index === 0);
          const language = path.includes('.') ? path.split('.').pop() || 'text' : 'text';

          return (
            <Collapsible
              key={`${path}-${index}`}
              open={isOpen}
              onOpenChange={(next) => setOpenPath(next ? path : null)}
            >
              <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#101214]">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileCode2Icon className="size-4 shrink-0 text-white/36" />
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium text-white/90">
                        {path}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0 text-[10px] uppercase tracking-[0.14em] text-white/55"
                        >
                          {String(change.mode ?? 'change')}
                        </Badge>
                        {review.riskLevel ? (
                          <span className="text-[11px] uppercase tracking-[0.14em] text-white/30">
                            Risk {review.riskLevel}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <ChevronDownIcon
                    className={cn(
                      'size-4 shrink-0 text-white/36 transition-transform',
                      isOpen && 'rotate-180',
                    )}
                  />
                </CollapsibleTrigger>

                <CollapsibleContent className="space-y-4 border-t border-white/[0.06] bg-[#0f1318] px-4 py-4">
                  {typeof change.content === 'string' && change.content.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-white/34">
                        Proposed code
                      </div>
                      <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
                        <CodeBlock code={change.content} language={language} />
                      </div>
                    </div>
                  ) : null}

                  {typeof change.preview === 'string' && change.preview.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-white/34">
                        Diff preview
                      </div>
                      <pre className="max-h-80 overflow-auto rounded-2xl border border-white/[0.06] bg-[#0b1016] p-4 text-xs leading-6 whitespace-pre-wrap text-white/78">
                        {change.preview}
                      </pre>
                    </div>
                  ) : null}
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
};

// MCP-specific approval actions
type McpApprovalActionsProps = {
  onApprove: () => void;
  onDeny: () => void;
  isSubmitting: boolean;
};

export const McpApprovalActions = ({
  onApprove,
  onDeny,
  isSubmitting,
}: McpApprovalActionsProps) => (
  <div
    className="flex flex-col gap-3 border-t border-white/[0.08] bg-[#141414] px-4 py-4"
    data-testid="mcp-approval-actions"
  >
    <div className="flex items-start gap-2">
      <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-300" />
      <p className="text-sm text-white/60">
        Review the requested file change and approve it only if it matches what you want.
      </p>
    </div>
    <div className="flex gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={onApprove}
        disabled={isSubmitting}
        className="rounded-full bg-white text-black hover:bg-white/90"
        data-testid="mcp-approval-allow"
      >
        <ShieldCheckIcon className="mr-1.5 size-4" />
        {isSubmitting ? 'Submitting...' : 'Allow'}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onDeny}
        disabled={isSubmitting}
        className="rounded-full border-white/[0.08] bg-transparent text-white/78 hover:bg-white/[0.05] hover:text-white"
        data-testid="mcp-approval-deny"
      >
        <ShieldXIcon className="mr-1.5 size-4" />
        Deny
      </Button>
    </div>
  </div>
);

// MCP-specific approval status display
type McpApprovalStatusProps = {
  approved: boolean;
  reason?: string;
};

export const McpApprovalStatus = ({
  approved,
  reason,
}: McpApprovalStatusProps) => (
  <div
    className={cn(
      'flex items-center gap-2 border-t px-4 py-3',
      approved
        ? 'border-emerald-400/12 bg-emerald-500/[0.06]'
        : 'border-red-400/12 bg-red-500/[0.06]',
    )}
  >
    {approved ? (
      <ShieldCheckIcon className="size-4 text-emerald-300" />
    ) : (
      <ShieldXIcon className="size-4 text-red-300" />
    )}
    <span
      className={cn(
        'text-sm',
        approved
          ? 'text-emerald-300'
          : 'text-red-300',
      )}
    >
      {approved ? 'Allowed' : 'Denied'}
    </span>
    {reason && (
      <>
        <span className="text-muted-foreground/50">•</span>
        <span className="text-muted-foreground text-sm">{reason}</span>
      </>
    )}
  </div>
);
