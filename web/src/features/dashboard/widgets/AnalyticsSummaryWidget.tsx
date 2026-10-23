import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useDataState } from '@/hooks/useDataState';
import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { isFiniteNumber } from '@/lib/numberFormat';
import { useRangeState } from '@/hooks/useRangeState';
import { EmptyState } from '@/components/feedback';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';

const METERS_PER_KM = 1000;
const KM_PER_MILE = 1.609344;

export function toAnalyticsDistanceDisplay(totalDistanceKm: number, distanceUnit: 'km' | 'mi'): number {
  return convertDistanceFromSI(totalDistanceKm * METERS_PER_KM, distanceUnit);
}

export default function AnalyticsSummaryWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  const { formatCurrency } = useFormatting();
  const { unitPrefs } = useUnits();
  const { startInstant, endInstantExclusive } = useRangeState({ defaultPresetId: '30d' });
  const query = useFleetAnalytics({ start: startInstant, end: endInstantExclusive });
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const dataState = useDataState(query, { provenance: 'historical' });
  const distanceUnit = unitPrefs.distance === 'mi' ? 'mi' : 'km';

  const distance =
    isFiniteNumber(data?.total_distance_km) ? toAnalyticsDistanceDisplay(data.total_distance_km, distanceUnit) : null;
  const energyWh =
    isFiniteNumber(data?.total_energy_kwh) ? data.total_energy_kwh * 1000 : null;
  const efficiencyWhKm =
    isFiniteNumber(data?.avg_efficiency_wh_km) ? data.avg_efficiency_wh_km : null;
  const efficiency =
    efficiencyWhKm == null
      ? null
      : distanceUnit === 'mi'
        ? efficiencyWhKm * KM_PER_MILE
        : efficiencyWhKm;
  const distanceMeters =
    isFiniteNumber(data?.total_distance_km) ? data.total_distance_km * METERS_PER_KM : null;
  const costPerDistance =
    isFiniteNumber(data?.total_cost) && distanceMeters != null && distanceMeters > 0
      ? data.total_cost / convertDistanceFromSI(distanceMeters, distanceUnit)
      : null;

  const stats: StatGridItem[] = [
    {
      label: t('widget.analyticsSummary.distance30d', 'Distance (30d)'),
      value: distance == null ? null : fmtNumber(distance, 0),
      unit: distanceUnit,
    },
    {
      label: t('widget.analyticsSummary.avgEfficiency', 'Avg efficiency'),
      value: efficiency == null ? null : fmtNumber(efficiency, 1),
      unit: distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km',
    },
    {
      label: t('widget.analyticsSummary.energyConsumed', 'Energy consumed'),
      value: energyWh == null ? null : fmtNumber(energyWh / 1000, 1),
      unit: 'kWh',
    },
    {
      label: t('widget.analyticsSummary.costPerDist30d', 'Cost / {{unit}}', { unit: distanceUnit }),
      value: costPerDistance == null ? null : formatCurrency(costPerDistance),
    },
  ];

  const retained = data != null;

  return (
    <WidgetShell
      title={t('widget.analyticsSummary.title', 'Analytics summary')}
      icon={<BarChart3 className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      dataState={retained || isLoading || dataState.fatalError ? dataState : undefined}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => { void refetch(); }}
    >
      {retained ? (
        <section aria-label={t('widget.analyticsSummary.summary.title', 'Fleet operating summary')} data-testid="analytics-summary">
          <WidgetStatGrid
            stats={stats}
            cols={size.cols >= 4 ? 4 : 2}
            maxPerRow={size.cols >= 4 ? 4 : 2}
          />
        </section>
      ) : (
        <EmptyState
          variant="informational"
          icon={<BarChart3 className="h-5 w-5" />}
          message={t('widget.analyticsSummary.noDataMessage', 'No analytics readings are available yet. They appear after the analytics source returns data.')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
