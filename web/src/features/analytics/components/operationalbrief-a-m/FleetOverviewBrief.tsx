import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { FleetAnalyticsQuery } from '../analytics/constants';

export function FleetOverviewBrief({ query, scope, retained }: {
  query: FleetAnalyticsQuery; scope: string; retained: boolean;
}) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { data, isLoading } = query;
  const distanceM = data?.total_distance_km != null ? data.total_distance_km * 1000 : null;
  const gasSavings = data?.total_distance_km != null && data?.total_cost != null
    ? Math.max(data.total_distance_km * 0.085 * 1.5 - data.total_cost, 0) : null;
  const metrics: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'fleet-overview-distance', rawValue: distanceM,
      label: t('analytics.hero.distance', 'Distance'),
      display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, unitPrefs.distance)), unit: unitPrefs.distance }) } },
    { metricId: 'count', occurrenceId: 'fleet-overview-drives', rawValue: data?.total_drives,
      label: t('analytics.hero.drives', 'Drives'), display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'fleet-overview-energy',
      rawValue: data?.total_energy_kwh != null ? data.total_energy_kwh * 1000 : null,
      label: t('analytics.hero.energy', 'Energy'), display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kWh' }) } },
    { metricId: 'efficiency', occurrenceId: 'fleet-overview-efficiency',
      rawValue: data?.avg_efficiency_wh_km != null ? data.avg_efficiency_wh_km / 1000 : null,
      label: t('analytics.hero.efficiency', 'Efficiency'),
      display: { formatter: raw => ({ value: fmtNumber(unitPrefs.distance === 'mi' ? raw * 1000 * 1.609344 : raw * 1000),
        unit: unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km' }) } },
    { metricId: 'currency', occurrenceId: 'fleet-overview-gas-savings', rawValue: gasSavings,
      label: t('analytics.hero.gasSavings', 'Gas savings'),
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) } },
    { metricId: 'mass', occurrenceId: 'fleet-overview-co2',
      rawValue: data?.total_distance_km != null ? data.total_distance_km * 0.12 : null,
      label: t('analytics.hero.co2Saved', 'CO₂ saved'), display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'kg' }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <OperationalBrief compact metrics={operationalMetrics} loading={isLoading && !data}
    eyebrow={t('analytics.title', 'Fleet analytics')}
    title={t('analytics.brief.overview', 'Fleet performance summary')}
    description={t('analytics.brief.overviewDescription', 'Returned fleet aggregates; gasoline savings and CO₂ saved retain the existing distance-based estimates.')}
    statusLabel={isLoading && !data ? t('analytics.brief.loading', 'Loading evidence')
      : !data ? t('analytics.brief.unavailable', 'Evidence unavailable')
        : retained ? t('analytics.brief.retained', 'Retained evidence') : t('analytics.brief.returned', 'Returned evidence')}
    statusTone={retained || !data ? 'warning' : 'neutral'}
    scope={<span>{scope}</span>}
    provenance={t('analytics.brief.coverage', 'Returned fleet aggregates for the selected range; continuous recording coverage is unknown.')}
  />;
}
