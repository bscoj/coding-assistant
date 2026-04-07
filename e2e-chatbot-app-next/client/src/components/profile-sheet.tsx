import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { fetchWithErrorHandlers } from '@/lib/utils';
import { useAppConfig } from '@/contexts/AppConfigContext';

type ProfileScope = 'global' | 'project';

type ProfileEntry = {
  kind: string;
  content: string;
  status: string;
  confidence: number;
  created_at: string;
  updated_at: string;
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

export function ProfileSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { repo } = useAppConfig();
  const [scope, setScope] = useState<ProfileScope>('global');
  const [profile, setProfile] = useState<ProfileDocument>(EMPTY_PROFILE);
  const [draftEntries, setDraftEntries] = useState<ProfileEntry[]>([]);
  const [newKind, setNewKind] = useState(KIND_OPTIONS[0].value);
  const [newContent, setNewContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUseProjectScope = !!repo?.path;

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
      return;
    }

    let canceled = false;
    setIsLoading(true);
    setError(null);
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
  }, [open, scope, canUseProjectScope, repo?.path]);

  const isDirty = useMemo(() => {
    return JSON.stringify(profile.entries) !== JSON.stringify(draftEntries);
  }, [profile.entries, draftEntries]);

  function updateEntry(index: number, patch: Partial<ProfileEntry>) {
    setDraftEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    );
  }

  function removeEntry(index: number) {
    setDraftEntries((current) => current.filter((_, entryIndex) => entryIndex !== index));
  }

  function addEntry() {
    const trimmed = newContent.trim();
    if (!trimmed) {
      return;
    }
    const now = new Date().toISOString();
    setDraftEntries((current) => [
      {
        kind: newKind,
        content: trimmed,
        status: 'active',
        confidence: 1,
        created_at: now,
        updated_at: now,
      },
      ...current,
    ]);
    setNewContent('');
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const saved = await saveProfile(scope, draftEntries);
      setProfile(saved);
      setDraftEntries(saved.entries);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full border-white/[0.08] bg-[#0b1016] px-0 text-white shadow-[0_30px_90px_rgba(0,0,0,0.45)] sm:max-w-[560px]"
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-white/[0.08] px-6 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <SheetTitle className="text-[15px] font-medium text-white">
                  Profile memory
                </SheetTitle>
                <p className="text-sm text-white/55">
                  Edit the durable facts and preferences the agent should keep.
                </p>
              </div>
              <div className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] p-1">
                <button
                  type="button"
                  onClick={() => setScope('global')}
                  className={`rounded-full px-3 py-1.5 text-xs ${
                    scope === 'global'
                      ? 'bg-white text-black'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  Global
                </button>
                <button
                  type="button"
                  onClick={() => setScope('project')}
                  className={`rounded-full px-3 py-1.5 text-xs ${
                    scope === 'project'
                      ? 'bg-white text-black'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  Project
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-white/50">
              <Badge variant="secondary" className="rounded-full bg-white/[0.06] text-white/75">
                {profile.title}
              </Badge>
              {scope === 'project' && repo?.name ? (
                <Badge variant="secondary" className="rounded-full bg-white/[0.06] text-white/75">
                  {repo.name}
                </Badge>
              ) : null}
            </div>
          </div>

          {!canUseProjectScope && scope === 'project' ? (
            <div className="px-6 py-6 text-sm text-white/60">
              Select a repo first. The project profile is scoped to the active repo.
            </div>
          ) : (
            <>
              <div className="border-b border-white/[0.08] px-6 py-5">
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                    <select
                      value={newKind}
                      onChange={(event) => setNewKind(event.target.value)}
                      className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-white outline-hidden"
                    >
                      {KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value} className="bg-[#0b1016]">
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <Input
                        value={newContent}
                        onChange={(event) => setNewContent(event.target.value)}
                        placeholder="Add a durable preference, fact, or constraint"
                        className="border-white/[0.08] bg-white/[0.04] text-white placeholder:text-white/35"
                      />
                      <Button
                        type="button"
                        onClick={addEntry}
                        className="rounded-full bg-white text-black hover:bg-white/90"
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs leading-5 text-white/45">
                    Keep this list tight. Use it for stable preferences and facts, not one-off task details.
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {isLoading ? (
                  <p className="text-sm text-white/55">Loading profile…</p>
                ) : draftEntries.length === 0 ? (
                  <p className="text-sm text-white/55">
                    No saved entries yet for this scope.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {draftEntries.map((entry, index) => (
                      <div
                        key={`${entry.kind}-${entry.content}-${index}`}
                        className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <select
                            value={entry.kind}
                            onChange={(event) =>
                              updateEntry(index, { kind: event.target.value })
                            }
                            className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-white outline-hidden"
                          >
                            {KIND_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value} className="bg-[#0b1016]">
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => removeEntry(index)}
                            className="text-xs text-white/45 hover:text-white"
                          >
                            Remove
                          </button>
                        </div>
                        <Textarea
                          value={entry.content}
                          onChange={(event) =>
                            updateEntry(index, { content: event.target.value })
                          }
                          className="min-h-[92px] border-white/[0.08] bg-[#0f141b] text-sm text-white placeholder:text-white/35"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="border-t border-white/[0.08] px-6 py-4">
            {error ? (
              <p className="mb-3 text-sm text-red-300">{error}</p>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-white/40">
                {profile.path ? `Stored at ${profile.path}` : 'No profile file yet'}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="rounded-full border-white/[0.08] bg-transparent text-white hover:bg-white/[0.06] hover:text-white"
                >
                  Close
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={!isDirty || isSaving || (scope === 'project' && !canUseProjectScope)}
                  className="rounded-full bg-white text-black hover:bg-white/90 disabled:bg-white/[0.08] disabled:text-white/35"
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
