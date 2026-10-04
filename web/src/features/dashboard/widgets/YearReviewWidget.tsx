import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar, Route, Car, Zap, Leaf, TrendingUp, Timer, Star,
} from 'lucide-react';
import { useDataState } from '@/hooks/useDataState';
import { EmptyState } from '@/components/feedback';
import { useYearReview } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';

// The year-review endpoint emits distances in kilometres and speeds in km/h
// (server-side derivations of the SI columns). The SI-canonical converters
// expect metres / metres-per-second, so lift the API values back to SI before
// converting to the user's display unit.
const METERS_PER_KM = 1000;
const KMH_PER_MPS = 3.6; // 1 m/s === 3.6 km/h

export default function YearReviewWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt, locale } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const currentYear = new Date().getFullYear();
  const query = useYearReview(currentYear, id > 0 ? String(id) : undefined);
  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch, } = query;
  const dataState = useDataState(query, { provenance: 'historical' });

  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Lift the API's km / km/h back to SI (m, m/s), then convert to the user's
  // display unit. Feeding km straight into convertDistanceFromSI (which
  // expects metres) previously under-reported every figure by ~1000×.
  const displayDistance = toDistanceDisplay((data?.total_distance_km ?? 0) * METERS_PER_KM);
  const displayLongestDrive = toDistanceDisplay((data?.longest_drive?.distance_km ?? 0) * METERS_PER_KM);
  const displayFastestSpeed = toSpeedDisplay((data?.fastest_speed_kmh ?? 0) / KMH_PER_MPS);

  // Find busiest month
  const busiestMonth = useMemo(() => {
    const stats = data?.monthly_stats ?? [];
    if (stats.length === 0) return '—';
    const best = stats.reduce((a, b) => (b.drives > a.drives ? b : a), stats[0]);
    if (!Number.isInteger(best.month) || best.month < 1 || best.month > 12) return '—';
    return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(currentYear, best.month - 1, 1)));
  }, [data?.monthly_stats, locale, currentYear]);

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
        label: t('widget.yearReview.totalDrives', 'Total drives'),
        value: isFiniteNumber(data.total_drives) ? fmtInt(data.total_drives) : null,
        icon: <Car className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.yearReview.energyUsed', 'Energy used'),
        value: isFiniteNumber(data.total_energy_kwh) ? fmtNumber(data.total_energy_kwh) : null,
        unit: 'kWh',
        icon: <Zap className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.yearReview.co2Saved', 'CO₂ saved'),
        value: isFiniteNumber(data.co2_offset_kg) ? fmtNumber(data.co2_offset_kg) : null,
        unit: 'kg',
        icon: <Leaf className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.yearReview.busiestMonth', 'Best month'),
        value: busiestMonth,
        icon: <Star className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.yearReview.longestDrive', 'Longest drive'),
        value: isFiniteNumber(data.longest_drive?.distance_km) ? fmtNumber(displayLongestDrive) : null,
        unit: distanceUnit,
        icon: <TrendingUp className="h-3.5 w-3.5" />,
      },
    ];
  }, [data, displayDistance, displayLongestDrive, distanceUnit, busiestMonth, t, fmtNumber, fmtInt]);

  const wideStats = useMemo((): StatGridItem[] => {
    if (!data) return [];
    return [
      {
        label: t('widget.yearReview.drivingTime', 'Driving time'),
        value: isFiniteNumber(data.total_driving_minutes) ? fmtNumber(data.total_driving_minutes / 60) : null,
        unit: 'h',
        icon: <Timer className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.yearReview.topSpeed', 'Top speed'),
        value: isFiniteNumber(data.fastest_speed_kmh) ? fmtNumber(displayFastestSpeed) : null,
        unit: speedUnit,
        icon: <TrendingUp className="h-3.5 w-3.5" />,
      },
    ];
  }, [data, displayFastestSpeed, speedUnit, t, fmtNumber]);

  const allStats = useMemo(
    () => (isWide ? [...coreStats, ...wideStats] : coreStats),
    [isWide, coreStats, wideStats],
  );

  // Compact: single big number
  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.yearReview.title', 'Year in review') + ` ${currentYear}`}
        dataState={data || isLoading || isError ? dataState : undefined}
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        {data ? (
          <WidgetBigNumber
            value={isFiniteNumber(data.total_distance_km) ? fmtNumber(displayDistance) : null}
            subtitle={`${distanceUnit} ${t('widget.yearReview.inYear', 'in {year}').replace('{year}', String(currentYear))}`}
            align="center"
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Calendar className="h-5 w-5" />}
            message={t('widget.yearReview.noData', 'No year-in-review data')}
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
      title={t('widget.yearReview.title', 'Year in review') + ` ${currentYear}`}
      icon={<Calendar className="h-3.5 w-3.5 text-violet-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {data ? (
        <WidgetStatGrid stats={allStats} cols={isWide ? 4 : 2} />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Calendar className="h-5 w-5" />}
          message={t('widget.yearReview.noData', 'No year-in-review data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
