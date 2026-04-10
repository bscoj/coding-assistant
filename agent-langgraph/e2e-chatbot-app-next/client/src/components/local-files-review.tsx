import { Badge } from '@/components/ui/badge';
import { CodeBlock } from './elements/code-block';

type Change = {
  path?: string;
  mode?: string;
  preview?: string;
  content?: string;
};

type LocalFilesReviewProps = {
  input: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function LocalFilesReview({ input }: LocalFilesReviewProps) {
  if (!isObject(input)) {
    return null;
  }

  const summary =
    typeof input.summary === 'string' ? input.summary : 'Proposed file changes';
  const rationale =
    typeof input.rationale === 'string' ? input.rationale : null;
  const instruction =
    typeof input.instruction === 'string' ? input.instruction : null;
  const riskLevel =
    typeof input.riskLevel === 'string' ? input.riskLevel : 'low';
  const workspaceRoot =
    typeof input.workspaceRoot === 'string' ? input.workspaceRoot : null;
  const changes = Array.isArray(input.changes)
    ? (input.changes.filter(isObject) as Change[])
    : [];

  return (
    <div className="space-y-3 p-3">
      <div className="space-y-1">
        <h4 className="font-medium text-white/42 text-xs uppercase tracking-[0.2em]">
          Review
        </h4>
        <p className="text-sm text-white/86">{summary}</p>
        {rationale ? (
          <p className="text-xs leading-5 text-white/52">
            Requested because: {rationale}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="rounded-full bg-white/[0.06] text-white/72">
          {changes.length} file{changes.length === 1 ? '' : 's'}
        </Badge>
        <Badge variant="secondary" className="rounded-full bg-white/[0.06] text-white/72">
          Risk {riskLevel}
        </Badge>
        {workspaceRoot ? (
          <Badge variant="secondary" className="max-w-full truncate rounded-full bg-white/[0.06] text-white/72">
            {workspaceRoot}
          </Badge>
        ) : null}
      </div>

      {instruction ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs leading-5 text-white/55">
          {instruction}
        </div>
      ) : null}

      {changes.map((change, index) => (
        <div
          key={`${change.path ?? 'change'}-${index}`}
          className="space-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-sm">
              {change.path ?? 'unknown file'}
            </span>
            <Badge variant="secondary" className="rounded-full">
              {(change.mode ?? 'change').toUpperCase()}
            </Badge>
          </div>
          {typeof change.content === 'string' && change.content.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.14em] text-white/38">
                Proposed content
              </div>
              <div className="overflow-hidden rounded-xl border border-white/[0.06]">
                <CodeBlock
                  code={change.content}
                  language={
                    typeof change.path === 'string' && change.path.includes('.')
                      ? change.path.split('.').pop() || 'text'
                      : 'text'
                  }
                />
              </div>
            </div>
          ) : null}
          {typeof change.preview === 'string' && change.preview.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.14em] text-white/38">
                Diff preview
              </div>
              <pre className="max-h-72 overflow-auto rounded-xl border border-white/[0.06] bg-[#0d1117] p-3 text-xs leading-5 whitespace-pre-wrap text-white/82">
                {change.preview}
              </pre>
            </div>
          ) : typeof change.content !== 'string' || change.content.length === 0 ? (
            <pre className="max-h-72 overflow-auto rounded-xl border border-white/[0.06] bg-[#0d1117] p-3 text-xs leading-5 whitespace-pre-wrap text-white/82">
              No diff preview available.
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}
