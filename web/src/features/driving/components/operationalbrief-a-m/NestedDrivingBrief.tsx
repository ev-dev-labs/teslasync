import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import { Text } from '@/components/ui';
import type { StatMetric, StatPeriod } from '@/components/data-display';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { MetricPreferences } from '@/components/data-display';

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
  variant?: 'standalone' | 'embedded';
}

export function NestedDrivingBrief({
  metrics, title, description, period, preferences, loading = false,
  retained = false, unavailable = false, testId, variant = 'standalone',
}: Props) {
  const { t } = useTranslation();
  const { formatDateRange, formatDateTime } = useDateFormat();
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
  // One formatted range/moment in the user's display zone: the raw ISO
  // bounds plus zone suffix duplicated the span and exposed an exclusive
  // end day. Coverage wording is unchanged.
  const scope = period.kind === 'analysis'
    ? `${period.label} · ${formatDateRange(period.start, period.endExclusive)} · ${coverage[period.completeness]}`
    : period.kind === 'event'
      ? `${period.label} · #${period.eventId} · ${formatDateTime(period.start)} – ${period.end ? formatDateTime(period.end) : t('dynamics.trip.inProgress', 'In progress')}`
      : period.kind === 'snapshot'
        ? `${period.label} · ${period.observedAt ? formatDateTime(period.observedAt) : t('driving.brief.observationUnknown', 'Source observation time not provided')}`
        : period.label;
  const provenance = period.kind === 'unknown'
    ? period.reason ?? description
    : period.provenance ?? description;
  return <OperationalBrief compact variant={variant} metrics={values} title={title}
    eyebrow={t('driving.brief.eyebrow', 'Driving evidence')}
    description={description}
    scope={<Text as="span" size="xs" color="muted" className="min-w-0 break-words">{scope}</Text>}
    provenance={provenance}
    loading={loading && !retained} testId={testId}
    statusLabel={retained
      ? t('driving.brief.retained', 'Retained source')
      : unavailable ? t('driving.brief.unavailable', 'Source unavailable')
        : loading ? t('driving.brief.loading', 'Loading source')
          : t('driving.brief.returned', 'Returned evidence')}
    statusTone={retained ? 'warning' : unavailable ? 'danger' : 'neutral'} />;
}
