import type { LanguageModelUsage } from 'ai';
import type { ChatMessage } from '@chat-template/core';

function totalTokensForUsage(usage: LanguageModelUsage | undefined): number {
  if (!usage) {
    return 0;
  }
  return usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
}

export function getMessageUsage(message: ChatMessage): LanguageModelUsage | undefined {
  const usagePart = message.parts.find(
    (
      part,
    ): part is { type: 'data-usage'; data: LanguageModelUsage } =>
      part.type === 'data-usage',
  );
  return usagePart?.data;
}

export function sumUsageTotals(usages: Array<LanguageModelUsage | undefined>): LanguageModelUsage | undefined {
  let inputTokens = 0;
  let outputTokens = 0;
  let sawAny = false;

  for (const usage of usages) {
    if (!usage) {
      continue;
    }
    sawAny = true;
    inputTokens += usage.inputTokens ?? 0;
    outputTokens += usage.outputTokens ?? 0;
  }

  if (!sawAny) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function sumMessageUsageTotals(messages: ChatMessage[]): LanguageModelUsage | undefined {
  return sumUsageTotals(messages.map(getMessageUsage));
}

export function formatTokenCount(value: number | undefined): string {
  if (!value || value <= 0) {
    return '0';
  }
  if (value < 1000) {
    return `${value}`;
  }
  if (value < 10000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return `${Math.round(value / 1000)}k`;
}

export function formatUsageLine(usage: LanguageModelUsage | undefined): string | null {
  if (!usage) {
    return null;
  }
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const total = totalTokensForUsage(usage);
  if (input <= 0 && output <= 0 && total <= 0) {
    return null;
  }
  return `${formatTokenCount(input)} in · ${formatTokenCount(output)} out · ${formatTokenCount(total)} total`;
}

export function formatUsageInline(usage: LanguageModelUsage | undefined): string | null {
  if (!usage) {
    return null;
  }
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  if (input <= 0 && output <= 0) {
    return null;
  }
  return `${formatTokenCount(input)} in · ${formatTokenCount(output)} out`;
}
