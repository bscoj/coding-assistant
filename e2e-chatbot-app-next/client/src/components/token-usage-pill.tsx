import type { LanguageModelUsage } from 'ai';
import { formatTokenCount, formatUsageLine } from '@/lib/token-usage';
import { cn } from '@/lib/utils';

export function TokenUsagePill({
  usage,
  className,
}: {
  usage: LanguageModelUsage | undefined;
  className?: string;
}) {
  if (!usage) {
    return null;
  }

  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;

  if (input <= 0 && output <= 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.035] px-2.5 py-1 text-[11px] font-medium tracking-[0.01em] text-white/68 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-sm',
        className,
      )}
      title={formatUsageLine(usage) ?? undefined}
    >
      <span className="whitespace-nowrap">
        <span className="tabular-nums text-white/82">
          {formatTokenCount(input)}
        </span>
        <span className="ml-1 text-white/42">in</span>
      </span>
      <span aria-hidden="true" className="text-white/22">
        |
      </span>
      <span className="whitespace-nowrap">
        <span className="tabular-nums text-white/82">
          {formatTokenCount(output)}
        </span>
        <span className="ml-1 text-white/42">out</span>
      </span>
    </div>
  );
}
