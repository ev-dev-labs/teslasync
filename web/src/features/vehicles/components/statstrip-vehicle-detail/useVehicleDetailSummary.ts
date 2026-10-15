import { useTranslation } from 'react-i18next';
import type { DataStateSource } from '@/api/dataState';
import type { StatPeriod } from '@/lib/metric-reference';
import type { OperationalTone } from '@/components/data-display';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';

export interface VehicleDetailSummaryProps {
  sourceQuery?: DataStateSource<unknown>;
}

/** Each band describes its own read, never a synthetic shared analysis range. */
export function useVehicleDetailSummary(
  source: string,
  query?: DataStateSource<unknown>,
  sourceTime?: string | null,
  available?: boolean,
) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const trust = useDataState(query ?? { data: available ? true : undefined });
  const queryTime = new Date(trust.updatedAt ?? NaN);
  const observedAt = sourceTime ?? (Number.isFinite(queryTime.getTime())
    ? queryTime.toISOString() : null);
  const validTime = observedAt != null && Number.isFinite(Date.parse(observedAt));
  const period: StatPeriod = {
    kind: 'snapshot',
    label: validTime ? formatDateTime(observedAt) : t('vehicles.detail.summaryUnknown', 'Source time unknown'),
    observedAt: validTime ? observedAt : null,
    provenance: t('vehicles.detail.summaryProvenance', '{{source}} snapshot', { source }),
  };
  const loading = !trust.hasData && Boolean(query?.isPending || query?.isLoading);
  const retained = trust.hasData && trust.status === 'stale';
  const statusLabel = loading ? t('vehicles.detail.brief.loading', 'Loading source')
    : retained ? t('vehicles.detail.brief.retained', 'Retained source snapshot')
    : trust.fatalError ? t('vehicles.detail.brief.unavailable', 'Source unavailable')
    : trust.hasData ? t('vehicles.detail.brief.snapshot', 'Source snapshot')
    : t('vehicles.detail.brief.unknown', 'No source readings');
  const statusTone: OperationalTone = retained ? 'warning' : trust.fatalError ? 'danger' : 'neutral';
  return {
    period,
    loading,
    retained,
    brief: {
      statusLabel, statusTone, loading,
      scope: source,
      freshness: period.label,
      provenance: t('vehicles.detail.brief.provenance', '{{source}} · {{time}}', {
        source: period.provenance, time: period.label,
      }),
    },
  };
}
