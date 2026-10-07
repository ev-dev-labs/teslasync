import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy, Route, Zap, Car, Leaf, DollarSign, CalendarDays } from 'lucide-react';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useLifetimeStats } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

export default function LifetimeStatsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch, } = useLifetimeStats(id > 0 ? String(id) : undefined);

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
        label: t('widget.lifetimeStats.totalDistance', 'Total Distance'),
        value: fmtNumber(displayDistance, 0),
        unit: distanceUnit,
        icon: <Route className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.lifetimeStats.totalDrives', 'Total Drives'),
        value: fmtInt(data.total_drives ?? 0),
        icon: <Car className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.lifetimeStats.totalEnergy', 'Total Energy'),
        value: fmtNumber(data.total_energy_kwh ?? 0, 1),
        unit: 'kWh',
        icon: <Zap className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.lifetimeStats.co2Saved', 'CO₂ Saved'),
        value: fmtNumber(data.co2_offset_kg ?? 0, 0),
        unit: 'kg',
        icon: <Leaf className="h-3.5 w-3.5" />,
      },
    ];
  }, [data, displayDistance, distanceUnit, t]);

  const wideStats = useMemo((): StatGridItem[] => {
    if (!data) return [];

    const avgDailyMeters = data.ownership_days > 0
      ? distanceMeters / data.ownership_days
      : 0;
    const avgDailyDisplay = toDistanceDisplay(avgDailyMeters);

    return [
      {
        label: t('widget.lifetimeStats.totalCost', 'Total Cost'),
        value: formatCurrency(data.total_charging_cost ?? 0),
        icon: <DollarSign className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.lifetimeStats.ownershipDays', 'Ownership Days'),
        value: fmtInt(data.ownership_days ?? 0),
        icon: <CalendarDays className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.lifetimeStats.avgDailyDistance', 'Avg Daily Distance'),
        value: fmtNumber(avgDailyDisplay, 1),
        unit: distanceUnit,
        icon: <Route className="h-3.5 w-3.5" />,
      },
    ];
  }, [data, distanceMeters, toDistanceDisplay, distanceUnit, formatCurrency, t]);

  const allStats = useMemo(
    () => (isWide ? [...coreStats, ...wideStats] : coreStats),
    [isWide, coreStats, wideStats],
  );

  // Compact: single big number
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={isError && !data ? String(error ?? t('widget.lifetimeStats.error', 'Unable to load lifetime stats')) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {data ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5 min-h-[44px]">
            <AnimatedNumber
              value={displayDistance}
              className="text-2xl font-bold text-[var(--text-primary)]"
            />
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
              {distanceUnit} {t('widget.lifetimeStats.lifetime', 'lifetime')}
            </span>
          </div>
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
      title={t('widget.lifetimeStats.title', 'Lifetime Stats')}
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
