import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Calendar, Target, Route } from 'lucide-react';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useMileageStats } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

/** Round up to the next 10 000-mile milestone above current total. */
function nextMilestone(totalMi: number): number {
  const step = 10_000;
  return Math.ceil((totalMi + 1) / step) * step;
}

export default function MileageStatsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch, } = useMileageStats(id > 0 ? String(id) : '');

  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  const isCompact = size.cols <= 1;
  const hasData = !!data;
  // Only swap the whole widget for a full-panel error on the INITIAL load
  // failure, when there is no cached data to fall back on. Once data is on
  // screen, a transient background-refetch failure must not blank out
  // otherwise-valid numbers — it is surfaced through the freshness
  // indicator's error state instead (WidgetShell forwards `isError` to
  // <DataFreshness>).
  const blockingError = !hasData && error ? String(error) : null;

  // Backend `/mileage/stats` returns SI kilometres; multiply by 1000
  // so the SI-canonical `convertDistanceFromSI` (meters in) treats it
  // correctly. Daily-avg derives from the last_30d_km rolling window —
  // the legacy endpoint exposed `avgDaily` directly; the restored
  // endpoint exposes `last_30d_km`.
  const totalMeters = (data?.lifetime_km ?? 0) * 1000;
  const dailyAvgMeters = ((data?.last_30d_km ?? 0) / 30) * 1000;
  const totalDisplay = toDistanceDisplay(totalMeters);
  const dailyAvgDisplay = toDistanceDisplay(dailyAvgMeters);
  const milestone = nextMilestone(totalDisplay);
  const remaining = milestone - totalDisplay;
  const monthsToMilestone = dailyAvgDisplay > 0
    ? Math.max(1, Math.round(remaining / dailyAvgDisplay / 30))
    : 0;

  const stats = useMemo((): StatGridItem[] => {
    if (!data) return [];
    return [
      {
        label: t('widget.mileageStats.dailyAvg', 'Daily Avg'),
        value: fmtNumber(dailyAvgDisplay, 1),
        unit: distanceUnit,
        icon: <Route className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.mileageStats.weeklyAvg', 'Weekly Avg'),
        value: fmtNumber(dailyAvgDisplay * 7, 0),
        unit: distanceUnit,
        icon: <Calendar className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.mileageStats.monthlyAvg', 'Monthly Avg'),
        value: fmtNumber(dailyAvgDisplay * 30, 0),
        unit: distanceUnit,
        icon: <TrendingUp className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.mileageStats.nextMilestone', 'Next Milestone'),
        value: fmtInt(milestone),
        unit: distanceUnit,
        trend: 'up' as const,
        trendValue: monthsToMilestone > 0
          ? t('widget.mileageStats.inMonths', '~{{months}} mo', { months: monthsToMilestone })
          : '—',
        icon: <Target className="h-3.5 w-3.5" />,
      },
    ];
  }, [data, dailyAvgDisplay, distanceUnit, milestone, monthsToMilestone, t]);

  const shellProps = {
    loading: isLoading,
    error: blockingError,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // Compact: daily avg as large number
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        {hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5 min-h-[44px]">
            <AnimatedNumber
              value={dailyAvgDisplay}
              className="text-2xl font-bold text-[var(--text-primary)]"
            />
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
              {distanceUnit}/{t('widget.mileageStats.day', 'day')}
            </span>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<TrendingUp className="h-5 w-5" />}
            message={t('widget.mileageStats.noData', 'No mileage data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // Standard / Wide
  return (
    <WidgetShell
      title={t('widget.mileageStats.title', 'Mileage Stats')}
      icon={<TrendingUp className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      {hasData ? (
        <WidgetStatGrid stats={stats} cols={2} />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<TrendingUp className="h-5 w-5" />}
          message={t('widget.mileageStats.noData', 'No mileage data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
