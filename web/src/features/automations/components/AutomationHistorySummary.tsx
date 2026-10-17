import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { GlassPanel } from '@/components/ui';
import { DataStateNotice, QueryError } from '@/components/feedback';
import type { AutomationHistoryListResponse } from '@/api/types';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function AutomationHistorySummary({ query, scope }: {
  query: UseQueryResult<AutomationHistoryListResponse>;
  scope?: string;
}) {
  const { formatDurationMs } = useNumberFormatting();
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const summary = query.data?.summary;
  const source = useDataState({ ...query, data: query.data ?? undefined });
  const context = t('automations.historyBrief.context', 'Server summary across the selected period and rule/status filters, not just this page of rows.');
  const noRuns = t('automations.historyBrief.noRuns', 'No completed runs in this summary; a rate and average duration are undefined.');
  const rawMetrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'total', rawValue: summary?.total_executions, label: t('automations.historyPage.total', 'Completed runs'), description: context },
    { metricId: 'count', occurrenceId: 'success', rawValue: summary?.succeeded, label: t('automations.historyPage.success', 'Succeeded'), description: context },
    { metricId: 'count', occurrenceId: 'failed', rawValue: summary?.failed, label: t('automations.historyPage.failed', 'Failed'), description: context },
    { metricId: 'count', occurrenceId: 'partial', rawValue: summary?.partial, label: t('automations.historyPage.partial', 'Partial'), description: context },
    { metricId: 'percent', occurrenceId: 'rate', rawValue: summary && summary.total_executions > 0 ? summary.success_rate : null,
      label: t('automations.historyPage.rate', 'Success rate'), description: context, missingReason: summary?.total_executions === 0 ? noRuns : undefined,
      display: { formatter: (raw) => ({ value: fmtNumber(raw), unit: '%' }) } },
    { metricId: 'duration', occurrenceId: 'duration', rawValue: summary && summary.total_executions > 0 && summary.avg_duration_ms != null ? summary.avg_duration_ms / 1000 : null,
      label: t('automations.historyPage.duration', 'Average duration'), description: context, missingReason: summary?.total_executions === 0 ? noRuns : undefined,
      display: { formatter: (raw) => ({ value: formatDurationMs(raw * 1000), unit: '' }) } },
  ];
  const metrics = useOperationalMetrics(rawMetrics);
  return (
    <div>
      <OperationalBrief
        compact
        testId="automation-history-brief"
        eyebrow={t('automations.historyBrief.eyebrow', 'Automation executions')}
        title={t('automations.historyPage.summary', 'Execution summary')}
        description={context}
        statusLabel={query.isLoading && !summary ? t('automations.historyBrief.loading', 'Loading executions')
          : !summary ? t('automations.historyBrief.unavailable', 'Summary unavailable')
            : source.refreshError || source.isRefreshBlocked ? t('automations.historyBrief.retained', 'Retained execution summary')
              : t('automations.historyBrief.available', 'Summary loaded')}
        statusTone={source.refreshError || source.isRefreshBlocked || !summary ? 'warning' : 'neutral'}
        loading={query.isLoading && !summary}
        metrics={metrics}
        scope={scope ?? t('automations.historyBrief.unknownScope', 'Execution window supplied by the caller')}
        freshness={t('automations.historyBrief.freshness', 'History response; live events are a separate source')}
        provenance={context}
      />
      {!summary && !query.isLoading && (
        <GlassPanel className="p-5">
          {source.fatalError ? (
            <QueryError error={source.fatalError} onRetry={() => { void query.refetch(); }} />
          ) : (
            <DataStateNotice state="unavailable" />
          )}
        </GlassPanel>
      )}
    </div>
  );
}
