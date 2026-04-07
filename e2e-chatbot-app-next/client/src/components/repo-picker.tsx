import { useMemo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppConfig } from '@/contexts/AppConfigContext';

export function RepoPicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { repo, setRepoPath } = useAppConfig();
  const [path, setPath] = useState(repo?.path ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const helperText = useMemo(() => {
    if (!repo?.path) return 'Choose the local repository the agent can inspect and edit.';
    return `Currently scoped to ${repo.path}`;
  }, [repo?.path]);

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      await setRepoPath(path.trim() || null);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-white/[0.08] bg-[#0f141b] text-white shadow-[0_32px_90px_rgba(0,0,0,0.45)]">
        <AlertDialogHeader>
          <AlertDialogTitle>Select Repository</AlertDialogTitle>
          <AlertDialogDescription className="text-white/55">
            {helperText}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <Input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/Users/you/path/to/repo"
            className="border-white/[0.08] bg-white/[0.04] text-white placeholder:text-white/30"
          />
          {repo?.path && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/60">
              Active repo: {repo.path}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/[0.08] bg-transparent text-white hover:bg-white/[0.06] hover:text-white">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleSave();
            }}
            className="bg-white text-black hover:bg-white/90"
          >
            {isSaving ? 'Saving...' : 'Use Repo'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
