import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
} from '@/components/charts';
import { useMonthlyMileage } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

interface BarDatum {
  month: string;
  distance: number;
  isCurrent: boolean;
}

/** Format "2026-04" → "Apr". Non-'YYYY-MM' or out-of-range input is returned unchanged. */
export function shortMonth(iso: string): string {
  const parts = iso.split('-');
  if (parts.length < 2) return iso;
  const idx = parseInt(parts[1], 10) - 1;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[idx] ?? iso;
}

/** Current calendar month as a 'YYYY-MM' key, in the host's local time. */
export function currentMonthKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export default function MonthlyMileageWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  // convertDistanceFromSI expects SI meters and maps to the user's unit.
  // Memoised so the chartData derive only recomputes when the source data or
  // the distance preference actually changes.
  const toDistanceDisplay = useCallback(
    (meters: number) => convertDistanceFromSI(meters, distanceUnit),
    [distanceUnit],
  );

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useMonthlyMileage(vid > 0 ? String(vid) : '');

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const curMonth = currentMonthKey();

  const chartData = useMemo<BarDatum[]>(() => {
    const items = data ?? [];
    return items.slice(-12).map((m) => ({
      // Backend `/mileage/monthly` returns `year_month` ('YYYY-MM') and
      // `total_km`. SI-canonical convertDistanceFromSI expects meters.
      month: shortMonth(m.year_month ?? ''),
      distance: toDistanceDisplay((m.total_km ?? 0) * 1000),
      isCurrent: (m.year_month ?? '') === curMonth,
    }));
  }, [data, toDistanceDisplay, curMonth]);

  const totalDistance = useMemo(
    () => chartData.reduce((sum, d) => sum + d.distance, 0),
    [chartData],
  );

  const currentMonthDistance = useMemo(() => {
    const cur = chartData.find((d) => d.isCurrent);
    return cur?.distance ?? 0;
  }, [chartData]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0 && chartData.some((d) => d.distance > 0);

  // Summary stats are identical in the compact and standard layouts, so they
  // are derived once and reused (single source of truth + stable reference).
  const summaryStats = useMemo<ChartSummaryStat[]>(
    () =>
      hasData
        ? [
            {
              label: t('widget.monthlyMileage.thisMonth', 'This Month'),
              value: fmtInt(currentMonthDistance),
              unit: distanceUnit,
            },
            {
              label: t('widget.monthlyMileage.total12m', '12-Mo Total'),
              value: fmtInt(totalDistance),
              unit: distanceUnit,
            },
          ]
        : [],
    [hasData, currentMonthDistance, totalDistance, distanceUnit, t],
  );

  // Only surface a full error panel on a genuine initial-load failure (no data
  // yet). A background-refetch error that still has cached data must keep the
  // chart on screen — the freshness indicator conveys the stale/error state.
  const shellError =
    isError && !data
      ? String(error ?? t('widget.monthlyMileage.error', 'Unable to load mileage data'))
      : null;

  // ── Compact (1-col): summary stats only ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={shellError}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.monthlyMileage.noData', 'No mileage data')}
          emptyIcon={<BarChart3 className="h-5 w-5" />}
          stats={summaryStats}
          chart={null}
        />
      </WidgetShell>
    );
  }

  // ── Standard (2×4+): stat header + bar chart ──
  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      title={t('widget.monthlyMileage.title', 'Monthly Mileage')}
      icon={<BarChart3 className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={shellError}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.monthlyMileage.noData', 'No mileage data')}
        emptyIcon={<BarChart3 className="h-5 w-5" />}
        stats={summaryStats}
        chart={
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="month"
                tick={tick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => fmt(v, 0)}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(0,0,0,0.85)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number) => [
                  `${fmtNumber(value, 1)} ${distanceUnit}`,
                  t('widget.monthlyMileage.distance', 'Distance'),
                ]}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <Bar
                dataKey="distance"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
                name={t('widget.monthlyMileage.distance', 'Distance')}
              >
                {chartData.map((entry, idx) => (
                  <Cell
                    key={`bar-${idx}`}
                    fill={entry.isCurrent ? '#22d3ee' : 'rgba(255,255,255,0.1)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        }
      />
    </WidgetShell>
  );
}
