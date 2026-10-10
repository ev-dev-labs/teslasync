import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Caption } from '@/components/ui';
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
      eyebrow={t('telemetry.brief.eyebrow', 'Telemetry evidence')}
      title={title} description={description}
      scope={<>{scope}{sourceBounds.map((bound, index) => <Caption key={`${bound.signal}-${index}`} className="min-w-0 break-words">
        {' · '}{bound.from && bound.to
          ? t('telemetry.brief.returnedBounds', '{{signal}} source bounds: {{from}} → {{to}}', bound)
          : t('telemetry.brief.sourceBoundsUnknown', '{{signal}} source bounds not supplied', { signal: bound.signal })}
      </Caption>)}</>}
      provenance={provenance}
      loading={loading && !retained}
      statusLabel={retained ? t('operationalSummary.retained', 'Retained source data')
        : unavailable || sourceStatus === 'unavailable' ? t('operationalSummary.unavailable', 'Source unavailable')
          : loading ? t('operationalSummary.loading', 'Loading sources')
            : unknown ? t('operationalSummary.unknown', 'Source values unknown')
              : sourceStatus === 'partial' ? t('telemetry.brief.partial', 'Partial source coverage')
                : statusLabel ?? t('operationalSummary.snapshot', 'Queried snapshot')}
      statusTone={retained || unavailable || sourceStatus === 'partial' || sourceStatus === 'unavailable' ? 'warning' : 'neutral'}
      freshness={freshness ?? (retained
        ? t('developerReference.stats.state.retained', 'Showing retained measurements')
        : undefined)}
    />
  );
}
