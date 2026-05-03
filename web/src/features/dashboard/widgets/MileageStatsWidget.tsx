import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Calendar, Target, Route } from 'lucide-react';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useMileageStats } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';

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
    data, isLoading, error,
    isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = useMileageStats(id > 0 ? String(id) : '');

  const { convertDistance, distanceUnit } = useSettings();

  const isCompact = size.cols <= 1;

  const dailyAvgMi = data?.avgDaily ?? 0;
  const totalMi = data?.totalDistance ?? 0;
  const milestone = nextMilestone(totalMi);
  const remainingMi = milestone - totalMi;
  const monthsToMilestone = dailyAvgMi > 0
    ? Math.max(1, Math.round(remainingMi / dailyAvgMi / 30))
    : 0;

  const stats = useMemo((): StatGridItem[] => {
    if (!data) return [];
    return [
      {
        label: t('widget.mileageStats.dailyAvg', 'Daily Avg'),
        value: fmtNumber(convertDistance(dailyAvgMi), 1),
        unit: distanceUnit,
        icon: <Route className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.mileageStats.weeklyAvg', 'Weekly Avg'),
        value: fmtNumber(convertDistance(dailyAvgMi * 7), 0),
        unit: distanceUnit,
        icon: <Calendar className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.mileageStats.monthlyAvg', 'Monthly Avg'),
        value: fmtNumber(convertDistance(dailyAvgMi * 30), 0),
        unit: distanceUnit,
        icon: <TrendingUp className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.mileageStats.nextMilestone', 'Next Milestone'),
        value: fmtInt(convertDistance(milestone)),
        unit: distanceUnit,
        trend: 'up' as const,
        trendValue: monthsToMilestone > 0
          ? t('widget.mileageStats.inMonths', '~{{months}} mo', { months: monthsToMilestone })
          : '—',
        icon: <Target className="h-3.5 w-3.5" />,
      },
    ];
  }, [data, dailyAvgMi, convertDistance, distanceUnit, milestone, monthsToMilestone, t]);

  // Compact: daily avg as large number
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
              value={convertDistance(dailyAvgMi)}
              className="text-2xl font-bold text-[var(--text-primary)]"
            />
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
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
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {data ? (
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
