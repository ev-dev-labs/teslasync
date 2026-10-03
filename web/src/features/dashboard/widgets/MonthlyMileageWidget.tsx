import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartTooltip, EmbeddedChart } from '@/components/charts';
import { useMonthlyMileage } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';

import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface BarDatum {
  month: string;
  distance: number | null;
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
  const { fmtNumber: fmt } = useNumberFormatting();
  const { fmtInt, fmtNumber } = useNumberFormatting();
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

  const query = useMonthlyMileage(vid > 0 ? String(vid) : '');
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const trust = useDataState({ ...query, data: data ?? undefined }, { provenance: 'historical' });

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
      distance: knownNumber(m.total_km) == null ? null : toDistanceDisplay(m.total_km * 1000),
      isCurrent: (m.year_month ?? '') === curMonth,
    }));
  }, [data, toDistanceDisplay, curMonth]);

  const totalDistance = useMemo(
    () => chartData.length > 0 && chartData.every(d => d.distance != null)
      ? chartData.reduce((sum, d) => sum + (d.distance ?? 0), 0)
      : null,
    [chartData],
  );

  const currentMonthDistance = useMemo(() => {
    const cur = chartData.find((d) => d.isCurrent);
    return cur?.distance ?? null;
  }, [chartData]);
  const chartTableData = useMemo(
    () => chartData.map(({ month, distance }) => ({ month, distance })),
    [chartData],
  );

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0;

  // Summary stats are identical in the compact and standard layouts, so they
  // are derived once and reused (single source of truth + stable reference).
  const summaryStats = useMemo<ChartSummaryStat[]>(
    () =>
      hasData
        ? [
            {
              label: t('widget.monthlyMileage.thisMonth', 'This month'),
              value: currentMonthDistance == null ? null : fmtInt(currentMonthDistance),
              unit: distanceUnit,
            },
            {
              label: t('widget.monthlyMileage.total12m', '12-month total'),
              value: totalDistance == null ? null : fmtInt(totalDistance),
              unit: distanceUnit,
            },
          ]
        : [],
    [hasData, currentMonthDistance, totalDistance, distanceUnit, t, fmtInt],
  );

  const dataState = data != null || isLoading || isError || error ? trust : undefined;

  // ── Compact (1-col): summary stats only ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        dataState={dataState}
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
      title={t('widget.monthlyMileage.title', 'Monthly mileage')}
      icon={<BarChart3 className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={dataState}
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
          <EmbeddedChart
            title={t('widget.monthlyMileage.title', 'Monthly mileage')}
            ariaLabel={t(
              'widget.monthlyMileage.chartAria',
              'Distance driven by month',
            )}
            data={chartTableData}
            dataColumns={[
              { key: 'month', label: t('widget.monthlyMileage.month', 'Month') },
              {
                key: 'distance',
                label: `${t('widget.monthlyMileage.distance', 'Distance')} (${distanceUnit})`,
              },
            ]}
          >
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
                tickFormatter={(v: number) => fmt(v)}
              />
              <Tooltip
                content={<ChartTooltip />}
                formatter={(value: number) => [
                  `${fmtNumber(value)} ${distanceUnit}`,
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
          </EmbeddedChart>
        }
      />
    </WidgetShell>
  );
}
