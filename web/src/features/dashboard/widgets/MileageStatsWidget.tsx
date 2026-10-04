import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Calendar, Target, Route } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useMileageStats } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/** Next 10 000-display-unit milestone, strictly above the current total. */
function nextMilestone(total: number): number {
  const step = 10_000;
  return (Math.floor(total / step) + 1) * step;
}

export default function MileageStatsWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const query = useMileageStats(id > 0 ? String(id) : '');
  const { data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const trust = useDataState({ ...query, data: data ?? undefined }, { provenance: 'historical' });

  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  const isCompact = size.cols <= 1;
  const hasData = !!data;
  // Backend `/mileage/stats` returns SI kilometres; multiply by 1000
  // so the SI-canonical `convertDistanceFromSI` (meters in) treats it
  // correctly. Daily-avg derives from the last_30d_km rolling window —
  // the legacy endpoint exposed `avgDaily` directly; the restored
  // endpoint exposes `last_30d_km`.
  const lifetime = knownNumber(data?.lifetime_km);
  const monthly = knownNumber(data?.last_30d_km);
  const totalDisplay = lifetime == null ? null : toDistanceDisplay(lifetime * 1000);
  const dailyAvgDisplay = monthly == null ? null : toDistanceDisplay(monthly / 30 * 1000);
  const milestone = totalDisplay == null ? null : nextMilestone(totalDisplay);
  const remaining = milestone != null && totalDisplay != null ? milestone - totalDisplay : null;
  const monthsToMilestone = dailyAvgDisplay != null && dailyAvgDisplay > 0 && remaining != null
    ? Math.max(1, Math.round(remaining / dailyAvgDisplay / 30))
    : 0;

  const stats = useMemo((): StatGridItem[] => {
    if (!data) return [];
    return [
      {
        label: t('widget.mileageStats.dailyAvg', 'Daily avg'),
        value: dailyAvgDisplay == null ? null : fmtNumber(dailyAvgDisplay),
        unit: distanceUnit,
        icon: <Route className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.mileageStats.weeklyAvg', 'Weekly avg'),
        value: dailyAvgDisplay == null ? null : fmtNumber(dailyAvgDisplay * 7),
        unit: distanceUnit,
        icon: <Calendar className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.mileageStats.monthlyAvg', 'Monthly avg'),
        value: dailyAvgDisplay == null ? null : fmtNumber(dailyAvgDisplay * 30),
        unit: distanceUnit,
        icon: <TrendingUp className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.mileageStats.nextMilestone', 'Next milestone'),
        value: milestone == null ? null : fmtNumber(milestone),
        unit: distanceUnit,
        trend: 'up' as const,
        trendValue: monthsToMilestone > 0
          ? t('widget.mileageStats.inMonths', '~{{months}} mo', { months: monthsToMilestone })
          : '—',
        icon: <Target className="h-3.5 w-3.5" />,
      },
    ];
  }, [data, dailyAvgDisplay, distanceUnit, milestone, monthsToMilestone, t, fmtNumber]);

  const shellProps = {
    title: t('widget.mileageStats.title', 'Mileage stats'),
    loading: isLoading,
    dataState: data != null || isLoading || isError || error ? trust : undefined,
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
          <WidgetBigNumber value={dailyAvgDisplay == null ? null : fmtNumber(dailyAvgDisplay)} unit={`${distanceUnit}/${t('widget.mileageStats.day', 'day')}`} />
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
