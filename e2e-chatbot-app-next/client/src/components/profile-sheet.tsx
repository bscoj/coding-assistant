import {
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  EyeOff,
  FolderOpen,
  HardDrive,
  PencilLine,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { fetchWithErrorHandlers } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  useAppConfig,
  type MemoryMode,
  type ResponseMode,
  type SqlKnowledgeMode,
} from '@/contexts/AppConfigContext';

type ProfileScope = 'global' | 'project';
type ProfileEntrySource = 'manual' | 'learned';
type ProfileView = 'behavior' | 'preferences' | 'advanced';

type ProfileEntry = {
  kind: string;
  content: string;
  status: string;
  confidence: number;
  created_at: string;
  updated_at: string;
  source?: ProfileEntrySource;
};

type ProfileDocument = {
  scope: ProfileScope;
  title: string;
  path: string | null;
  workspace_root: string | null;
  workspace_name: string | null;
  updated_at: string | null;
  entries: ProfileEntry[];
};

type SqlKnowledgeCounts = {
  validatedSqlPatterns: number;
  analyticsTables: number;
  analyticsJoins: number;
  analyticsMetrics: number;
  analyticsFilterValues: number;
};

type SqlKnowledgeStatus = {
  workspace_root: string;
  requested_mode: SqlKnowledgeMode;
  effective_mode: SqlKnowledgeMode;
  profile: string | null;
  local: SqlKnowledgeCounts;
  active?: SqlKnowledgeCounts;
  lakebase: {
    configured: boolean;
    instance_name: string | null;
    project: string | null;
    branch: string | null;
    available: boolean;
    error: string | null;
    connection?: {
      kind?: string;
      host?: string | null;
      database?: string | null;
      role?: string | null;
      has_password?: boolean;
      sslmode_required?: boolean;
      pool_timeout_seconds?: string;
      pool_min_size?: string;
      branch_parent?: string;
    };
    counts?: SqlKnowledgeCounts;
  };
};

const EMPTY_PROFILE: ProfileDocument = {
  scope: 'global',
  title: 'Persistent user profile',
  path: null,
  workspace_root: null,
  workspace_name: null,
  updated_at: null,
  entries: [],
};

const KIND_OPTIONS = [
  { value: 'coding_preference', label: 'Coding preference' },
  { value: 'workstyle_preference', label: 'Workstyle preference' },
  { value: 'user_fact', label: 'User fact' },
  { value: 'constraint', label: 'Constraint' },
];

function getKindLabel(kind: string) {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

function getEntrySource(entry: ProfileEntry): ProfileEntrySource {
  if (entry.source === 'learned' || entry.source === 'manual') {
    return entry.source;
  }
  return entry.confidence < 1 ? 'learned' : 'manual';
}

function getEntryKey(entry: ProfileEntry) {
  return `${entry.kind}-${entry.created_at}`;
}

function nowIso() {
  return new Date().toISOString();
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return 'Unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function sortEntries(entries: ProfileEntry[]) {
  return [...entries].sort((a, b) => {
    const bTime = new Date(b.updated_at || b.created_at).getTime();
    const aTime = new Date(a.updated_at || a.created_at).getTime();
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    return a.content.localeCompare(b.content);
  });
}

function truncateSummary(value: string, maxLength = 38) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}

function buildProfileMarkdown(profile: ProfileDocument, entries: ProfileEntry[]) {
  const grouped = entries.reduce<Record<string, ProfileEntry[]>>((acc, entry) => {
    if (!acc[entry.kind]) {
      acc[entry.kind] = [];
    }
    acc[entry.kind].push(entry);
    return acc;
  }, {});

  const sections = Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .map((kind) => {
      const items = grouped[kind]
        .filter((entry) => entry.status === 'active')
        .map((entry) => `- ${entry.content.trim()}`)
        .join('\n');
      return items ? `## ${getKindLabel(kind)}\n\n${items}` : null;
    })
    .filter((section): section is string => section !== null);

  return [
    `# ${profile.title}`,
    '',
    `- Scope: ${profile.scope}`,
    ...(profile.workspace_name ? [`- Workspace: ${profile.workspace_name}`] : []),
    ...(profile.path ? [`- Source: ${profile.path}`] : []),
    ...(profile.updated_at ? [`- Updated: ${profile.updated_at}`] : []),
    '',
    ...sections,
    '',
  ].join('\n');
}

async function loadProfile(scope: ProfileScope) {
  const response = await fetchWithErrorHandlers(`/api/config/profile?scope=${scope}`);
  return (await response.json()) as ProfileDocument;
}

async function saveProfile(scope: ProfileScope, entries: ProfileEntry[]) {
  const response = await fetchWithErrorHandlers('/api/config/profile', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ scope, entries }),
  });
  return (await response.json()) as ProfileDocument;
}

async function loadSqlKnowledgeStatus() {
  const response = await fetchWithErrorHandlers('/api/config/sql-knowledge/status');
  return (await response.json()) as SqlKnowledgeStatus;
}

async function syncSqlKnowledge(direction: 'push' | 'pull') {
  const response = await fetchWithErrorHandlers('/api/config/sql-knowledge/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ direction }),
  });
  return (await response.json()) as {
    workspace_root: string;
    direction: 'push' | 'pull';
    counts: SqlKnowledgeCounts;
    targetStatus: SqlKnowledgeStatus;
  };
}

function SectionCard({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-[26px] border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-white/92">{title}</h3>
          <p className="text-xs leading-5 text-white/45">{description}</p>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SummaryChip({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string | number;
  emphasis?: 'default' | 'muted' | 'learned';
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border px-3 py-2',
        emphasis === 'learned'
          ? 'border-emerald-300/12 bg-emerald-300/[0.05]'
          : 'border-white/[0.06] bg-[#0f141b]',
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-sm font-medium',
          emphasis === 'learned'
            ? 'text-emerald-100'
            : emphasis === 'muted'
              ? 'text-white/60'
              : 'text-white/85',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function DisclosureSection({
  icon,
  title,
  description,
  count,
  summary,
  open,
  onOpenChange,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  count?: number;
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-[26px] border border-white/[0.08] bg-white/[0.03]">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left"
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#0f141b] text-white/72">
                {icon}
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-white/92">{title}</div>
                  {typeof count === 'number' ? (
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2 py-0.5 text-[11px] text-white/62">
                      {count}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs leading-5 text-white/45">{description}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {summary ? (
                <span className="hidden max-w-[180px] truncate text-[11px] text-white/35 md:block">
                  {summary}
                </span>
              ) : null}
              {open ? (
                <ChevronDown className="size-4 text-white/42" />
              ) : (
                <ChevronRight className="size-4 text-white/42" />
              )}
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-white/[0.08] px-4 pb-4 pt-4">
          {children}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ActionTextButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/58 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/[0.03] disabled:hover:text-white/58',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function PreferenceRow({
  entry,
  index,
  allowEdit = false,
  isEditing = false,
  isBusy = false,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onUpdateContent,
  onToggleStatus,
  onDelete,
}: {
  entry: ProfileEntry;
  index: number;
  allowEdit?: boolean;
  isEditing?: boolean;
  isBusy?: boolean;
  onStartEdit?: (index: number) => void;
  onCancelEdit?: (index: number) => void;
  onSaveEdit?: (index: number) => void;
  onUpdateContent?: (index: number, value: string) => void;
  onToggleStatus: (index: number) => void;
  onDelete: (index: number) => void;
}) {
  const source = getEntrySource(entry);
  const detail =
    source === 'learned'
      ? `Learned from conversation | ${Math.round(entry.confidence * 100)}% confidence | Updated ${formatTimestamp(entry.updated_at)}`
      : `Saved manually | Updated ${formatTimestamp(entry.updated_at)}`;

  return (
    <div
      className={cn(
        'rounded-2xl border px-3 py-3',
        entry.status === 'active'
          ? 'border-white/[0.06] bg-[#0f141b]'
          : 'border-white/[0.05] bg-[#0d1117] opacity-75',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/72">
              {getKindLabel(entry.kind)}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px]',
                source === 'learned'
                  ? 'bg-emerald-300/[0.08] text-emerald-100'
                  : 'bg-white/[0.06] text-white/72',
              )}
            >
              {source}
            </span>
            {entry.status !== 'active' ? (
              <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-white/52">
                hidden
              </span>
            ) : null}
          </div>

          {allowEdit && isEditing ? (
            <Textarea
              value={entry.content}
              onChange={(event) => onUpdateContent?.(index, event.target.value)}
              className="min-h-[88px] border-white/[0.08] bg-[#0c1118] text-sm text-white placeholder:text-white/35"
            />
          ) : (
            <p className="text-sm leading-6 text-white/84">{entry.content}</p>
          )}

          <div className="text-xs text-white/38">{detail}</div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {allowEdit ? (
            isEditing ? (
              <>
                <ActionTextButton disabled={isBusy} onClick={() => onSaveEdit?.(index)}>
                  <span className="flex items-center gap-1">
                    <Check className="size-3" />
                    Save
                  </span>
                </ActionTextButton>
                <ActionTextButton disabled={isBusy} onClick={() => onCancelEdit?.(index)}>
                  <span className="flex items-center gap-1">
                    <X className="size-3" />
                    Cancel
                  </span>
                </ActionTextButton>
              </>
            ) : (
              <ActionTextButton disabled={isBusy} onClick={() => onStartEdit?.(index)}>
                <span className="flex items-center gap-1">
                  <PencilLine className="size-3" />
                  Edit
                </span>
              </ActionTextButton>
            )
          ) : null}
          <ActionTextButton
            disabled={isBusy || isEditing}
            onClick={() => onToggleStatus(index)}
          >
            <span className="flex items-center gap-1">
              {entry.status === 'active' ? (
                <>
                  <EyeOff className="size-3" />
                  Hide
                </>
              ) : (
                <>
                  <RotateCcw className="size-3" />
                  Restore
                </>
              )}
            </span>
          </ActionTextButton>
          <ActionTextButton
            disabled={isBusy || isEditing}
            onClick={() => onDelete(index)}
            className="border-red-300/12 bg-red-300/[0.04] text-red-200/78 hover:bg-red-300/[0.08] hover:text-red-100 disabled:hover:bg-red-300/[0.04] disabled:hover:text-red-200/78"
          >
            <span className="flex items-center gap-1">
              <Trash2 className="size-3" />
              Delete
            </span>
          </ActionTextButton>
        </div>
      </div>
    </div>
  );
}

function StorageRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#0f141b] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">{label}</div>
      <div className="mt-1 break-all font-mono text-[12px] leading-5 text-white/72">
        {value ?? 'Unavailable'}
      </div>
    </div>
  );
}

function SqlKnowledgeCountsCard({
  title,
  counts,
  tone = 'default',
}: {
  title: string;
  counts: SqlKnowledgeCounts | undefined;
  tone?: 'default' | 'accent';
}) {
  const total =
    (counts?.validatedSqlPatterns ?? 0) +
    (counts?.analyticsTables ?? 0) +
    (counts?.analyticsJoins ?? 0) +
    (counts?.analyticsMetrics ?? 0) +
    (counts?.analyticsFilterValues ?? 0);

  return (
    <div
      className={cn(
        'rounded-2xl border px-3 py-3',
        tone === 'accent'
          ? 'border-emerald-300/12 bg-emerald-300/[0.05]'
          : 'border-white/[0.06] bg-[#0f141b]',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-white/86">{title}</div>
        <div className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/62">
          {total} items
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <SummaryChip label="SQL" value={counts?.validatedSqlPatterns ?? 0} />
        <SummaryChip label="Tables" value={counts?.analyticsTables ?? 0} />
        <SummaryChip label="Joins" value={counts?.analyticsJoins ?? 0} />
        <SummaryChip label="Metrics" value={counts?.analyticsMetrics ?? 0} />
        <SummaryChip label="Filters" value={counts?.analyticsFilterValues ?? 0} />
      </div>
    </div>
  );
}

export function ProfileSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    repo,
    storage,
    memory,
    context,
    response,
    sqlKnowledge,
    setMemoryMode,
    setContextMode,
    setResponseMode,
    setSqlKnowledgeMode,
    setLakebaseConfig,
    refreshConfig,
  } = useAppConfig();
  const [scope, setScope] = useState<ProfileScope>('global');
  const [profile, setProfile] = useState<ProfileDocument>(EMPTY_PROFILE);
  const [draftEntries, setDraftEntries] = useState<ProfileEntry[]>([]);
  const [newKind, setNewKind] = useState(KIND_OPTIONS[0].value);
  const [newContent, setNewContent] = useState('');
  const [activeView, setActiveView] = useState<ProfileView>('preferences');
  const [learnedOpen, setLearnedOpen] = useState(true);
  const [manualOpen, setManualOpen] = useState(true);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [sqlKnowledgeOpen, setSqlKnowledgeOpen] = useState(true);
  const [editingEntryKey, setEditingEntryKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sqlStatus, setSqlStatus] = useState<SqlKnowledgeStatus | null>(null);
  const [sqlStatusLoading, setSqlStatusLoading] = useState(false);
  const [sqlStatusError, setSqlStatusError] = useState<string | null>(null);
  const [sqlSyncDirection, setSqlSyncDirection] = useState<'push' | 'pull' | null>(null);
  const [lakebaseConnectionStringDraft, setLakebaseConnectionStringDraft] = useState('');
  const [lakebaseProjectDraft, setLakebaseProjectDraft] = useState('');
  const [lakebaseBranchDraft, setLakebaseBranchDraft] = useState('');
  const [lakebaseInstanceDraft, setLakebaseInstanceDraft] = useState('');

  const canUseProjectScope = !!repo?.path;
  const isDirty = useMemo(() => {
    return JSON.stringify(profile.entries) !== JSON.stringify(draftEntries);
  }, [profile.entries, draftEntries]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (scope === 'project' && !canUseProjectScope) {
      setProfile({
        ...EMPTY_PROFILE,
        scope: 'project',
        title: 'Project profile',
      });
      setDraftEntries([]);
      setEditingEntryKey(null);
      setError(null);
      return;
    }

    let canceled = false;
    setIsLoading(true);
    setError(null);
    setEditingEntryKey(null);
    void refreshConfig();

    loadProfile(scope)
      .then((loaded) => {
        if (canceled) {
          return;
        }
        setProfile(loaded);
        setDraftEntries(loaded.entries);
      })
      .catch((err: unknown) => {
        if (canceled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!canceled) {
          setIsLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [open, scope, canUseProjectScope, refreshConfig]);

  useEffect(() => {
    setLakebaseConnectionStringDraft(sqlKnowledge?.lakebase.connectionString ?? '');
    setLakebaseProjectDraft(sqlKnowledge?.lakebase.project ?? '');
    setLakebaseBranchDraft(sqlKnowledge?.lakebase.branch ?? '');
    setLakebaseInstanceDraft(sqlKnowledge?.lakebase.instanceName ?? '');
  }, [
    sqlKnowledge?.lakebase.branch,
    sqlKnowledge?.lakebase.connectionString,
    sqlKnowledge?.lakebase.instanceName,
    sqlKnowledge?.lakebase.project,
  ]);

  async function refreshSqlStatus() {
    if (!open) {
      return;
    }
    setSqlStatusLoading(true);
    setSqlStatusError(null);
    try {
      const status = await loadSqlKnowledgeStatus();
      setSqlStatus(status);
    } catch (err: unknown) {
      setSqlStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setSqlStatusLoading(false);
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    void refreshSqlStatus();
  }, [open, repo?.path, sqlKnowledge?.mode]);

  const activeEntries = useMemo(
    () => draftEntries.filter((entry) => entry.status === 'active'),
    [draftEntries],
  );
  const learnedEntries = useMemo(
    () => sortEntries(activeEntries.filter((entry) => getEntrySource(entry) === 'learned')),
    [activeEntries],
  );
  const manualEntries = useMemo(
    () => sortEntries(activeEntries.filter((entry) => getEntrySource(entry) === 'manual')),
    [activeEntries],
  );
  const hiddenEntries = useMemo(
    () => sortEntries(draftEntries.filter((entry) => entry.status !== 'active')),
    [draftEntries],
  );

  const entrySummary = useMemo(() => {
    return {
      activeCount: activeEntries.length,
      inactiveCount: hiddenEntries.length,
      learnedCount: learnedEntries.length,
      manualCount: manualEntries.length,
    };
  }, [activeEntries.length, hiddenEntries.length, learnedEntries.length, manualEntries.length]);

  const lakebaseDraftDirty =
    lakebaseConnectionStringDraft !== (sqlKnowledge?.lakebase.connectionString ?? '') ||
    lakebaseProjectDraft !== (sqlKnowledge?.lakebase.project ?? '') ||
    lakebaseBranchDraft !== (sqlKnowledge?.lakebase.branch ?? '') ||
    lakebaseInstanceDraft !== (sqlKnowledge?.lakebase.instanceName ?? '');

  async function persistEntries(
    nextEntries: ProfileEntry[],
    options?: {
      revertOnError?: boolean;
      editingKeyOnSuccess?: string | null;
      editingKeyOnError?: string | null;
    },
  ) {
    const previousEntries = draftEntries;
    const revertOnError = options?.revertOnError ?? true;

    setDraftEntries(nextEntries);
    setIsSaving(true);
    setError(null);

    try {
      const saved = await saveProfile(scope, nextEntries);
      setProfile(saved);
      setDraftEntries(saved.entries);
      setEditingEntryKey(options?.editingKeyOnSuccess ?? null);
      await refreshConfig();
      return true;
    } catch (err: unknown) {
      if (revertOnError) {
        setDraftEntries(previousEntries);
      }
      setEditingEntryKey(options?.editingKeyOnError ?? null);
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  function updateEntryContent(index: number, value: string) {
    setDraftEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, content: value } : entry,
      ),
    );
  }

  async function removeEntry(index: number) {
    const nextEntries = draftEntries.filter((_, entryIndex) => entryIndex !== index);
    await persistEntries(nextEntries, { revertOnError: true });
  }

  async function toggleEntryStatus(index: number) {
    const nextEntries = draftEntries.map((entry, entryIndex) =>
      entryIndex === index
        ? {
            ...entry,
            status: entry.status === 'active' ? 'inactive' : 'active',
            updated_at: nowIso(),
          }
        : entry,
    );
    await persistEntries(nextEntries, { revertOnError: true });
  }

  async function addEntry() {
    const trimmed = newContent.trim();
    if (!trimmed) {
      return;
    }

    const timestamp = nowIso();
    const nextEntries = [
      {
        kind: newKind,
        content: trimmed,
        status: 'active',
        confidence: 1,
        created_at: timestamp,
        updated_at: timestamp,
        source: 'manual' as const,
      },
      ...draftEntries,
    ];

    setNewContent('');
    const saved = await persistEntries(nextEntries, { revertOnError: true });
    if (!saved) {
      setNewContent(trimmed);
    }
  }

  function beginEdit(entry: ProfileEntry) {
    setEditingEntryKey(getEntryKey(entry));
    setError(null);
  }

  function cancelEdit() {
    setDraftEntries(profile.entries);
    setEditingEntryKey(null);
    setError(null);
  }

  async function saveEditedEntry(index: number) {
    const entry = draftEntries[index];
    if (!entry) {
      return;
    }

    const trimmed = entry.content.trim();
    if (!trimmed) {
      setError('Profile entries cannot be empty.');
      return;
    }

    const nextEntries = draftEntries.map((currentEntry, entryIndex) =>
      entryIndex === index
        ? {
            ...currentEntry,
            content: trimmed,
            updated_at: nowIso(),
          }
        : currentEntry,
    );

    await persistEntries(nextEntries, {
      revertOnError: false,
      editingKeyOnSuccess: null,
      editingKeyOnError: getEntryKey(entry),
    });
  }

  function handleExportMarkdown() {
    const markdown = buildProfileMarkdown(profile, draftEntries);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const scopeSuffix =
      profile.scope === 'project' && profile.workspace_name
        ? `-${profile.workspace_name}`
        : `-${profile.scope}`;
    anchor.href = url;
    anchor.download = `coding-buddy-profile${scopeSuffix}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleOpenStateChange(nextOpen: boolean) {
    if (!nextOpen && editingEntryKey) {
      cancelEdit();
    }
    onOpenChange(nextOpen);
  }

  function handleScopeChange(nextScope: ProfileScope) {
    if (nextScope === scope || isSaving || editingEntryKey) {
      return;
    }
    setScope(nextScope);
  }

  async function handleSqlModeChange(nextMode: SqlKnowledgeMode) {
    setSqlStatusError(null);
    try {
      await setSqlKnowledgeMode(nextMode);
      await refreshSqlStatus();
    } catch (err: unknown) {
      setSqlStatusError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveLakebaseConnection() {
    setSqlStatusError(null);
    try {
      await setLakebaseConfig({
        connectionString: lakebaseConnectionStringDraft,
        project: lakebaseProjectDraft,
        branch: lakebaseBranchDraft,
        instanceName: lakebaseInstanceDraft,
      });
      await refreshSqlStatus();
    } catch (err: unknown) {
      setSqlStatusError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSqlSync(direction: 'push' | 'pull') {
    setSqlStatusError(null);
    setSqlSyncDirection(direction);
    try {
      const payload = await syncSqlKnowledge(direction);
      setSqlStatus(payload.targetStatus);
    } catch (err: unknown) {
      setSqlStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setSqlSyncDirection(null);
    }
  }

  const viewButtons: Array<{ id: ProfileView; label: string }> = [
    { id: 'behavior', label: 'Behavior' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'advanced', label: 'Advanced' },
  ];

  const footerText = error
    ? error
    : isSaving
      ? 'Saving profile changes…'
      : editingEntryKey
        ? 'Save or cancel the current edit.'
        : 'Profile changes save immediately.';

  return (
    <Sheet open={open} onOpenChange={handleOpenStateChange}>
      <SheetContent
        side="right"
        className="w-full border-white/[0.08] bg-[#0b1016] px-0 text-white shadow-[0_30px_90px_rgba(0,0,0,0.45)] sm:max-w-[620px]"
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-white/[0.08] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-[15px] font-medium text-white">
                    Profile
                  </SheetTitle>
                  {isDirty ? (
                    <span className="rounded-full border border-amber-300/12 bg-amber-300/[0.05] px-2 py-0.5 text-[11px] text-amber-100">
                      Editing
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-white/55">
                  Keep reusable context tight, visible, and easy to prune.
                </p>
              </div>
              <div className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] p-1">
                <button
                  type="button"
                  disabled={isSaving || !!editingEntryKey}
                  onClick={() => handleScopeChange('global')}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-45',
                    scope === 'global'
                      ? 'bg-white text-black'
                      : 'text-white/65 hover:text-white',
                  )}
                >
                  Global
                </button>
                <button
                  type="button"
                  disabled={isSaving || !!editingEntryKey || !canUseProjectScope}
                  onClick={() => handleScopeChange('project')}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-45',
                    scope === 'project'
                      ? 'bg-white text-black'
                      : 'text-white/65 hover:text-white',
                  )}
                >
                  Project
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/72">
                {profile.title}
              </span>
              {scope === 'project' && repo?.name ? (
                <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/72">
                  {repo.name}
                </span>
              ) : null}
              <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/52">
                Updated {formatTimestamp(profile.updated_at)}
              </span>
            </div>

            <div className="mt-4 inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] p-1">
              {viewButtons.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  disabled={!!editingEntryKey}
                  onClick={() => setActiveView(view.id)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-45',
                    activeView === view.id
                      ? 'bg-white text-black'
                      : 'text-white/62 hover:text-white',
                  )}
                >
                  {view.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {isLoading ? (
              <div className="rounded-[26px] border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-sm text-white/55">
                Loading profile data…
              </div>
            ) : activeView === 'behavior' ? (
              <div className="space-y-4">
                <SectionCard
                  title="Conversation memory"
                  description="Pick how aggressively the app compresses chat history. Work is the balanced default for serious coding; Raw keeps much more of the thread verbatim."
                  action={
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-white/72">
                      {memory?.mode === 'raw'
                        ? 'Raw'
                        : memory?.mode === 'work'
                          ? 'Work'
                          : 'Lean'}
                    </span>
                  }
                >
                  <div className="inline-flex rounded-full border border-white/[0.08] bg-black/20 p-1">
                    {[
                      { value: 'lean', label: 'Lean' },
                      { value: 'work', label: 'Work' },
                      { value: 'raw', label: 'Raw' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setMemoryMode(option.value as MemoryMode)}
                        className={cn(
                          'rounded-full px-3 py-1.5 text-xs transition',
                          memory?.mode === option.value
                            ? 'bg-white text-black'
                            : 'text-white/65 hover:text-white',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <SummaryChip label="Mode" value={memory?.mode ?? '-'} />
                    <SummaryChip
                      label="Raw window"
                      value={`${memory?.recentMessages ?? '-'} msgs`}
                    />
                    <SummaryChip
                      label="Summary"
                      value={`${memory?.maxSummaryWords ?? '-'} words`}
                    />
                  </div>
                </SectionCard>

                <SectionCard
                  title="Context source"
                  description="Choose whether future chats should reuse durable user and project preferences, or start clean while still remembering the current thread."
                  action={
                    <button
                      type="button"
                      role="switch"
                      aria-checked={context?.mode === 'fresh'}
                      onClick={() =>
                        setContextMode(
                          context?.mode === 'fresh' ? 'personalized' : 'fresh',
                        )
                      }
                      className={cn(
                        'relative h-7 w-12 shrink-0 rounded-full border transition',
                        context?.mode === 'fresh'
                          ? 'border-white/[0.2] bg-white/[0.16]'
                          : 'border-white/[0.12] bg-white/[0.05]',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-1 size-5 rounded-full bg-white transition',
                          context?.mode === 'fresh' ? 'left-6' : 'left-1',
                        )}
                      />
                    </button>
                  }
                >
                  <div className="rounded-2xl border border-white/[0.06] bg-[#0f141b] px-3 py-2.5 text-sm text-white/82">
                    {context?.mode === 'fresh'
                      ? 'Fresh session: durable profile memory is ignored.'
                      : 'Personalized session: learned and manual profile memory is reused.'}
                  </div>
                </SectionCard>

                <SectionCard
                  title="Response style"
                  description="Keep answers execution-first, or ask the assistant to also include a compact why, tradeoff, and next validation step."
                  action={
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-white/72">
                      {response?.mode === 'teach' ? 'Teach' : 'Direct'}
                    </span>
                  }
                >
                  <div className="inline-flex rounded-full border border-white/[0.08] bg-black/20 p-1">
                    {[
                      { value: 'direct', label: 'Direct' },
                      { value: 'teach', label: 'Teach' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setResponseMode(option.value as ResponseMode)}
                        className={cn(
                          'rounded-full px-3 py-1.5 text-xs transition',
                          response?.mode === option.value
                            ? 'bg-white text-black'
                            : 'text-white/65 hover:text-white',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </SectionCard>
              </div>
            ) : activeView === 'preferences' ? (
              !canUseProjectScope && scope === 'project' ? (
                <div className="rounded-[26px] border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-sm text-white/55">
                  Select a repo first. The project profile is scoped to the active repo.
                </div>
              ) : (
                <div className="space-y-4">
                  <SectionCard
                    title="Memory surface"
                    description="Only active items are reused in future personalized chats. Learned items come from prior conversations; manual items are things you want pinned on purpose."
                  >
                    <div className="grid gap-2 sm:grid-cols-4">
                      <SummaryChip label="Active" value={entrySummary.activeCount} />
                      <SummaryChip
                        label="Learned"
                        value={entrySummary.learnedCount}
                        emphasis="learned"
                      />
                      <SummaryChip label="Manual" value={entrySummary.manualCount} />
                      <SummaryChip
                        label="Hidden"
                        value={entrySummary.inactiveCount}
                        emphasis="muted"
                      />
                    </div>
                  </SectionCard>

                  <DisclosureSection
                    icon={<Sparkles className="size-4" />}
                    title="Learned preferences"
                    description="Everything the assistant has inferred and may reuse later."
                    count={learnedEntries.length}
                    summary={
                      learnedEntries.length > 0
                        ? truncateSummary(learnedEntries[0].content)
                        : undefined
                    }
                    open={learnedOpen}
                    onOpenChange={setLearnedOpen}
                  >
                    {learnedEntries.length === 0 ? (
                      <p className="text-sm text-white/50">
                        No learned preferences saved for this scope yet.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {learnedEntries.map((entry) => {
                          const index = draftEntries.findIndex(
                            (currentEntry) =>
                              getEntryKey(currentEntry) === getEntryKey(entry),
                          );
                          if (index < 0) {
                            return null;
                          }
                          return (
                            <PreferenceRow
                              key={getEntryKey(entry)}
                              entry={entry}
                              index={index}
                              isBusy={isSaving}
                              onToggleStatus={toggleEntryStatus}
                              onDelete={removeEntry}
                            />
                          );
                        })}
                      </div>
                    )}
                  </DisclosureSection>

                  <DisclosureSection
                    icon={<BrainCircuit className="size-4" />}
                    title="Manual profile"
                    description="Stable preferences, facts, and constraints you want carried forward."
                    count={manualEntries.length}
                    summary={
                      manualEntries.length > 0
                        ? truncateSummary(manualEntries[0].content)
                        : undefined
                    }
                    open={manualOpen}
                    onOpenChange={setManualOpen}
                  >
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                        <select
                          value={newKind}
                          onChange={(event) => setNewKind(event.target.value)}
                          disabled={isSaving || !!editingEntryKey}
                          className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-white outline-hidden disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {KIND_OPTIONS.map((option) => (
                            <option
                              key={option.value}
                              value={option.value}
                              className="bg-[#0b1016]"
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <Input
                            value={newContent}
                            onChange={(event) => setNewContent(event.target.value)}
                            placeholder="Add a durable preference, fact, or constraint"
                            disabled={isSaving || !!editingEntryKey}
                            className="border-white/[0.08] bg-white/[0.04] text-white placeholder:text-white/35"
                          />
                          <Button
                            type="button"
                            onClick={addEntry}
                            disabled={isSaving || !!editingEntryKey || !newContent.trim()}
                            className="rounded-full bg-white text-black hover:bg-white/90 disabled:bg-white/[0.08] disabled:text-white/35"
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs leading-5 text-white/45">
                        Keep this list tight. Use it for stable preferences and constraints, not one-off task details.
                      </p>

                      {manualEntries.length === 0 ? (
                        <p className="text-sm text-white/50">
                          No manual preferences saved for this scope yet.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {manualEntries.map((entry) => {
                            const index = draftEntries.findIndex(
                              (currentEntry) =>
                                getEntryKey(currentEntry) === getEntryKey(entry),
                            );
                            if (index < 0) {
                              return null;
                            }
                            const rowKey = getEntryKey(entry);
                            return (
                              <PreferenceRow
                                key={rowKey}
                                entry={entry}
                                index={index}
                                allowEdit
                                isBusy={isSaving}
                                isEditing={editingEntryKey === rowKey}
                                onStartEdit={() => beginEdit(entry)}
                                onCancelEdit={cancelEdit}
                                onSaveEdit={saveEditedEntry}
                                onUpdateContent={updateEntryContent}
                                onToggleStatus={toggleEntryStatus}
                                onDelete={removeEntry}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </DisclosureSection>

                  <DisclosureSection
                    icon={<EyeOff className="size-4" />}
                    title="Hidden items"
                    description="Preferences you have muted for now. Restore them when you want them reused again."
                    count={hiddenEntries.length}
                    open={hiddenOpen}
                    onOpenChange={setHiddenOpen}
                  >
                    {hiddenEntries.length === 0 ? (
                      <p className="text-sm text-white/50">Nothing hidden right now.</p>
                    ) : (
                      <div className="space-y-3">
                        {hiddenEntries.map((entry) => {
                          const index = draftEntries.findIndex(
                            (currentEntry) =>
                              getEntryKey(currentEntry) === getEntryKey(entry),
                          );
                          if (index < 0) {
                            return null;
                          }
                          return (
                            <PreferenceRow
                              key={getEntryKey(entry)}
                              entry={entry}
                              index={index}
                              isBusy={isSaving}
                              onToggleStatus={toggleEntryStatus}
                              onDelete={removeEntry}
                            />
                          );
                        })}
                      </div>
                    )}
                  </DisclosureSection>
                </div>
              )
            ) : (
              <div className="space-y-4">
                <DisclosureSection
                  icon={<Database className="size-4" />}
                  title="SQL knowledge store"
                  description="Choose whether SQL patterns and analytics context read from local memory, shared Lakebase memory, or a local-first hybrid view."
                  summary={
                    sqlStatus?.effective_mode
                      ? `Active: ${sqlStatus.effective_mode}`
                      : sqlKnowledge?.mode
                  }
                  open={sqlKnowledgeOpen}
                  onOpenChange={setSqlKnowledgeOpen}
                >
                  <div className="space-y-4">
                    <div className="inline-flex rounded-full border border-white/[0.08] bg-black/20 p-1">
                      {[
                        { value: 'local', label: 'Local' },
                        { value: 'lakebase', label: 'Lakebase' },
                        { value: 'hybrid', label: 'Hybrid' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() =>
                            handleSqlModeChange(option.value as SqlKnowledgeMode)
                          }
                          className={cn(
                            'rounded-full px-3 py-1.5 text-xs transition',
                            sqlKnowledge?.mode === option.value
                              ? 'bg-white text-black'
                              : 'text-white/65 hover:text-white',
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <Input
                      value={lakebaseConnectionStringDraft}
                      onChange={(event) =>
                        setLakebaseConnectionStringDraft(event.target.value)
                      }
                      placeholder="psql 'postgresql://role@host/database?sslmode=require'"
                      className="border-white/[0.08] bg-white/[0.04] text-white placeholder:text-white/35"
                    />

                    <div className="grid gap-3 sm:grid-cols-3">
                      <Input
                        value={lakebaseProjectDraft}
                        onChange={(event) => setLakebaseProjectDraft(event.target.value)}
                        placeholder="Lakebase project"
                        className="border-white/[0.08] bg-white/[0.04] text-white placeholder:text-white/35"
                      />
                      <Input
                        value={lakebaseBranchDraft}
                        onChange={(event) => setLakebaseBranchDraft(event.target.value)}
                        placeholder="Branch"
                        className="border-white/[0.08] bg-white/[0.04] text-white placeholder:text-white/35"
                      />
                      <Input
                        value={lakebaseInstanceDraft}
                        onChange={(event) => setLakebaseInstanceDraft(event.target.value)}
                        placeholder="Instance name (optional)"
                        className="border-white/[0.08] bg-white/[0.04] text-white placeholder:text-white/35"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleSaveLakebaseConnection}
                        disabled={!lakebaseDraftDirty}
                        className="rounded-full border-white/[0.08] bg-transparent text-white hover:bg-white/[0.06] hover:text-white"
                      >
                        Save connection
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void refreshSqlStatus()}
                        disabled={sqlStatusLoading}
                        className="rounded-full border-white/[0.08] bg-transparent text-white hover:bg-white/[0.06] hover:text-white"
                      >
                        {sqlStatusLoading ? 'Refreshing…' : 'Refresh status'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleSqlSync('push')}
                        disabled={sqlSyncDirection !== null}
                        className="rounded-full border-white/[0.08] bg-transparent text-white hover:bg-white/[0.06] hover:text-white"
                      >
                        {sqlSyncDirection === 'push'
                          ? 'Pushing…'
                          : 'Push local to Lakebase'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleSqlSync('pull')}
                        disabled={sqlSyncDirection !== null}
                        className="rounded-full border-white/[0.08] bg-transparent text-white hover:bg-white/[0.06] hover:text-white"
                      >
                        {sqlSyncDirection === 'pull'
                          ? 'Pulling…'
                          : 'Pull Lakebase to local'}
                      </Button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-4">
                      <SummaryChip label="Mode" value={sqlKnowledge?.mode ?? 'local'} />
                      <SummaryChip
                        label="Effective"
                        value={sqlStatus?.effective_mode ?? sqlKnowledge?.mode ?? 'local'}
                        emphasis="learned"
                      />
                      <SummaryChip
                        label="Lakebase"
                        value={sqlKnowledge?.lakebase.configured ? 'Configured' : 'Not set'}
                        emphasis={
                          sqlKnowledge?.lakebase.configured ? 'default' : 'muted'
                        }
                      />
                      <SummaryChip
                        label="Profile"
                        value={sqlStatus?.profile ?? 'DEFAULT'}
                        emphasis="muted"
                      />
                    </div>

                    {sqlStatus?.lakebase.connection ? (
                      <p className="text-xs leading-5 text-white/45">
                        Lakebase {sqlStatus.lakebase.connection.kind ?? 'connection'} -
                        timeout {sqlStatus.lakebase.connection.pool_timeout_seconds ?? '30'}s
                        {sqlStatus.lakebase.connection.branch_parent
                          ? ` - ${sqlStatus.lakebase.connection.branch_parent}`
                          : ''}
                        {sqlStatus.lakebase.connection.host
                          ? ` - ${sqlStatus.lakebase.connection.host}`
                          : ''}
                        {sqlStatus.lakebase.connection.database
                          ? `/${sqlStatus.lakebase.connection.database}`
                          : ''}
                      </p>
                    ) : null}

                    {sqlStatusError ? (
                      <div className="whitespace-pre-line rounded-2xl border border-red-300/12 bg-red-300/[0.05] px-3 py-3 text-sm text-red-100">
                        {sqlStatusError}
                      </div>
                    ) : null}

                    {sqlStatus?.lakebase.error ? (
                      <div className="whitespace-pre-line rounded-2xl border border-amber-300/12 bg-amber-300/[0.05] px-3 py-3 text-sm text-amber-100">
                        {sqlStatus.lakebase.error}
                      </div>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <SqlKnowledgeCountsCard
                        title="Local store"
                        counts={sqlStatus?.local}
                      />
                      <SqlKnowledgeCountsCard
                        title="Lakebase store"
                        counts={sqlStatus?.lakebase.counts}
                        tone="accent"
                      />
                    </div>

                    {sqlStatus?.active ? (
                      <SqlKnowledgeCountsCard
                        title="Active retrieval surface"
                        counts={sqlStatus.active}
                        tone="accent"
                      />
                    ) : null}

                    <p className="text-xs leading-5 text-white/45">
                      Hybrid keeps new saves local, reads local first, and layers the
                      shared Lakebase knowledge on top when it is reachable.
                    </p>
                  </div>
                </DisclosureSection>

                <DisclosureSection
                  icon={<Database className="size-4" />}
                  title="Local storage"
                  description="Where the app keeps conversation memory, history, analytics context, and the profile file for the current scope."
                  open={storageOpen}
                  onOpenChange={setStorageOpen}
                >
                  <div className="grid gap-2">
                    <StorageRow
                      label="Conversation memory DB"
                      value={storage?.conversationMemoryDbPath}
                    />
                    <StorageRow
                      label="Chat history store"
                      value={storage?.localChatHistoryPath}
                    />
                    <StorageRow label="SQL memory DB" value={storage?.sqlMemoryDbPath} />
                    <StorageRow
                      label="Analytics context DB"
                      value={storage?.analyticsContextDbPath}
                    />
                    <StorageRow label="Agent repo root" value={storage?.agentRoot} />
                    <StorageRow label="Current profile path" value={profile.path} />
                  </div>
                </DisclosureSection>

                <SectionCard
                  title="Export"
                  description="Download the current scope as Markdown if you want a human-readable snapshot of what the assistant may reuse."
                  action={
                    <div className="flex size-9 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#0f141b] text-white/72">
                      <HardDrive className="size-4" />
                    </div>
                  }
                >
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-[#0f141b] px-3 py-3">
                    <div>
                      <div className="text-sm text-white/84">
                        Export current profile snapshot
                      </div>
                      <div className="mt-1 text-xs text-white/42">
                        Includes active entries for the selected scope.
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleExportMarkdown}
                      className="rounded-full border-white/[0.08] bg-transparent text-white hover:bg-white/[0.06] hover:text-white"
                    >
                      Export .md
                    </Button>
                  </div>
                </SectionCard>

                <SectionCard
                  title="Current scope"
                  description="A quick reminder of which profile file you are editing right now."
                  action={
                    <div className="flex size-9 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#0f141b] text-white/72">
                      <FolderOpen className="size-4" />
                    </div>
                  }
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <StorageRow label="Scope" value={scope} />
                    <StorageRow label="Workspace" value={profile.workspace_name} />
                  </div>
                </SectionCard>
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.08] px-6 py-4">
            <div className="flex items-center justify-between gap-3">
              <p
                className={cn(
                  'text-xs',
                  error ? 'text-red-300' : 'text-white/40',
                )}
              >
                {footerText}
              </p>
              <div className="flex items-center gap-2">
                {profile.path ? (
                  <span className="hidden max-w-[260px] truncate text-[11px] text-white/32 md:block">
                    {profile.path}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenStateChange(false)}
                  className="rounded-full border-white/[0.08] bg-transparent text-white hover:bg-white/[0.06] hover:text-white"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
