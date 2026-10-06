import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, TimeStamp, type StatMetric, type StatPeriod } from '@/components/data-display';
import { Text } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { MetricPreferences } from '@/lib/metric-reference';

interface Props {
  id: string;
  title?: string;
  description?: string;
  metrics: readonly StatMetric[];
  period: StatPeriod;
  preferences?: MetricPreferences;
  loading?: boolean;
  retained?: boolean;
  available?: boolean;
  error?: string | null;
  footer?: ReactNode;
  className?: string;
  embedded?: boolean;
}

/** Preserve source-local evidence and specialist displays without claiming completeness. */
export function VehicleOperationalBrief({
  id, title, description, metrics, period, preferences, loading = false,
  retained = false, available, error, footer, className, embedded = false,
}: Props) {
  const { t } = useTranslation();
  const operationalMetrics = useOperationalMetrics(metrics, preferences);
  const known = available ?? metrics.some(metric => metric.rawValue != null);
  const status = loading ? 'loading' : retained ? 'retained'
    : error ? 'unavailable' : known ? 'returned' : 'unknown';
  const statusLabels = {
    loading: t('vehicleSystems.brief.loading', 'Loading source'),
    retained: t('vehicleSystems.brief.retained', 'Retained evidence'),
    unavailable: t('vehicleSystems.brief.unavailable', 'Source unavailable'),
    returned: t('vehicleSystems.brief.returned', 'Returned evidence'),
    unknown: t('vehicleSystems.brief.unknown', 'Evidence unresolved'),
  };
  const coverage = period.kind === 'unknown'
    ? period.reason ?? t('vehicleSystems.brief.coverage', 'Returned source only; completeness is not established.')
    : period.provenance;
  const freshness = period.kind === 'snapshot'
    ? period.observedAt
      ? <TimeStamp value={period.observedAt} />
      : t('vehicleSystems.brief.undated', 'Observation time unavailable')
    : t('vehicleSystems.brief.notLive', 'Not a live-state observation');

  return (
    <div className={className} data-source-period-kind={period.kind} data-source-retained={retained || undefined}>
      <OperationalBrief compact testId={id}
        eyebrow={t('vehicleSystems.brief.eyebrow', 'Vehicle systems evidence')}
        title={embedded
          ? t('vehicleSystems.brief.sectionSummary', '{{section}} evidence', { section: title ?? period.label })
          : title ?? period.label}
        description={description ?? coverage}
        metrics={operationalMetrics}
        statusLabel={statusLabels[status]}
        statusTone={retained || error ? 'warning' : 'neutral'}
        loading={loading}
        scope={<Text as="span" variant="caption">{period.label}</Text>}
        freshness={<Text as="span" variant="caption">{freshness}</Text>}
        provenance={coverage}
      />
      {retained && <Text as="p" variant="bodySm" role="status">
        {t('vehicleSystems.brief.retainedWarning', 'Showing retained measurements')}
      </Text>}
      {error && <Text as="p" variant="bodySm" role="alert">{error}</Text>}
      {footer}
    </div>
  );
}
