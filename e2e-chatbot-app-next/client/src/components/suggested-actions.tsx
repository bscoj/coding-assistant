import { memo } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { VisibilityType } from './visibility-selector';
import type { ChatMessage } from '@chat-template/core';
import { Button } from '@/components/ui/button';
import { DbIcon } from './ui/db-icon';
import {
  BeakerIcon,
  BugIcon,
  FileModelIcon,
  ShieldIcon,
} from './icons';

interface SuggestedActionsProps {
  chatId: string;
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  selectedVisibilityType: VisibilityType;
}

const ML_SUGGESTED_ACTIONS = [
  {
    title: 'Map this ML repo',
    subtitle: 'training, eval, inference, deployment',
    prompt:
      'Use ml_repo_overview() and give me a sharp map of this ML repo: training entrypoints, evaluation flow, data/feature pipelines, inference or serving surfaces, and the biggest risks.',
    icon: FileModelIcon,
  },
  {
    title: 'Review experiment plan',
    subtitle: 'baseline, metrics, next best tests',
    prompt:
      'Act like a senior ML engineer. Help me review this modeling approach, pressure-test the baseline and metrics, and propose the next 3 experiments with rationale.',
    icon: BeakerIcon,
  },
  {
    title: 'Find leakage risks',
    subtitle: 'splits, labels, train-serve skew',
    prompt:
      'Inspect this ML repo for leakage risk, weak split logic, feature timing issues, calibration gaps, and train-serve skew. Then tell me the highest-risk findings first.',
    icon: BugIcon,
  },
  {
    title: 'Production readiness',
    subtitle: 'serving, MLflow, monitoring, rollback',
    prompt:
      'Review this ML project for production readiness. Focus on MLflow lineage, serving or batch scoring flow, schema checks, monitoring, rollback, and the missing guardrails before ship.',
    icon: ShieldIcon,
  },
] as const;

function PureSuggestedActions({ chatId, sendMessage }: SuggestedActionsProps) {
  const _ = { chatId };
  void _;

  return (
    <div className="mx-auto mt-4 grid w-full max-w-4xl gap-2 px-4 md:grid-cols-2">
      {ML_SUGGESTED_ACTIONS.map((action) => (
        <Button
          key={action.title}
          type="button"
          variant="secondary"
          className="h-auto items-start justify-start rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-left text-white hover:bg-white/[0.06]"
          onClick={() =>
            sendMessage({
              role: 'user',
              parts: [
                {
                  type: 'text',
                  text: action.prompt,
                },
              ],
            })
          }
        >
          <div className="mt-0.5 rounded-xl border border-white/10 bg-white/[0.04] p-2 text-white/72">
            <DbIcon icon={action.icon} className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-white/92">{action.title}</div>
            <div className="text-xs text-white/48">{action.subtitle}</div>
          </div>
        </Button>
      ))}
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.chatId !== nextProps.chatId) return false;
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType)
      return false;

    return true;
  },
);
