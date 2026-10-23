import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { resolveVehicleStateFreshness, useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useDailyMileage } from '@/api/hooks/useAnalytics';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { civilDateInTimeZone } from '@/lib/dateRange';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';

/** SI metres to the user's display distance unit. */
export function toOdometerDisplay(odometerMeters: number, to: DistanceUnitPref): number {
  if (!Number.isFinite(odometerMeters)) return 0;
  return convertDistanceFromSI(odometerMeters, to);
}

/** Compatibility bridge for callers of the former total-driven helper. */
export function toTotalDrivenDisplay(totalDistanceKm: number, to: DistanceUnitPref): number {
  if (!Number.isFinite(totalDistanceKm)) return 0;
  return convertDistanceFromSI(totalDistanceKm * 1000, to);
}

export interface DailyDistanceBucket {
  date: string;
  total_km: number;
}

/** Sum measured daily buckets within an inclusive civil-date window. */
export function sumDistanceBuckets(
  buckets: DailyDistanceBucket[],
  startDate: string,
  endDate: string,
): number | null {
  let total: number | null = null;
  for (const bucket of buckets) {
    if (!bucket.date || bucket.date < startDate || bucket.date > endDate) continue;
    const km = Number(bucket.total_km);
    if (!Number.isFinite(km) || km < 0) continue;
    total = (total ?? 0) + km;
  }
  return total;
}

function weekStartCivil(today: string): string {
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start.toISOString().slice(0, 10);
}

export default function OdometerCounterWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { tz } = useDateFormat();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const idStr = id > 0 ? String(id) : '';

  const stateQuery = useVehicleState(id);
  const dailyQuery = useDailyMileage(idStr, 366);
  const {
    data: stateData,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    refetch,
  } = stateQuery;

  const observedAt = stateData?.observedAt ?? null;
  const freshness = resolveVehicleStateFreshness(stateData?.freshness, observedAt);
  const odometer = knownNumber(stateData?.state?.odometer);
  const hasVerifiedOdometer =
    stateData?.verifiedFields?.includes('odometer') === true ||
    stateData?.freshness === 'fresh';
  const odometerMeters = odometer != null && hasVerifiedOdometer ? odometer : null;

  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const odometerDisplay = odometerMeters == null
    ? null
    : toOdometerDisplay(odometerMeters, distanceUnit);

  const trust = useDataState(
    { ...stateQuery, data: stateData ?? undefined, dataUpdatedAt: observedAt ?? undefined },
    { provenance: freshness === 'fresh' ? 'live' : 'cached', maxAgeMs: 120_000, unavailable: odometerMeters == null },
  );

  const stats = useMemo((): StatGridItem[] => {
    const buckets = dailyQuery.data ?? [];
    const today = civilDateInTimeZone(new Date(), tz);
    const weekStart = weekStartCivil(today);
    const monthStart = `${today.slice(0, 7)}-01`;
    const yearStart = `${today.slice(0, 4)}-01-01`;

    const weekKm = sumDistanceBuckets(buckets, weekStart, today);
    const monthKm = sumDistanceBuckets(buckets, monthStart, today);
    const yearKm = sumDistanceBuckets(buckets, yearStart, today);
    const elapsedMonthDays = Number(today.slice(8, 10));
    const perDayKm = monthKm != null && elapsedMonthDays > 0
      ? monthKm / elapsedMonthDays
      : null;

    const displayKm = (km: number | null) =>
      km == null ? null : convertDistanceFromSI(km * 1000, distanceUnit);

    return [
      { label: t('widget.odometer.thisWeek', 'This week'), value: weekKm == null ? null : fmtNumber(displayKm(weekKm), 0), unit: distanceUnit },
      { label: t('widget.odometer.thisMonth', 'This month'), value: monthKm == null ? null : fmtNumber(displayKm(monthKm), 0), unit: distanceUnit },
      { label: t('widget.odometer.thisYear', 'This year'), value: yearKm == null ? null : fmtNumber(displayKm(yearKm), 0), unit: distanceUnit },
      { label: t('widget.odometer.perDay', 'Per day'), value: perDayKm == null ? null : fmtNumber(displayKm(perDayKm), 0), unit: distanceUnit },
    ];
  }, [dailyQuery.data, distanceUnit, fmtNumber, t, tz]);

  const isCompact = size.cols === 1 && size.rows === 1;

  return (
    <WidgetShell
      title={t('widget.odometer.title', 'Odometer')}
      icon={isCompact ? undefined : <Gauge className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={stateData != null || isLoading || isError || error ? trust : undefined}
      updatedAt={observedAt ?? 0}
      isFetching={isFetching || dailyQuery.isFetching}
      isStale={isStale || dailyQuery.isStale || freshness === 'stale'}
      isError={isError || dailyQuery.isError}
      onRefresh={() => {
        void refetch();
        void dailyQuery.refetch();
      }}
    >
      {trust.fatalError ? (
        <QueryError error={trust.fatalError} onRetry={trust.retry ?? undefined} />
      ) : isLoading && !stateData ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : odometerDisplay != null ? (
        <div className="flex h-full min-w-0 flex-col gap-3">
          <WidgetBigNumber
            value={fmtNumber(odometerDisplay, 0)}
            unit={distanceUnit}
            animated
            decimals={0}
          />
          {!isCompact && (
            <WidgetStatGrid
              stats={stats}
              cols={2}
              maxPerRow={2}
            />
          )}
        </div>
      ) : (
        <EmptyState
          icon={<Gauge className="h-6 w-6" />}
          message={t('widget.odometer.noData', 'No odometer data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
