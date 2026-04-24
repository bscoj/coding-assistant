import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { CheckIcon, ChevronDownIcon, FileCode2Icon, XIcon } from 'lucide-react';
import { CodeBlock } from './elements/code-block';

export type LocalFilesystemApprovalEntry = {
  approvalRequestId: string;
  toolName: string;
  state: string;
  approved?: boolean;
  input: unknown;
};

type Change = {
  path?: string;
  mode?: string;
  preview?: string;
  content?: string;
};

type ReviewChange = Change & {
  approvalRequestIds: string[];
};

type LocalFilesReviewProps = {
  approvals: LocalFilesystemApprovalEntry[];
  isSubmitting: boolean;
  onApprove: () => void;
  onDeny: () => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseChanges(input: unknown, approvalRequestId: string): ReviewChange[] {
  if (!isObject(input) || !Array.isArray(input.changes)) {
    return [];
  }

  return input.changes
    .filter(isObject)
    .map((change) => ({
      path: typeof change.path === 'string' ? change.path : undefined,
      mode: typeof change.mode === 'string' ? change.mode : undefined,
      preview: typeof change.preview === 'string' ? change.preview : undefined,
      content: typeof change.content === 'string' ? change.content : undefined,
      approvalRequestIds: [approvalRequestId],
    }));
}

function summarizeDiff(changes: ReviewChange[]) {
  let additions = 0;
  let deletions = 0;

  for (const change of changes) {
    if (!change.preview) continue;
    for (const line of change.preview.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) additions += 1;
      if (line.startsWith('-')) deletions += 1;
    }
  }

  return { additions, deletions };
}

function stateLabel(approvals: LocalFilesystemApprovalEntry[]) {
  const hasPending = approvals.some((item) => item.state === 'approval-requested');
  if (hasPending) return 'Pending';
  if (approvals.some((item) => item.approved === false || item.state === 'output-denied')) {
    return 'Denied';
  }
  return 'Allowed';
}

function stateTone(label: string) {
  if (label === 'Pending') return 'text-amber-300 bg-amber-500/10 border-amber-400/20';
  if (label === 'Denied') return 'text-red-300 bg-red-500/10 border-red-400/20';
  return 'text-emerald-300 bg-emerald-500/10 border-emerald-400/20';
}

export function LocalFilesReview({
  approvals,
  isSubmitting,
  onApprove,
  onDeny,
}: LocalFilesReviewProps) {
  const [openPath, setOpenPath] = useState<string | null>(null);

  const {
    changes,
    rationale,
    workspaceRoot,
    hasPending,
  } = useMemo(() => {
    const merged = new Map<string, ReviewChange>();
    let rationaleValue: string | null = null;
    let workspaceRootValue: string | null = null;

    for (const approval of approvals) {
      if (isObject(approval.input)) {
        if (!rationaleValue && typeof approval.input.rationale === 'string') {
          rationaleValue = approval.input.rationale;
        }
        if (!workspaceRootValue && typeof approval.input.workspaceRoot === 'string') {
          workspaceRootValue = approval.input.workspaceRoot;
        }
      }

      for (const change of parseChanges(approval.input, approval.approvalRequestId)) {
        const key = change.path ?? `${change.mode ?? 'change'}-${approval.approvalRequestId}`;
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, change);
          continue;
        }
        merged.set(key, {
          ...existing,
          content: existing.content ?? change.content,
          preview: existing.preview ?? change.preview,
          mode: existing.mode ?? change.mode,
          approvalRequestIds: Array.from(
            new Set([...existing.approvalRequestIds, ...change.approvalRequestIds]),
          ),
        });
      }
    }

    return {
      changes: Array.from(merged.values()),
      rationale: rationaleValue,
      workspaceRoot: workspaceRootValue,
      hasPending: approvals.some((item) => item.state === 'approval-requested'),
    };
  }, [approvals]);

  const { additions, deletions } = summarizeDiff(changes);
  const label = stateLabel(approvals);

  if (changes.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#171717] shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-white">
            <span>
              {changes.length} file{changes.length === 1 ? '' : 's'} changed
            </span>
            <span className="text-emerald-400">+{additions}</span>
            <span className="text-red-400">-{deletions}</span>
          </div>
          {rationale ? (
            <p className="mt-1 text-sm text-white/52">{rationale}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className={cn('rounded-full border px-3 py-1 text-xs', stateTone(label))}
          >
            {label}
          </Badge>
        </div>
      </div>

      <div className="divide-y divide-white/[0.08]">
        {changes.map((change, index) => {
          const path = change.path ?? `File ${index + 1}`;
          const isOpen = openPath === path;
          const language =
            path.includes('.') ? path.split('.').pop() || 'text' : 'text';

          return (
            <Collapsible
              key={`${path}-${index}`}
              open={isOpen}
              onOpenChange={(next) => setOpenPath(next ? path : null)}
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]">
                <div className="flex min-w-0 items-center gap-3">
                  <FileCode2Icon className="size-4 shrink-0 text-white/36" />
                  <span className="truncate text-[15px] font-medium text-white">{path}</span>
                  <span className="text-sm text-white/42">
                    {String(change.mode ?? 'change').toUpperCase()}
                  </span>
                </div>
                <ChevronDownIcon
                  className={cn(
                    'size-4 shrink-0 text-white/42 transition-transform',
                    isOpen && 'rotate-180',
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 border-t border-white/[0.06] bg-[#111111] px-5 py-4">
                {typeof change.content === 'string' && change.content.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-white/36">
                      New contents
                    </div>
                    <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
                      <CodeBlock code={change.content} language={language} />
                    </div>
                  </div>
                ) : null}

                {typeof change.preview === 'string' && change.preview.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-white/36">
                      Diff
                    </div>
                    <pre className="max-h-80 overflow-auto rounded-2xl border border-white/[0.06] bg-[#0d0d0d] p-4 text-xs leading-6 whitespace-pre-wrap text-white/78">
                      {change.preview}
                    </pre>
                  </div>
                ) : null}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] bg-[#141414] px-5 py-4">
        <div className="min-w-0 text-sm text-white/48">
          {workspaceRoot ? (
            <span className="truncate">Target repo: {workspaceRoot}</span>
          ) : (
            <span>Review changes before applying them.</span>
          )}
        </div>
        {hasPending ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onDeny}
              disabled={isSubmitting}
              className="rounded-full border-white/[0.08] bg-transparent px-4 text-white/78 hover:bg-white/[0.05] hover:text-white"
            >
              <XIcon className="size-4" />
              Deny
            </Button>
            <Button
              variant="secondary"
              onClick={onApprove}
              disabled={isSubmitting}
              className="rounded-full bg-white text-black hover:bg-white/90"
            >
              <CheckIcon className="size-4" />
              {isSubmitting ? 'Applying...' : 'Allow'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
