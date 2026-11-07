import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Bar, BarChart, CartesianGrid, ChartTooltip, EmbeddedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from '@/components/charts';
import { Caption } from '@/components/ui';
import { resolveVehicleStateFreshness, useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useDailyMileage } from '@/api/hooks/useAnalytics';
import { knownNumber } from '@/api/dataState';
import { useCombinedDataState, useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { civilDateInTimeZone } from '@/lib/dateRange';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';

import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
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
    const km = knownNumber(bucket.total_km);
    if (km == null || km < 0) continue;
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
  const pack = usePackPresentation();
  const isClassic = pack === 'classic';
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
  const odometerMeters = odometer != null && odometer >= 0 && hasVerifiedOdometer ? odometer : null;

  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const odometerDisplay = odometerMeters == null
    ? null
    : toOdometerDisplay(odometerMeters, distanceUnit);

  const trust = useDataState(
    {
      ...stateQuery,
      data: stateData ?? (!isLoading && !isError && !error ? null : undefined),
      dataUpdatedAt: observedAt ?? undefined,
    },
    { provenance: freshness === 'fresh' ? 'live' : 'cached', maxAgeMs: 120_000, unavailable: odometerMeters == null },
  );

  const dailyTrust = useDataState(dailyQuery, {
    provenance: 'historical',
    unavailable: dailyQuery.data?.length === 0,
  });
  const isCompact = size.cols === 1 && size.rows === 1;
  const combinedTrust = useCombinedDataState(isCompact ? [trust] : [trust, dailyTrust]);
  const shellTrust = isClassic ? trust : {
    ...trust,
    ...combinedTrust,
    data: isCompact ? trust.data : trust.data ?? dailyTrust.data,
    hasData: trust.hasData || (!isCompact && dailyTrust.hasData),
  };

  const { stats, periods } = useMemo(() => {
    const buckets = dailyQuery.data ?? [];
    const today = civilDateInTimeZone(new Date(), tz);
    const weekStart = weekStartCivil(today);
    const monthStart = `${today.slice(0, 7)}-01`;
    const yearStart = `${today.slice(0, 4)}-01-01`;

    const dayKm = sumDistanceBuckets(buckets, today, today);
    const weekKm = sumDistanceBuckets(buckets, weekStart, today);
    const monthKm = sumDistanceBuckets(buckets, monthStart, today);
    const yearKm = sumDistanceBuckets(buckets, yearStart, today);
    const elapsedMonthDays = Number(today.slice(8, 10));
    const perDayKm = monthKm != null && elapsedMonthDays > 0
      ? monthKm / elapsedMonthDays
      : null;

    const displayKm = (km: number | null) =>
      km == null ? null : convertDistanceFromSI(km * 1000, distanceUnit);

    const stats: StatGridItem[] = [
      { label: t('widget.odometer.thisWeek', 'This week'), value: weekKm == null ? null : fmtNumber(displayKm(weekKm), 0), unit: distanceUnit },
      { label: t('widget.odometer.thisMonth', 'This month'), value: monthKm == null ? null : fmtNumber(displayKm(monthKm), 0), unit: distanceUnit },
      { label: t('widget.odometer.thisYear', 'This year'), value: yearKm == null ? null : fmtNumber(displayKm(yearKm), 0), unit: distanceUnit },
      { label: t('widget.odometer.perDay', 'Per day'), value: perDayKm == null ? null : fmtNumber(displayKm(perDayKm), 0), unit: distanceUnit },
    ];
    return {
      stats,
      periods: [
        { period: t('dashboardWidgets.vehicle.odometer.day', 'Day'), distance: displayKm(dayKm) },
        { period: t('dashboardWidgets.vehicle.odometer.week', 'Week'), distance: displayKm(weekKm) },
        { period: t('dashboardWidgets.vehicle.odometer.month', 'Month'), distance: displayKm(monthKm) },
      ],
    };
  }, [dailyQuery.data, distanceUnit, fmtNumber, t, tz]);

  const headline = trust.fatalError ? (
    <QueryError error={trust.fatalError} onRetry={trust.retry ?? undefined} />
  ) : isLoading && !stateData ? (
    <Skeleton className="h-24 rounded-xl" />
  ) : odometerDisplay != null ? (
    <WidgetBigNumber value={fmtNumber(odometerDisplay, 0)} unit={distanceUnit}
      label={t('widget.odometer.total', 'Total odometer')} animated decimals={0}
      badge={{ text: t('dashboardWidgets.vehicle.odometer.lifetime', 'Lifetime'), variant: 'neutral' }} />
  ) : (
    <EmptyState variant="informational" icon={<Gauge className="h-6 w-6" />}
      message={t('widget.odometer.noData', 'No odometer data')} className="py-4" />
  );
  const overlapNote = t('dashboardWidgets.vehicle.odometer.periodOverlap', 'Periods overlap and are shown separately.');
  const breakdown = !isCompact && (
    <div className="min-w-0 space-y-3">
      <StaleRefreshWarning state={dailyTrust} hideRetry />
      <EmbeddedChart
        title={t('dashboardWidgets.vehicle.odometer.comparison', 'Distance by period')}
        ariaLabel={t('dashboardWidgets.vehicle.odometer.comparison', 'Distance by period')}
        ariaDescription={overlapNote}
        height={156}
        toolbar={false}
        loading={dailyQuery.isLoading && !dailyTrust.hasData}
        error={dailyTrust.fatalError}
        onRetry={dailyTrust.retry ?? undefined}
        empty={periods.every(period => period.distance == null)}
        emptyMessage={t('dashboardWidgets.vehicle.odometer.noDistance', 'No measured distance for these periods')}
        data={periods}
        dataColumns={[
          { key: 'period', label: t('dashboardWidgets.vehicle.odometer.period', 'Period') },
          { key: 'distance', label: distanceUnit, format: value => value == null ? '—' : fmtNumber(value, 0) },
        ]}
        metadata={{
          unitLabel: distanceUnit,
          rangeLabel: t('dashboardWidgets.vehicle.odometer.calendarScope', 'Calendar periods in {{timezone}}', { timezone: tz }),
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={periods} accessibilityLayer margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
            <XAxis dataKey="period" axisLine={false} tickLine={false} interval={0}
              tick={{ fill: 'var(--text-secondary)' }} />
            <YAxis domain={[0, 'auto']} axisLine={false} tickLine={false} width={48}
              tick={{ fill: 'var(--text-secondary)' }} tickFormatter={value => fmtNumber(value, 0)} />
            <Tooltip content={<ChartTooltip valueFormatter={value =>
              value == null ? '—' : `${fmtNumber(value, 0)} ${distanceUnit}`} />} />
            <Bar dataKey="distance" name={t('widget.distance', 'Distance')} fill="var(--theme-primary)"
              radius={pack === 'v3' || pack === 'v7' ? 0 : 4} isAnimationActive={false}
              label={{ position: 'top', fill: 'var(--text-secondary)', formatter: (value: unknown) =>
                value == null ? '—' : fmtNumber(value, 0) }} />
          </BarChart>
        </ResponsiveContainer>
      </EmbeddedChart>
      <Caption as="p">{overlapNote}</Caption>
    </div>
  );
  const details = !isCompact && (
    <WidgetStatGrid stats={stats} cols={2} maxPerRow={2} />
  );

  return (
    <WidgetShell
      title={t('widget.odometer.title', 'Odometer')}
      icon={isCompact ? undefined : <Gauge className="h-3.5 w-3.5 text-theme-accent" />}
      loading={isLoading}
      dataState={!isClassic || stateData != null || isLoading || isError || error ? shellTrust : undefined}
      updatedAt={observedAt ?? 0}
      isFetching={isFetching || dailyQuery.isFetching}
      isStale={isStale || dailyQuery.isStale || freshness === 'stale'}
      isError={isError || dailyQuery.isError}
      onRefresh={() => {
        void refetch();
        void dailyQuery.refetch();
      }}
    >
      <InstrumentPresentation family="bars" compact={isCompact} headline={headline}
        icon={<Gauge />} instrument={breakdown} details={details}>
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
            variant="informational"
            icon={<Gauge className="h-6 w-6" />}
            message={t('widget.odometer.noData', 'No odometer data')}
            className="py-4"
          />
        )}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
