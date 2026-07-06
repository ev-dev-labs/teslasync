import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer,
  Tooltip, ReferenceLine,
  chartGrid, axisTick, axisTickSm, chartAnimation, fmt, useThemeChartPalette,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import type { WidgetProps } from './types';
import type { Drive } from '@/api/types';

/**
 * Colour for the rolling-average series (amber). Shared by the reference
 * line, the rolling-average area stroke, and the legend swatch so the three
 * stay in lockstep if the accent ever changes.
 */
const ROLLING_AVG_COLOR = '#f59e0b';

export interface DailyEfficiency {
  date: string;
  label: string;
  efficiency: number;
  rollingAvg: number | null;
}

/** Estimate Wh/km for a single drive from energy + distance data. */
export function estimateEfficiency(d: Drive): number | null {
  const distanceKm = convertDistanceFromSI(d.distance_m ?? 0, 'km');
  if (!distanceKm || distanceKm < 0.8) return null; // skip tiny drives

  if (d.energy_used_wh != null && d.energy_used_wh > 0) {
    const whPerKm = d.energy_used_wh / distanceKm;
    if (whPerKm < 30 || whPerKm > 500) return null;
    return whPerKm;
  }

  // Fallback: estimate from battery pct
  const startBatt = d.start_soc_pct;
  const endBatt = d.end_soc_pct;
  if (startBatt == null || endBatt == null) return null;
  const battUsed = startBatt - endBatt;
  if (battUsed <= 0) return null;
  const whPerKm = (battUsed * 0.75 * 1000) / distanceKm;
  if (whPerKm < 30 || whPerKm > 500) return null;
  return whPerKm;
}

/** Group drives by date and compute daily averages + rolling average. */
export function buildDailyEfficiency(drives: Drive[], windowSize: number, fmtShortDate: (iso: string) => string): DailyEfficiency[] {
  const byDate = new Map<string, number[]>();

  for (const d of drives) {
    if (!d.start_ts) continue;
    const eff = estimateEfficiency(d);
    if (eff == null) continue;
    const dateKey = d.start_ts.slice(0, 10); // YYYY-MM-DD
    const existing = byDate.get(dateKey);
    if (existing) {
      existing.push(eff);
    } else {
      byDate.set(dateKey, [eff]);
    }
  }

  // Sort by date ascending
  const sorted = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  const dailyAvgs = sorted.map(([date, values]) => ({
    date,
    avg: values.reduce((s, v) => s + v, 0) / values.length,
  }));

  // Compute rolling average
  return dailyAvgs.map((entry, i) => {
    const windowStart = Math.max(0, i - windowSize + 1);
    const window = dailyAvgs.slice(windowStart, i + 1);
    const rollingAvg = window.length >= 2
      ? window.reduce((s, w) => s + w.avg, 0) / window.length
      : null;

    return {
      date: entry.date,
      label: fmtShortDate(entry.date + 'T00:00:00'),
      efficiency: Math.round(entry.avg * 10) / 10,
      rollingAvg: rollingAvg != null ? Math.round(rollingAvg * 10) / 10 : null,
    };
  });
}

export default function DriveEfficiencyChartWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const { formatDateShort } = useDateFormat();

  const { data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['drives', id, 'efficiency-chart-60'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=60`),
    enabled: id > 0,
    staleTime: 120_000,
  });

  const chartData = useMemo(() => {
    const items = drives ?? [];
    // Filter to last 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const recent = items.filter(
      (d) => d.start_ts && new Date(d.start_ts) >= cutoff,
    );
    return buildDailyEfficiency(recent, 7, formatDateShort);
  }, [drives, formatDateShort]);

  // Convert Wh/km to the user's distance unit.
  const displayData = useMemo(
    () =>
      chartData.map((d) => ({
        ...d,
        efficiency: Math.round((unitPrefs.distance === 'mi' ? d.efficiency * 1.609344 : d.efficiency) * 10) / 10,
        rollingAvg:
          d.rollingAvg != null
            ? Math.round((unitPrefs.distance === 'mi' ? d.rollingAvg * 1.609344 : d.rollingAvg) * 10) / 10
            : null,
      })),
    [chartData, unitPrefs.distance],
  );

  const overallAvg = useMemo(() => {
    if (displayData.length === 0) return null;
    const sum = displayData.reduce((s, d) => s + d.efficiency, 0);
    return Math.round((sum / displayData.length) * 10) / 10;
  }, [displayData]);

  const bestDay = useMemo(() => {
    if (displayData.length === 0) return null;
    return displayData.reduce(
      (min, d) => (d.efficiency < min ? d.efficiency : min),
      displayData[0].efficiency,
    );
  }, [displayData]);

  const trend = useMemo(() => {
    if (displayData.length < 4) return null;
    const mid = Math.floor(displayData.length / 2);
    const first = displayData.slice(0, mid);
    const second = displayData.slice(mid);
    const avgFirst = first.reduce((s, d) => s + d.efficiency, 0) / first.length;
    const avgSecond = second.reduce((s, d) => s + d.efficiency, 0) / second.length;
    return Math.round(((avgSecond - avgFirst) / avgFirst) * 1000) / 10;
  }, [displayData]);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const tick = isWide ? axisTick : axisTickSm;

  // Series colour follows the active theme.
  const palette = useThemeChartPalette();

  const stats = useMemo<ChartSummaryStat[]>(() => {
    const items: ChartSummaryStat[] = [
      {
        label: t('widget.driveEfficiencyChart.avg', 'Avg'),
        value: overallAvg != null ? fmtNumber(overallAvg, 0) : '—',
        unit: efficiencyUnit,
      },
      {
        label: t('widget.driveEfficiencyChart.best', 'Best day'),
        value: bestDay != null ? fmtNumber(bestDay, 0) : '—',
        unit: efficiencyUnit,
      },
      {
        label: t('widget.driveEfficiencyChart.trend', 'Trend'),
        value: trend != null ? `${trend > 0 ? '+' : ''}${trend}%` : '—',
      },
    ];
    return items;
  }, [t, overallAvg, bestDay, trend, efficiencyUnit]);

  const chartEl = (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 px-2 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={displayData}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
            {...chartAnimation}
          >
            {areaGradient('efficiency-grad', palette.series[0])}
            {chartGrid}
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} />
            <YAxis
              tick={tick}
              tickLine={false}
              axisLine={false}
              width={36}
              domain={['dataMin - 20', 'dataMax + 20']}
              tickFormatter={(v: number) => `${fmt(v, 0)}`}
            />
            <Tooltip content={<ChartTooltip />} />
            {overallAvg != null && (
              <ReferenceLine
                y={overallAvg}
                stroke={ROLLING_AVG_COLOR}
                strokeDasharray="4 4"
                strokeOpacity={0.5}
              />
            )}
            <Area
              {...AREA_DEFAULTS}
              dataKey="efficiency"
              stroke={palette.series[0]}
              fill="url(#efficiency-grad)"
              name={t('widget.driveEfficiencyChart.daily', 'Daily') + ` (${efficiencyUnit})`}
            />
            <Area
              {...AREA_DEFAULTS}
              dataKey="rollingAvg"
              stroke={ROLLING_AVG_COLOR}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              name={t('widget.driveEfficiencyChart.rolling', '7-day avg') + ` (${efficiencyUnit})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-shrink-0 items-center justify-center gap-3 px-4 pb-1.5">
        <div className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: palette.series[0] }}
          />
          <span className="text-2xs text-[var(--text-secondary)]">
            {t('widget.driveEfficiencyChart.daily', 'Daily')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: ROLLING_AVG_COLOR }}
          />
          <span className="text-2xs text-[var(--text-secondary)]">
            {t('widget.driveEfficiencyChart.rolling', '7-day avg')}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <WidgetShell
      title={!isCompact ? t('widget.driveEfficiencyChart.title', 'Drive Efficiency') : undefined}
      icon={!isCompact ? <TrendingUp className="h-3.5 w-3.5 text-cyan-300" /> : undefined}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      noPadding={!isCompact}
    >
      <WidgetChartSummary
        chart={chartEl}
        stats={stats}
        compact={isCompact}
        isEmpty={displayData.length === 0}
        emptyMessage={t('widget.driveEfficiencyChart.empty', 'No efficiency data yet')}
        emptyIcon={<TrendingUp className="h-5 w-5" />}
      />
    </WidgetShell>
  );
}
