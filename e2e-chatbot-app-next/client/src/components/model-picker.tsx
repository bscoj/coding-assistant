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
import { useAppConfig } from '@/contexts/AppConfigContext';

export function ModelPicker({
  open,
  onOpenChange,
  selectedModel,
  onSelectModel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
}) {
  const { models } = useAppConfig();
  const availableModels = models?.availableModels ?? [];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-white/[0.08] bg-[#0f141b] text-white shadow-[0_32px_90px_rgba(0,0,0,0.45)]">
        <AlertDialogHeader>
          <AlertDialogTitle>Select Model</AlertDialogTitle>
          <AlertDialogDescription className="text-white/55">
            Choose which Databricks serving endpoint the agent should use for the next turn. You can switch models at any time, including mid-conversation.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          {availableModels.length === 0 ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-sm text-white/60">
              No models are configured yet. Add `AGENT_AVAILABLE_MODEL_ENDPOINTS` in the agent repo `.env`, or set `LOCAL_AGENT_MODEL_ENDPOINTS` for the UI backend.
            </div>
          ) : (
            availableModels.map((model) => {
              const active = model === selectedModel;
              return (
                <button
                  key={model}
                  type="button"
                  onClick={() => onSelectModel(model)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                    active
                      ? 'border-white bg-white text-black'
                      : 'border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="truncate pr-3 text-sm">{model}</span>
                  <span className="text-xs opacity-70">
                    {active ? 'Current' : 'Use'}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/[0.08] bg-transparent text-white hover:bg-white/[0.06] hover:text-white">
            Close
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onOpenChange(false);
            }}
            className="bg-white text-black hover:bg-white/90"
          >
            Done
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
