import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar, Route, Car, Zap, Leaf, TrendingUp, Timer, Star,
} from 'lucide-react';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useYearReview } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// The year-review endpoint emits distances in kilometres and speeds in km/h
// (server-side derivations of the SI columns). The SI-canonical converters
// expect metres / metres-per-second, so lift the API values back to SI before
// converting to the user's display unit.
const METERS_PER_KM = 1000;
const KMH_PER_MPS = 3.6; // 1 m/s === 3.6 km/h

export default function YearReviewWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const currentYear = new Date().getFullYear();
  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch, } = useYearReview(currentYear, id > 0 ? String(id) : undefined);

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
    return MONTH_NAMES[(best.month - 1) % 12] ?? '—';
  }, [data?.monthly_stats]);

  const coreStats = useMemo((): StatGridItem[] => {
    if (!data) return [];
    return [
      {
        label: t('widget.yearReview.totalDistance', 'Total Miles'),
        value: fmtNumber(displayDistance, 0),
        unit: distanceUnit,
        icon: <Route className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.yearReview.totalDrives', 'Total Drives'),
        value: fmtInt(data.total_drives ?? 0),
        icon: <Car className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.yearReview.energyUsed', 'Energy Used'),
        value: fmtNumber(data.total_energy_kwh ?? 0, 1),
        unit: 'kWh',
        icon: <Zap className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.yearReview.co2Saved', 'CO₂ Saved'),
        value: fmtNumber(data.co2_offset_kg ?? 0, 0),
        unit: 'kg',
        icon: <Leaf className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.yearReview.busiestMonth', 'Best Month'),
        value: busiestMonth,
        icon: <Star className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.yearReview.longestDrive', 'Longest Drive'),
        value: fmtNumber(displayLongestDrive, 1),
        unit: distanceUnit,
        icon: <TrendingUp className="h-3.5 w-3.5" />,
      },
    ];
  }, [data, displayDistance, displayLongestDrive, distanceUnit, busiestMonth, t]);

  const wideStats = useMemo((): StatGridItem[] => {
    if (!data) return [];
    return [
      {
        label: t('widget.yearReview.drivingTime', 'Driving Time'),
        value: fmtInt(Math.round((data.total_driving_minutes ?? 0) / 60)),
        unit: 'h',
        icon: <Timer className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.yearReview.topSpeed', 'Top Speed'),
        value: fmtNumber(displayFastestSpeed, 0),
        unit: speedUnit,
        icon: <TrendingUp className="h-3.5 w-3.5" />,
      },
    ];
  }, [data, displayFastestSpeed, speedUnit, t]);

  const allStats = useMemo(
    () => (isWide ? [...coreStats, ...wideStats] : coreStats),
    [isWide, coreStats, wideStats],
  );

  // Compact: single big number
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        {data ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5 min-h-[44px]">
            <AnimatedNumber
              value={displayDistance}
              className="text-2xl font-bold text-[var(--text-primary)]"
            />
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
              {distanceUnit} {t('widget.yearReview.inYear', 'in {year}').replace('{year}', String(currentYear))}
            </span>
          </div>
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
      title={t('widget.yearReview.title', 'Year in Review') + ` ${currentYear}`}
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
