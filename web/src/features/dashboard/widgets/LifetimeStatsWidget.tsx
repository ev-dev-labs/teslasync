import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';
import { useDataState } from '@/hooks/useDataState';
import { EmptyState } from '@/components/feedback';
import { useLifetimeStats } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';

export default function LifetimeStatsWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const query = useLifetimeStats(id > 0 ? String(id) : undefined);
  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch, } = query;
  const dataState = useDataState(query, { provenance: 'historical' });

  const { unitPrefs } = useUnits();
  // convertDistanceFromSI expects SI meters and maps to the user's unit.
  const toDistanceDisplay = useCallback(
    (meters: number) => convertDistanceFromSI(meters, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const distanceUnit = unitPrefs.distance;
  const { formatCurrency } = useFormatting();

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // API returns kilometers; lift to SI meters before the display conversion.
  const distanceMeters = (data?.total_distance_km ?? 0) * 1000;
  const displayDistance = toDistanceDisplay(distanceMeters);

  const coreStats = useMemo((): StatMetric[] => {
    if (!data) return [];
    return [
      {
        metricId: 'distance',
        label: t('widget.lifetimeStats.totalDistance', 'Total distance'),
        rawValue: data.total_distance_km == null ? null : data.total_distance_km * 1000,
        description: t('widget.lifetimeStats.summary.distanceHelp', 'Source lifetime distance in kilometres, normalized to metres before display.'),
        display: { formatter: raw => ({ value: fmtNumber(toDistanceDisplay(raw)), unit: distanceUnit }) },
      },
      {
        metricId: 'count',
        label: t('widget.lifetimeStats.totalDrives', 'Total drives'),
        rawValue: data.total_drives,
        description: t('widget.lifetimeStats.summary.drivesHelp', 'Reported lifetime drive count for this vehicle.'),
      },
      {
        metricId: 'energy',
        label: t('widget.lifetimeStats.totalEnergy', 'Total energy'),
        rawValue: data.total_energy_kwh == null ? null : data.total_energy_kwh * 1000,
        description: t('widget.lifetimeStats.summary.energyHelp', 'Reported lifetime energy, normalized from kWh to Wh; original kWh display retained.'),
        display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kWh' }) },
      },
      {
        metricId: 'mass',
        label: t('widget.lifetimeStats.co2Saved', 'CO₂ saved'),
        rawValue: data.co2_offset_kg,
        description: t('widget.lifetimeStats.summary.carbonHelp', 'Source-reported lifetime CO₂ offset in kilograms.'),
        display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'kg' }) },
      },
    ];
  }, [data, toDistanceDisplay, distanceUnit, t, fmtNumber]);

  const wideStats = useMemo((): StatMetric[] => {
    if (!data) return [];

    const avgDailyMeters = data.ownership_days > 0
      ? distanceMeters / data.ownership_days
      : 0;
    return [
      {
        metricId: 'currency',
        label: t('widget.lifetimeStats.totalCost', 'Total cost'),
        rawValue: data.total_charging_cost,
        description: t('widget.lifetimeStats.summary.costHelp', 'Recorded lifetime charging cost in its original denomination; no currency conversion.'),
        display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
      },
      {
        metricId: 'count',
        label: t('widget.lifetimeStats.ownershipDays', 'Ownership days'),
        rawValue: data.ownership_days,
        description: t('widget.lifetimeStats.summary.daysHelp', 'Reported ownership-day count used as the daily-distance denominator.'),
      },
      {
        metricId: 'distance',
        label: t('widget.lifetimeStats.avgDailyDistance', 'Avg daily distance'),
        rawValue: isFiniteNumber(data.total_distance_km) && isFiniteNumber(data.ownership_days) && data.ownership_days > 0 ? avgDailyMeters : null,
        description: t('widget.lifetimeStats.summary.dailyHelp', 'Lifetime distance divided by positive measured ownership days; not a rolling 24-hour distance.'),
        display: { formatter: raw => ({ value: fmtNumber(toDistanceDisplay(raw)), unit: distanceUnit }) },
      },
    ];
  }, [data, distanceMeters, toDistanceDisplay, distanceUnit, formatCurrency, t, fmtNumber]);

  const allStats = useMemo(
    () => (isWide ? [...coreStats, ...wideStats] : coreStats),
    [isWide, coreStats, wideStats],
  );

  // Compact: single big number
  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.lifetimeStats.title', 'Lifetime stats')}
        dataState={data || isLoading || isError ? dataState : undefined}
        loading={isLoading}
        error={isError && !data ? String(error ?? t('widget.lifetimeStats.error', 'Unable to load lifetime stats')) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {data ? (
          <WidgetBigNumber
            value={isFiniteNumber(data.total_distance_km) ? fmtNumber(displayDistance) : null}
            subtitle={`${distanceUnit} ${t('widget.lifetimeStats.lifetime', 'lifetime')}`}
            align="center"
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Trophy className="h-5 w-5" />}
            message={t('widget.lifetimeStats.noData', 'No lifetime data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // Standard / Wide
  return (
    <WidgetShell
      dataState={data || isLoading || isError ? dataState : undefined}
      title={t('widget.lifetimeStats.title', 'Lifetime stats')}
      icon={<Trophy className="h-3.5 w-3.5 text-amber-400" />}
      loading={isLoading}
      error={isError && !data ? String(error ?? t('widget.lifetimeStats.error', 'Unable to load lifetime stats')) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {data ? (
        <DashboardSourceBrief
          metrics={allStats}
          state={dataState}
          eyebrow={t('widget.lifetimeStats.summary.eyebrow', 'Lifetime history')}
          title={t('widget.lifetimeStats.summary.title', 'Lifetime operating summary')}
          description={t('widget.lifetimeStats.summary.description', 'Lifetime totals for the resolved vehicle, not the workspace date range. Exact history coverage and first observation are not supplied.')}
          scope={t('widget.lifetimeStats.summary.scope', 'Vehicle {{id}} · lifetime', { id })}
          testId="lifetime-stats-operational-brief"
        />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Trophy className="h-5 w-5" />}
          message={t('widget.lifetimeStats.noData', 'No lifetime data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
