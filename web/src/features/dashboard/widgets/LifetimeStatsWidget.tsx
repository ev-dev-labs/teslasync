import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy, Route, Zap, Car, Leaf, DollarSign, CalendarDays } from 'lucide-react';
import { useDataState } from '@/hooks/useDataState';
import { EmptyState } from '@/components/feedback';
import { useLifetimeStats } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';

export default function LifetimeStatsWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
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

  const coreStats = useMemo((): StatGridItem[] => {
    if (!data) return [];
    return [
      {
        label: t('widget.lifetimeStats.totalDistance', 'Total distance'),
        value: isFiniteNumber(data.total_distance_km) ? fmtNumber(displayDistance) : null,
        unit: distanceUnit,
        icon: <Route className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.lifetimeStats.totalDrives', 'Total drives'),
        value: isFiniteNumber(data.total_drives) ? fmtInt(data.total_drives) : null,
        icon: <Car className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.lifetimeStats.totalEnergy', 'Total energy'),
        value: isFiniteNumber(data.total_energy_kwh) ? fmtNumber(data.total_energy_kwh) : null,
        unit: 'kWh',
        icon: <Zap className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.lifetimeStats.co2Saved', 'CO₂ saved'),
        value: isFiniteNumber(data.co2_offset_kg) ? fmtNumber(data.co2_offset_kg) : null,
        unit: 'kg',
        icon: <Leaf className="h-3.5 w-3.5" />,
      },
    ];
  }, [data, displayDistance, distanceUnit, t, fmtNumber, fmtInt]);

  const wideStats = useMemo((): StatGridItem[] => {
    if (!data) return [];

    const avgDailyMeters = data.ownership_days > 0
      ? distanceMeters / data.ownership_days
      : 0;
    const avgDailyDisplay = toDistanceDisplay(avgDailyMeters);

    return [
      {
        label: t('widget.lifetimeStats.totalCost', 'Total cost'),
        value: isFiniteNumber(data.total_charging_cost) ? formatCurrency(data.total_charging_cost) : null,
        icon: <DollarSign className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.lifetimeStats.ownershipDays', 'Ownership days'),
        value: isFiniteNumber(data.ownership_days) ? fmtInt(data.ownership_days) : null,
        icon: <CalendarDays className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.lifetimeStats.avgDailyDistance', 'Avg daily distance'),
        value: isFiniteNumber(data.total_distance_km) && data.ownership_days > 0 ? fmtNumber(avgDailyDisplay) : null,
        unit: distanceUnit,
        icon: <Route className="h-3.5 w-3.5" />,
      },
    ];
  }, [data, distanceMeters, toDistanceDisplay, distanceUnit, formatCurrency, t, fmtInt, fmtNumber]);

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
        <WidgetStatGrid stats={allStats} cols={isWide ? 4 : 2} />
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
