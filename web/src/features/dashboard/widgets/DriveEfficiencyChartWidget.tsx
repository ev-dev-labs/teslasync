import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer,
  Tooltip, ReferenceLine,
  chartGrid, axisTick, axisTickSm, chartAnimation, fmt, CHART_COLORS,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { request } from '@/api/client';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Drive } from '@/api/types';

const KM_TO_MI = 0.621371;
// Average Tesla EPA-rated consumption (~250 Wh/mi). Used to estimate actual
// Wh/mi from the ratio of rated-range consumed vs distance driven.
const EPA_WH_PER_MI = 250;

interface DailyEfficiency {
  date: string;
  label: string;
  efficiency: number;
  rollingAvg: number | null;
}

/** Estimate Wh/mi for a single drive from range + distance data. */
function estimateEfficiency(d: Drive): number | null {
  const distance = d.distance;
  if (!distance || distance < 0.5) return null; // skip tiny drives

  const startRange = d.start_range_km ?? d.start_rated_range_km;
  const endRange = d.end_range_km ?? d.end_rated_range_km;

  if (startRange == null || endRange == null) return null;

  const rangeConsumedMi = (startRange - endRange) * KM_TO_MI;
  if (rangeConsumedMi <= 0) return null; // regen-only or charging during drive

  const factor = rangeConsumedMi / distance;
  const whPerMi = factor * EPA_WH_PER_MI;

  // Sanity bounds: 50–800 Wh/mi (filter outliers)
  if (whPerMi < 50 || whPerMi > 800) return null;
  return whPerMi;
}

/** Group drives by date and compute daily averages + rolling average. */
function buildDailyEfficiency(drives: Drive[], windowSize: number): DailyEfficiency[] {
  const byDate = new Map<string, number[]>();

  for (const d of drives) {
    if (!d.start_date) continue;
    const eff = estimateEfficiency(d);
    if (eff == null) continue;
    const dateKey = d.start_date.slice(0, 10); // YYYY-MM-DD
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
      label: new Date(entry.date + 'T00:00:00').toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      efficiency: Math.round(entry.avg * 10) / 10,
      rollingAvg: rollingAvg != null ? Math.round(rollingAvg * 10) / 10 : null,
    };
  });
}

export default function DriveEfficiencyChartWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { convertEfficiency, efficiencyUnit } = useSettings();

  const { data: drives, isLoading, error } = useQuery({
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
      (d) => d.start_date && new Date(d.start_date) >= cutoff,
    );
    return buildDailyEfficiency(recent, 7);
  }, [drives]);

  // Convert to user units
  const displayData = useMemo(
    () =>
      chartData.map((d) => ({
        ...d,
        efficiency: Math.round(convertEfficiency(d.efficiency) * 10) / 10,
        rollingAvg:
          d.rollingAvg != null
            ? Math.round(convertEfficiency(d.rollingAvg) * 10) / 10
            : null,
      })),
    [chartData, convertEfficiency],
  );

  const overallAvg = useMemo(() => {
    if (displayData.length === 0) return null;
    const sum = displayData.reduce((s, d) => s + d.efficiency, 0);
    return Math.round((sum / displayData.length) * 10) / 10;
  }, [displayData]);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const tick = isWide ? axisTick : axisTickSm;

  // Compact: show single efficiency metric
  if (isCompact) {
    return (
      <WidgetShell loading={isLoading} error={error ? String(error) : null}>
        <div className="h-full flex flex-col items-center justify-center gap-0.5">
          <span className="text-2xl font-bold text-white/90">
            {overallAvg != null ? fmt(overallAvg, 0) : '—'}
          </span>
          <span className="text-[10px] text-white/40 uppercase tracking-wider">
            {efficiencyUnit}
          </span>
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.driveEfficiencyChart.title', 'Drive Efficiency')}
      icon={<TrendingUp className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
      noPadding
    >
      {displayData.length > 0 ? (
        <div className="h-full w-full flex flex-col min-h-0">
          {/* Summary row */}
          <div className="flex items-center gap-4 px-4 pb-1 flex-shrink-0">
            <div>
              <span className="text-lg font-bold text-neon-cyan">
                {overallAvg != null ? fmtNumber(overallAvg, 0) : '—'}
              </span>
              <span className="text-[10px] text-white/40 ml-1">
                {t('widget.driveEfficiencyChart.avg', 'avg')} {efficiencyUnit}
              </span>
            </div>
            {displayData.length > 1 && (
              <div className="text-[10px] text-white/30">
                {t('widget.driveEfficiencyChart.days', '{{count}} days', {
                  count: displayData.length,
                })}
              </div>
            )}
          </div>

          {/* Chart */}
          <div className="flex-1 min-h-0 px-2 pb-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={displayData}
                margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                {...chartAnimation}
              >
                <defs>
                  <linearGradient id="efficiency-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
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
                    stroke="#f59e0b"
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="efficiency"
                  stroke={CHART_COLORS[0]}
                  fill="url(#efficiency-grad)"
                  strokeWidth={2}
                  dot={false}
                  name={t('widget.driveEfficiencyChart.daily', 'Daily') + ` (${efficiencyUnit})`}
                />
                <Area
                  type="monotone"
                  dataKey="rollingAvg"
                  stroke="#f59e0b"
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls
                  name={t('widget.driveEfficiencyChart.rolling', '7-day avg') + ` (${efficiencyUnit})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-3 px-4 pb-1.5 flex-shrink-0">
            <div className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: CHART_COLORS[0] }}
              />
              <span className="text-[10px] text-white/50">
                {t('widget.driveEfficiencyChart.daily', 'Daily')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: '#f59e0b' }}
              />
              <span className="text-[10px] text-white/50">
                {t('widget.driveEfficiencyChart.rolling', '7-day avg')}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<TrendingUp className="h-5 w-5" />}
          message={t('widget.driveEfficiencyChart.empty', 'No efficiency data yet')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
