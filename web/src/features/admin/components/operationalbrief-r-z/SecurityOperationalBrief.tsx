import { useTranslation } from 'react-i18next';
import { OperationalBrief, type OperationalTone, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { timeSince } from '../security-access/helpers';
import { briefSource, type BriefSource } from './briefSource';

export function SecurityOperationalBrief({ isSecure, lastLockChange, sentryUptime, totalEvents,
  latestLoading, historyLoading, source, start, endExclusive, vehicleId, observedAt }: {
  isSecure: boolean | null; lastLockChange?: string; sentryUptime: number | null; totalEvents: number | null;
  latestLoading: boolean; historyLoading: boolean; source: BriefSource;
  start: string; endExclusive: string; vehicleId: string; observedAt?: string;
}) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const scope = t('admin.security.brief.scope', 'Vehicle {{vehicle}} · History {{start}} to {{end}} (exclusive). Current status comes from a separate latest-state query.', {
    vehicle: vehicleId || '—', start, end: endExclusive,
  });
  const sampleHint = t('admin.security.brief.sentry', 'Percentage of returned security-event samples with Sentry active; not time-weighted uptime or complete vehicle coverage.');
  const lockHint = t('admin.security.brief.lastLock', 'Latest observed lock transition in the returned history, or the first event timestamp when no transition is found.');
  const ageSeconds = lastLockChange ? (Date.now() - new Date(lastLockChange).getTime()) / 1000 : null;
  const metrics: readonly StatMetric[] = [
    { metricId: 'status', occurrenceId: 'security-status', rawValue: latestLoading || isSecure === null ? null
      : isSecure ? t('admin.security.secure', 'Secure') : t('admin.security.unsecure', 'Unsecure'),
      label: t('admin.security.stat.status', 'Current status'), description: scope },
    { metricId: 'duration', occurrenceId: 'security-last-lock', rawValue: historyLoading || (ageSeconds != null && ageSeconds < 0) ? null : ageSeconds,
      label: t('admin.security.stat.lastLock', 'Last lock change'), description: lockHint,
      context: lastLockChange,
      display: { formatter: () => ({ value: timeSince(lastLockChange, t), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'security-sentry', rawValue: historyLoading ? null : sentryUptime,
      label: t('admin.security.stat.sentryUptime', 'Sentry uptime'), description: sampleHint,
      display: { formatter: value => ({ value: `${fmtInt(value)}%`, unit: '' }) } },
    { metricId: 'count', occurrenceId: 'security-events', rawValue: historyLoading ? null : totalEvents,
      label: t('admin.security.stat.totalEvents', 'Total events'), description: scope },
  ];
  const statusTone: OperationalTone = isSecure === null ? 'neutral' : isSecure ? 'success' : 'danger';
  const operationalMetrics = useOperationalMetrics(metrics).map((metric, index) => ({
    ...metric, tone: index === 0 ? statusTone : undefined,
  }));
  return <OperationalBrief compact testId="security-operational-brief" metrics={operationalMetrics}
    eyebrow={t('admin.security.title', 'Security & access')} title={t('admin.security.brief.title', 'Security observation summary')}
    description={scope} scope={scope} provenance={sampleHint}
    freshness={t('admin.security.brief.freshness', 'Latest security observation: {{when}}', { when: observedAt ?? '—' })}
    {...briefSource(t, source)} loading={source.loading && !source.retained} />;
}
