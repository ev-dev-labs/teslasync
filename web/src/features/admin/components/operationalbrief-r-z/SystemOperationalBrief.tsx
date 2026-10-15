import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type OperationalTone, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { useRateLimitStatus } from '@/api/hooks/useSystem';
import type { useQueueStatus } from '@/api/hooks/useSystemQueues';
import type { RateLimitSeverity } from '@/api/types';
import { deriveDataState } from '@/api/dataState';
import { briefSource } from './briefSource';

const SEVERITY_RANK: Record<RateLimitSeverity, number> = { ok: 0, warn: 1, critical: 2 };

export function SystemOperationalBrief({ rateLimit, queue }: {
  rateLimit: ReturnType<typeof useRateLimitStatus>; queue: ReturnType<typeof useQueueStatus>;
}) {
  const { t } = useTranslation();
  const { fmtPercent, fmtInt } = useNumberFormatting();
  const rateState = deriveDataState(rateLimit);
  const queueState = deriveDataState(queue);
  const scopes = rateLimit.data?.scopes ?? [];
  const workers = queue.data?.workers ?? [];
  const worstSeverity = scopes.reduce<RateLimitSeverity>(
    (worst, scope) => SEVERITY_RANK[scope.severity] > SEVERITY_RANK[worst] ? scope.severity : worst, 'ok');
  const peakUsage = scopes.reduce((peak, scope) => {
    const pct = (scope.limit ?? 0) > 0 ? ((scope.current ?? 0) / scope.limit) * 100 : 0;
    return Math.max(peak, pct);
  }, 0);
  const totals = useMemo(() => workers.reduce((acc, worker) => ({
    healthy: acc.healthy + (worker.heartbeat_severity === 'ok' ? 1 : 0),
    backlog: acc.backlog + (worker.pending ?? 0) + (worker.in_progress ?? 0),
    succeeded: acc.succeeded + (worker.succeeded_24h ?? 0),
    failed: acc.failed + (worker.failed_24h ?? 0),
  }), { healthy: 0, backlog: 0, succeeded: 0, failed: 0 }), [workers]);
  const scope = t('system.brief.scope', 'Budget usage spans each source throttle window. Worker heartbeat and backlog are snapshots; succeeded and terminally failed jobs cover the last 24 hours.');
  const budgetHint = scopes.length === 0 ? t('system.overview.noBudgets', 'No active budgets')
    : t(`rateLimitStatus.severity.${worstSeverity}`, worstSeverity);
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'system-budgets', rawValue: rateState.hasData ? scopes.length : null,
      label: t('system.overview.throttleBudgets', 'Throttle budgets'), description: scope,
      context: rateState.hasData ? budgetHint : t('system.overview.awaiting', 'Awaiting data') },
    { metricId: 'percent', occurrenceId: 'system-peak-usage', rawValue: rateState.hasData ? peakUsage : null,
      label: t('system.overview.peakUsage', 'Peak budget usage'), description: scope,
      context: t('system.overview.peakUsageHint', 'Of the tightest window'),
      display: { formatter: value => ({ value: fmtPercent(value), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'system-workers', rawValue: queueState.hasData ? totals.healthy : null,
      display: { countTotal: queueState.hasData ? workers.length : undefined,
        formatter: value => ({ value: `${fmtInt(value)} / ${fmtInt(workers.length)}`, unit: '' }) },
      label: t('system.overview.activeWorkers', 'Active workers'), description: scope,
      context: t('system.overview.activeWorkersHint', 'Reporting heartbeats') },
    { metricId: 'count', occurrenceId: 'system-backlog', rawValue: queueState.hasData ? totals.backlog : null,
      label: t('system.overview.backlog', 'Queue backlog'), description: scope,
      context: t('system.overview.backlogHint', 'Pending + in progress') },
    { metricId: 'count', occurrenceId: 'system-succeeded', rawValue: queueState.hasData ? totals.succeeded : null,
      label: t('system.overview.succeeded', 'Succeeded 24h'), description: scope,
      context: t('system.overview.succeededHint', 'Jobs completed') },
    { metricId: 'count', occurrenceId: 'system-failed', rawValue: queueState.hasData ? totals.failed : null,
      label: t('system.overview.failed', 'Failed 24h'), description: scope,
      context: t('system.overview.failedHint', 'Terminal failures') },
  ];
  const tones: readonly OperationalTone[] = [
    !rateState.hasData || scopes.length === 0 ? 'neutral'
      : worstSeverity === 'critical' ? 'danger' : worstSeverity === 'warn' ? 'warning' : 'success',
    !rateState.hasData ? 'neutral' : peakUsage >= 80 ? 'danger' : peakUsage >= 50 ? 'warning' : 'success',
    !queueState.hasData || workers.length === 0 ? 'neutral' : totals.healthy === workers.length ? 'success' : 'warning',
    'info', 'success', queueState.hasData && totals.failed > 0 ? 'danger' : 'success',
  ];
  const operationalMetrics = useOperationalMetrics(metrics).map((metric, index) => ({ ...metric, tone: tones[index] }));
  const retained = [rateState, queueState].some(state => state.hasData && (state.isRefreshing || state.status === 'stale'));
  const loading = !rateState.hasData && !queueState.hasData && (rateLimit.isLoading || queue.isLoading);
  const failed = !!rateState.fatalError || !!queueState.fatalError;
  return <div data-testid={loading ? 'system-overview-loading' : 'system-overview'} aria-busy={loading || undefined}>
    <OperationalBrief compact testId="system-operational-brief" metrics={operationalMetrics}
      eyebrow={t('system.page.title', 'System budgets')} title={t('system.brief.title', 'Budgets and worker posture')}
      description={scope} scope={scope}
      freshness={t('system.brief.freshness', 'Budget snapshot: {{rate}} · Worker snapshot: {{queue}}', {
        rate: rateLimit.data?.generated_at ?? '—', queue: queue.data?.generated_at ?? '—',
      })}
      provenance={t('system.brief.provenance', 'Rate-limit budgets and background-worker queue reports')}
      {...briefSource(t, { loading, retained, failed, known: rateState.hasData && queueState.hasData })}
      loading={loading} />
  </div>;
}
