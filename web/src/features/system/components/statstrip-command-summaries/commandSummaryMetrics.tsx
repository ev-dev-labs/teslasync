import type { TFunction } from 'i18next';
import type { StatMetric } from '@/components/data-display';
import { HelpTooltip } from '@/components/ui';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import type { CommandReliabilitySummary } from '../../lib/commandReliability';

export interface CommandHistorySummary {
  total: number;
  total24h: number;
  successRate: number;
  failedCount: number;
  mostUsed: string | null;
  lastCommand: CommandLogEntry | null;
}

export function commandHistoryMetrics(
  summary: CommandHistorySummary | null,
  t: TFunction,
  commandName: (command: string) => string,
  precision: number,
): StatMetric[] {
  return [
    {
      metricId: 'count', occurrenceId: 'total',
      label: t('commandHistory.total', 'Total commands'),
      rawValue: summary?.total,
    },
    {
      metricId: 'count', occurrenceId: 'total24h',
      label: t('commandHistory.total24h', 'Commands (24h)'),
      rawValue: summary?.total24h,
      context: t('commandHistory.summary.rollingScope', 'Last 24 hours within the selected window'),
    },
    {
      metricId: 'percent', occurrenceId: 'successRate',
      label: t('commandHistory.successRate', 'Success rate'),
      rawValue: summary?.successRate,
      display: { precision },
    },
    {
      metricId: 'count', occurrenceId: 'failed',
      label: t('commandHistory.failed', 'Failed'),
      rawValue: summary?.failedCount,
    },
    {
      metricId: 'text', occurrenceId: 'mostUsed',
      label: t('commandHistory.mostUsed', 'Most used'),
      rawValue: summary?.mostUsed ? commandName(summary.mostUsed) : null,
    },
    {
      metricId: 'text', occurrenceId: 'lastSent',
      label: t('commandHistory.lastSent', 'Last sent'),
      rawValue: summary?.lastCommand
        ? formatRelative(summary.lastCommand.created_at, { tz: 'UTC' }) : null,
      context: summary?.lastCommand
        ? formatDateTime(summary.lastCommand.created_at, { tz: 'UTC' }) : undefined,
    },
  ];
}

export function commandReliabilityMetrics(
  summary: CommandReliabilitySummary | null,
  t: TFunction,
): StatMetric[] {
  const overallLabel = t('commandReliability.overall', 'Overall success');
  const overallHelp = 'Three successes out of three is not the same evidence as ninety-seven out of a hundred, even though both read as a high percentage. The Wilson score interval accounts for how much evidence there actually is, so a command is only graded reliable once its pessimistic lower bound clears the bar — not merely its lucky average.';
  return [
    {
      metricId: 'percent', occurrenceId: 'overall',
      label: overallLabel,
      rawValue: summary ? Math.round(summary.overallSuccessRate * 100) : null,
      display: { precision: 0 },
      context: <div className="flex flex-wrap items-center gap-1">
        {t('commandReliability.attempts', '{{n}} attempts', {
          n: summary?.totalAttempts ?? '—',
        })}
        <HelpTooltip
          size="xs"
          i18nKey="help.commandReliability.overall"
          defaultValue={overallHelp}
          ariaLabel={t('metricCard.moreInfoAbout', 'More info about {{label}}', { label: overallLabel })}
        />
      </div>,
      description: t('help.commandReliability.overall', overallHelp),
    },
    {
      metricId: 'count', occurrenceId: 'unreliable',
      label: t('commandReliability.unreliable', 'Unreliable commands'),
      rawValue: summary?.unreliableCount,
      context: summary
        ? summary.worstCommand?.label ?? t('commandReliability.allFine', 'Nothing failing')
        : undefined,
    },
    {
      metricId: 'count', occurrenceId: 'intents',
      label: t('commandReliability.intents', 'Distinct intents'),
      rawValue: summary?.totalIntents,
      context: t('commandReliability.intentsHint', 'after collapsing retry storms'),
    },
    {
      metricId: 'count', occurrenceId: 'storms',
      label: t('commandReliability.storms', 'Retry storms'),
      rawValue: summary?.storms.length,
      context: t('commandReliability.stormsHint', 'you pressed it again, and again'),
    },
  ];
}
