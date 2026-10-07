import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric, type StatPeriod } from '@/components/data-display';
import { Text } from '@/components/ui';
import { VisuallyHidden } from '@/components/a11y';
import type { APICallLogStats } from '@/api/types';
import type { DataState } from '@/api/dataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { sourceBriefStatus } from './sourceBriefStatus';

interface Props {
  state: DataState<APICallLogStats>;
  loading: boolean;
  start: string;
  endExclusive: string;
  timezone: string;
  allTime: boolean;
}

export function ApiLogsSummary({ state, loading, start, endExclusive, timezone, allTime }: Props) {
  const { t } = useTranslation();
  const stats = state.data;
  const provenance = t('apiLogs.summary.rangeScope', 'Totals, error rate, and average duration use the View settings range; request-list filters do not change these metrics.');
  const period: StatPeriod = allTime
    ? { kind: 'alltime', label: t('common.allTime', 'All time'), provenance }
    : { kind: 'analysis', label: t('apiLogs.summary.selectedRange', 'View settings range'),
      start, endExclusive, timezone, completeness: 'complete', provenance };
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'api-total-calls', rawValue: stats?.total_calls,
      label: t('apiLogs.totalCalls', 'Total calls'), description: t('apiLogs.totalCalls', 'Total calls') },
    { metricId: 'percent', occurrenceId: 'api-error-rate', rawValue: stats?.error_rate,
      label: t('apiLogs.errorRate', 'Error rate'), description: t('apiLogs.errorRate', 'Error rate'),
      comparisonContent: stats && stats.error_rate > 5 && stats.error_count != null
        ? <Text as="div" size="xs" weight="medium" className="flex items-center gap-1 text-rose-700 dark:text-rose-300">
          <span aria-hidden="true">↑</span>
          <VisuallyHidden>{t('statCard.trend.increased', 'increased')}</VisuallyHidden>
          <span>{String(stats.error_count)}</span>
        </Text> : undefined },
    { metricId: 'latency', occurrenceId: 'api-average-duration',
      rawValue: stats?.avg_duration_ms == null ? null : stats.avg_duration_ms / 1000,
      display: { precision: 0, latencyStyle: 'milliseconds' }, label: t('apiLogs.avgDuration', 'Avg duration'),
      description: t('apiLogs.avgDuration', 'Avg duration') },
  ];
  const retained = state.hasData && (state.status === 'stale' || state.isRefreshing);
  const error = state.fatalError?.message ?? state.refreshError?.message;
  const briefMetrics = useOperationalMetrics(metrics);
  const rollingMetrics = useOperationalMetrics([{ metricId: 'count', occurrenceId: 'api-last-24h', rawValue: stats?.last_24h,
    label: t('apiLogs.last24h', 'Last 24h'), description: t('apiLogs.last24h', 'Last 24h') }]);
  const status = sourceBriefStatus(state, loading, t);
  return <section aria-label={t('apiLogs.title', 'API logs')} className="space-y-3">
    {retained && <Text role="status">{t('developerReference.stats.state.retained', 'Showing retained measurements')}</Text>}
    {error && <Text role="alert">{error}</Text>}
    <OperationalBrief testId="api-logs-range-summary" compact metrics={briefMetrics}
      eyebrow={t('apiLogs.title', 'API logs')} title={t('apiLogs.summary.title', 'Request activity')}
      description={provenance} {...status} loading={loading && !state.hasData}
      scope={<Text as="span" variant="caption">{period.label}{period.kind === 'analysis'
        ? `: ${t('apiLogs.summary.rangeBounds', '{{start}} – {{end}} ({{timezone}}, exclusive end)', { start, end: endExclusive, timezone })}` : ''}</Text>}
      provenance={provenance} />
    <OperationalBrief testId="api-logs-24h-summary" compact metrics={rollingMetrics}
      eyebrow={t('apiLogs.title', 'API logs')} title={t('apiLogs.last24h', 'Last 24h')}
      description={t('apiLogs.summary.last24hScope', 'Independent rolling 24-hour count, not the View settings range. The response does not record its exact bounds.')}
      scope={<Text as="span" variant="caption">{t('apiLogs.last24h', 'Last 24h')}</Text>}
      {...status} loading={loading && !state.hasData} />
  </section>;
}
