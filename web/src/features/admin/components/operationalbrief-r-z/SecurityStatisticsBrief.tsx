import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Button } from '@/components/ui';
import { QueryError, EmptyState } from '@/components/feedback';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { SecurityStats } from '../security-access/helpers';
import { briefSource, type BriefSource } from './briefSource';

export function SecurityStatisticsBrief({ securityStats, sentryUptime, isLoading, error, onRetry, className,
  source, scope }: {
  securityStats: SecurityStats | null; sentryUptime: number; isLoading: boolean; error: unknown;
  onRetry?: () => void; className?: string; source: BriefSource; scope: string;
}) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const sampleHint = t('admin.security.brief.sentry', 'Percentage of returned security-event samples with Sentry active; not time-weighted uptime or complete vehicle coverage.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'security-lock-events', rawValue: securityStats?.lockEvents,
      label: t('admin.security.stats.lockEvents', 'Lock/unlock events'), description: scope },
    { metricId: 'percent', occurrenceId: 'security-stats-sentry', rawValue: securityStats ? sentryUptime : null,
      label: t('admin.security.stats.sentryUptime', 'Sentry uptime'), description: sampleHint,
      display: { formatter: value => ({ value: `${fmtInt(value)}%`, unit: '' }) } },
    { metricId: 'count', occurrenceId: 'security-door-opens', rawValue: securityStats?.doorOpenCount,
      label: t('admin.security.stats.doorOpens', 'Door open events'), description: scope },
    { metricId: 'count', occurrenceId: 'security-window-opens', rawValue: securityStats?.windowOpenCount,
      label: t('admin.security.stats.windowOpens', 'Window open events'), description: scope },
    { metricId: 'count', occurrenceId: 'security-homelink', rawValue: securityStats?.homelinkCount,
      label: t('admin.security.stats.homelink', 'HomeLink detections'), description: scope },
    { metricId: 'count', occurrenceId: 'security-guest', rawValue: securityStats?.guestCount,
      label: t('admin.security.stats.guestMode', 'Guest mode usage'), description: scope },
    { metricId: 'count', occurrenceId: 'security-stats-total', rawValue: securityStats?.total,
      label: t('admin.security.stats.totalEvents', 'Total events'), description: scope },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <div className={className}>
    <OperationalBrief compact testId="security-statistics-brief" metrics={operationalMetrics}
      eyebrow={t('admin.security.title', 'Security & access')} title={t('admin.security.statsTitle', 'Security statistics')}
      description={scope} scope={scope} provenance={sampleHint} {...briefSource(t, source)}
      loading={isLoading && !source.retained}
      actions={onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>
        {t('admin.security.refreshHistory', 'Refresh security history')}
      </Button>} />
    {error ? <QueryError error={error} onRetry={onRetry} /> : !isLoading && !securityStats ? <EmptyState
      message={t('admin.security.statsEmpty', 'No security events are available in this history window.')}
      description={t('admin.security.statsEmptyDescription', 'Lock, door, window, HomeLink, and Sentry statistics appear after security state changes are recorded.')}
      action={onRetry ? { label: t('admin.security.refreshHistory', 'Refresh security history'), onClick: onRetry } : undefined} /> : null}
  </div>;
}
