import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { UnitFormatter } from '@/hooks/useUnits';
import type { TripKpis } from '../sharing-trips/helpers';

interface Props {
  kpis: TripKpis;
  hasData: boolean;
  loading: boolean;
  retained: boolean;
  paused: boolean;
  refreshing: boolean;
  unresolvedMessage: string | null;
  vehicleId: number | null;
  formatDistance: UnitFormatter;
  formatEnergy: UnitFormatter;
}

export function SharingTripsBrief({
  kpis, hasData, loading, retained, paused, refreshing, unresolvedMessage,
  vehicleId, formatDistance, formatEnergy,
}: Props) {
  const { t } = useTranslation();
  const description = t('sharing.trips.brief.description', 'Totals cover only the returned recent-trip list (at most 20 trips), not all trips or a selected date window.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'shareable', rawValue: hasData ? kpis.count : null,
      label: t('sharing.trips.kpi.shareable', 'Shareable trips'), description },
    { metricId: 'distance', occurrenceId: 'distance', rawValue: hasData ? kpis.totalDistanceM : null,
      label: t('sharing.trips.kpi.distance', 'Total distance'), description,
      display: { formatter: (raw) => ({ value: formatDistance(raw), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'energy', rawValue: hasData ? kpis.totalEnergyWh : null,
      label: t('sharing.trips.kpi.energy', 'Total energy'), description,
      display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'drives', rawValue: hasData ? kpis.totalDrives : null,
      label: t('sharing.trips.kpi.drives', 'Total drives'), description },
  ];
  const values = useOperationalMetrics(metrics);
  const status = loading ? t('sharing.trips.brief.loading', 'Loading recent trips')
    : unresolvedMessage ?? (retained ? t('sharing.trips.brief.retained', 'Cached trips; refresh failed')
      : paused ? t('sharing.trips.brief.paused', 'Cached trips; refresh paused')
        : refreshing ? t('sharing.trips.brief.refreshing', 'Refreshing cached trips')
          : t('sharing.trips.brief.resolved', 'Recent-trip list resolved'));
  return (
    <OperationalBrief
      compact
      loading={loading}
      testId="sharing-trips-operational-brief"
      eyebrow={t('sharing.trips.brief.eyebrow', 'Sharing')}
      title={t('sharing.trips.brief.title', 'Recent-trip evidence')}
      description={description}
      statusLabel={status}
      statusTone={retained ? 'warning' : 'neutral'}
      metrics={loading || unresolvedMessage ? [] : values}
      scope={vehicleId == null
        ? t('sharing.trips.brief.fleet', 'Fleet recent-trip list')
        : t('sharing.trips.brief.vehicle', 'Selected vehicle recent-trip list')}
      freshness={t('sharing.trips.brief.freshness', 'Trip dates are source periods; no query freshness timestamp is inferred.')}
      provenance={t('sharing.trips.brief.provenance', 'GET /trips; limit 20; totals retain the existing safe-number aggregation of returned fields.')}
    />
  );
}
