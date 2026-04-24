import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { ToolUIPart } from 'ai';
import { useContext, useState, type ComponentProps, type ReactNode } from 'react';
import { CodeBlock } from './code-block';
import { createContext } from 'react';
import { ChevronUpIcon, ShieldCheckIcon, ShieldOffIcon as ShieldXIcon, XCircleIcon, CircleOutlineIcon as CircleIcon, ClockIcon, ChevronDownIcon, WrenchIcon, CheckCircleIcon } from '../icons';

// Shared types - uses AI SDK's native tool states
export type ToolState = ToolUIPart['state'];

// Shared status badge component
type ToolStatusBadgeProps = {
  state: ToolState;
  className?: string;
};

export const ToolStatusBadge = ({ state, className }: ToolStatusBadgeProps) => {
  const labels: Record<ToolState, string> = {
    'input-streaming': 'Pending',
    'input-available': 'Running',
    'output-available': 'Completed',
    'output-error': 'Error',
    'output-denied': 'Denied',
    'approval-requested': 'Approval Requested',
    'approval-responded': 'Processing',
  };

  const icons: Record<ToolState, ReactNode> = {
    'input-streaming': <CircleIcon className="size-3" />,
    'input-available': <ClockIcon className="size-3 animate-pulse" />,
    'output-available': <CheckCircleIcon className="size-3" />,
    'output-error': <XCircleIcon className="size-3" />,
    'output-denied': <ShieldXIcon className="size-3" />,
    'approval-requested': <ShieldXIcon className="size-3" />,
    'approval-responded': <ShieldCheckIcon className="size-3" />,
  };

  const variants: Record<ToolState, string> = {
    'input-streaming':
      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    'input-available':
      'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    'output-available':
      'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    'output-error': 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    'output-denied':
      'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    'approval-requested':
      'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    'approval-responded':
      'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  };

  return (
    <Badge
      className={cn(
        'flex items-center gap-1 rounded-full border-0 font-medium text-xs',
        variants[state],
        className,
      )}
      variant="secondary"
    >
      {icons[state]}
      <span>{labels[state]}</span>
    </Badge>
  );
};

// Shared container component
type ToolContainerProps = ComponentProps<typeof Collapsible>;

const ToolContext = createContext<{
  open: boolean;
}>({
  open: false,
});

export const ToolContainer = ({ className, ...props }: ToolContainerProps) => {
  const [open, setOpen] = useState(props.defaultOpen || false);
  return (
    <ToolContext.Provider value={{ open }}>
      <Collapsible
        className={cn(
          'not-prose w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] shadow-[0_10px_30px_rgba(0,0,0,0.12)]',
          className,
        )}
        open={open}
        onOpenChange={setOpen}
        {...props}
      /></ToolContext.Provider>
  );
}

// Shared collapsible content component
type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-hidden data-[state=closed]:animate-out data-[state=open]:animate-in',
      className,
    )}
    {...props}
  />
);

// Shared input component
type ToolInputProps = ComponentProps<'div'> & {
  input: ToolUIPart['input'];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn('space-y-2 overflow-hidden px-3 pb-3', className)} {...props}>
    <h4 className="font-medium text-[11px] uppercase tracking-[0.18em] text-white/38">
      Parameters
    </h4>
    <div className="rounded-xl border border-white/[0.06] bg-[#0b1016]">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

// Shared output component
type ToolOutputProps = ComponentProps<'div'> & {
  output: ReactNode;
  errorText?: string;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  return (
    <div className={cn('space-y-2 border-t border-white/[0.06] px-3 py-3', className)} {...props}>
      <h4 className="font-medium text-[11px] uppercase tracking-[0.18em] text-white/38">
        {errorText ? 'Error' : 'Result'}
      </h4>
      <div
        className={cn(
          'overflow-x-auto rounded-xl border border-white/[0.06] text-xs [&_table]:w-full',
          errorText
            ? 'bg-red-500/10 text-red-200'
            : 'bg-[#0b1016] text-white/88',
        )}
      >
        {errorText && <div className="p-2">{errorText}</div>}
        {output && <div>{output}</div>}
      </div>
    </div>
  );
};

// Standard tool components (non-MCP)
export const Tool = ToolContainer;

type ToolHeaderProps = {
  type: ToolUIPart['type'] | string;
  state: ToolState;
  className?: string;
};

export const ToolHeader = ({
  className,
  type,
  state,
  ...props
}: ToolHeaderProps) => {
  const { open } = useContext(ToolContext);
  return (
      <CollapsibleTrigger
        className={cn(
        'flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2.5 cursor-pointer bg-white/[0.02] hover:bg-white/[0.04] transition-colors',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WrenchIcon className="size-4 shrink-0 text-white/45" />
        <span className="truncate font-medium text-[13px] text-white/88">{type}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ToolStatusBadge state={state} className="bg-white/[0.06] text-white/72" />
        {open ? (
          <ChevronUpIcon className="size-4 text-white/38" />
        ) : (
          <ChevronDownIcon className="size-4 text-white/38" />
        )}
        {/* <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" /> */}
      </div>
    </CollapsibleTrigger>
  );
}
