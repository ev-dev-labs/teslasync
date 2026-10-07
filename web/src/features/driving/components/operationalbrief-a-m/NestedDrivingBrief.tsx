import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric, StatPeriod } from '@/components/data-display/stat-reference';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { MetricPreferences } from '@/lib/metric-reference';

export interface NestedDrivingMetric extends StatMetric {
  /** Source presentation is retained separately from the independently validated raw operand. */
  readonly displayValue?: string;
}

interface Props {
  metrics: readonly NestedDrivingMetric[];
  title: string;
  description: string;
  period: StatPeriod;
  preferences?: MetricPreferences;
  loading?: boolean;
  retained?: boolean;
  unavailable?: boolean;
  testId?: string;
}

export function NestedDrivingBrief({
  metrics, title, description, period, preferences, loading = false,
  retained = false, unavailable = false, testId,
}: Props) {
  const { t } = useTranslation();
  const sourceMetrics: StatMetric[] = metrics.map(({ displayValue, ...metric }) =>
    displayValue === undefined ? metric : {
      ...metric,
      display: { formatter: () => ({ value: displayValue, unit: '' }) },
    });
  const values = useOperationalMetrics(sourceMetrics, preferences);
  const coverage = {
    complete: t('driving.brief.completeScope', 'Complete analysis window'),
    subset: t('driving.brief.subsetScope', 'Returned subset'),
    unknown: t('driving.brief.unknownScope', 'Coverage unknown'),
  };
  const scope = period.kind === 'analysis'
    ? `${period.label} · ${t('driving.brief.exclusiveBounds', '{{start}} to {{end}} (exclusive end)', { start: period.start, end: period.endExclusive })} · ${period.timezone} · ${coverage[period.completeness]}`
    : period.kind === 'event'
      ? `${period.label} · #${period.eventId} · ${period.start} – ${period.end ?? t('dynamics.trip.inProgress', 'In progress')}`
      : period.kind === 'snapshot'
        ? `${period.label} · ${period.observedAt ?? t('driving.brief.observationUnknown', 'Source observation time not provided')}`
        : period.label;
  const provenance = period.kind === 'unknown'
    ? period.reason ?? description
    : period.provenance ?? description;
  return <OperationalBrief compact metrics={values} title={title}
    eyebrow={t('driving.brief.eyebrow', 'Driving evidence')}
    description={description} scope={scope} provenance={provenance}
    loading={loading} testId={testId}
    statusLabel={unavailable
      ? t('driving.brief.unavailable', 'Source unavailable')
      : loading ? t('driving.brief.loading', 'Loading source')
        : retained ? t('driving.brief.retained', 'Retained source')
          : t('driving.brief.returned', 'Returned evidence')}
    statusTone={unavailable ? 'danger' : retained ? 'warning' : 'neutral'} />;
}
