import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { DataStatus } from '@/api/dataState';

interface Props {
  title: string;
  description: string;
  metrics: readonly StatMetric[];
  scope: ReactNode;
  provenance: string;
  testId: string;
  loading?: boolean;
  unavailable?: boolean;
  retained?: boolean;
  unknown?: boolean;
  statusLabel?: string;
  freshness?: ReactNode;
  sourceStatus?: DataStatus;
  sourceBounds?: readonly { signal: string; from?: string; to?: string }[];
}

export function TelemetrySummaryBrief({
  title, description, metrics, scope, provenance, testId, loading = false,
  unavailable = false, retained = false, unknown = false, statusLabel, freshness, sourceStatus, sourceBounds = [],
}: Props) {
  const { t } = useTranslation();
  const operationalMetrics = useOperationalMetrics(metrics);
  return (
    <OperationalBrief compact testId={testId} metrics={operationalMetrics}
      eyebrow={t('telemetryBrief.eyebrow', 'Telemetry evidence')}
      title={title} description={description}
      scope={<>{scope}{sourceBounds.map((bound, index) => <span key={`${bound.signal}-${index}`}>
        {' · '}{bound.from && bound.to
          ? t('telemetryBrief.returnedBounds', '{{signal}} source bounds: {{from}} → {{to}}', bound)
          : t('telemetryBrief.sourceBoundsUnknown', '{{signal}} source bounds not supplied', { signal: bound.signal })}
      </span>)}</>}
      provenance={provenance}
      loading={loading && !retained}
      statusLabel={retained ? t('operationalSummary.retained', 'Retained source data')
        : unavailable || sourceStatus === 'unavailable' ? t('operationalSummary.unavailable', 'Source unavailable')
          : loading ? t('operationalSummary.loading', 'Loading sources')
            : unknown ? t('operationalSummary.unknown', 'Source values unknown')
              : sourceStatus === 'partial' ? t('telemetryBrief.partial', 'Partial source coverage')
                : statusLabel ?? t('operationalSummary.snapshot', 'Queried snapshot')}
      statusTone={retained || unavailable || sourceStatus === 'partial' || sourceStatus === 'unavailable' ? 'warning' : 'neutral'}
      freshness={freshness ?? (retained
        ? t('developerReference.stats.state.retained', 'Showing retained measurements')
        : undefined)}
    />
  );
}
