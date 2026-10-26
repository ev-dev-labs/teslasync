import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, chartGrid, chartAnimation, axisTickSm, useMeasuredAxisWidth, useThemeChartPalette, AREA_DEFAULTS, areaGradient, EmbeddedChart, ChartLegend } from '@/components/charts';
import { ChartTooltip } from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { convertEfficiencyFromSI } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';

import { getEnergyIntensityWhPerKm } from '@/lib/drivesAggregation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetChartSummary } from './shared';
import type { WidgetProps } from './types';
import type { Drive } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { zonedDateParts } from '@/lib/dateFormat';
import { CHART_COLORS } from '@/lib/colors';

const ROLLING_AVG_COLOR = CHART_COLORS[3];

export interface DailyEfficiency {
  date: string;
  label: string;
  efficiency: number;
  rollingAvg: number | null;
}

/** Estimate Wh/km for a single drive from energy + distance data. */
export function estimateEfficiency(d: Drive): number | null {
  const whPerKm = getEnergyIntensityWhPerKm(d.distance_m, d.energy_used_wh);
  if (whPerKm == null) return null;
  if (whPerKm < 30 || whPerKm > 500) return null;
  return whPerKm;
}

/** Group drives by date and compute distance-weighted daily intensity. */
export function buildDailyEfficiency(
  drives: Drive[],
  windowSize: number,
  fmtShortDate: (iso: string) => string,
  timezone = 'UTC',
): DailyEfficiency[] {
  const byDate = new Map<string, { energyWh: number; distanceM: number }>();

  for (const d of drives) {
    if (!d.start_ts) continue;
    const eff = estimateEfficiency(d);
    if (eff == null) continue;
    const parts = zonedDateParts(d.start_ts, timezone);
    if (!parts) continue;
    const dateKey = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    const existing = byDate.get(dateKey) ?? { energyWh: 0, distanceM: 0 };
    existing.energyWh += d.energy_used_wh ?? 0;
    existing.distanceM += d.distance_m ?? 0;
    byDate.set(dateKey, existing);
  }

  // Sort by date ascending
  const sorted = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  const dailyAvgs = sorted.map(([date, totals]) => ({
    date,
    avg: totals.energyWh / (totals.distanceM / 1_000),
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
      efficiency: entry.avg,
      rollingAvg,
    };
  });
}

export default function DriveEfficiencyChartWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const { formatDateShort, tz } = useDateFormat();

  const query = useQuery({
    queryKey: ['drives', id, 'efficiency-chart-60'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=60`),
    enabled: id > 0,
    staleTime: 120_000,
  });
  const { data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const trust = useDataState({ ...query, data: drives ?? undefined }, { provenance: 'historical' });

  const chartData = useMemo(() => {
    const items = drives ?? [];
    // Filter to last 30 days
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 30 * 24);
    const recent = items.filter(
      (d) => d.start_ts && !Number.isNaN(new Date(d.start_ts).getTime()) && new Date(d.start_ts) >= cutoff,
    );
    return buildDailyEfficiency(recent, 7, formatDateShort, tz);
  }, [drives, formatDateShort, tz]);

  // Convert Wh/km to the user's distance unit.
  const displayData = useMemo(
    () =>
      chartData.map((d) => ({
        ...d,
        efficiency: convertEfficiencyFromSI(d.efficiency, unitPrefs.distance),
        rollingAvg:
          d.rollingAvg != null
            ? convertEfficiencyFromSI(d.rollingAvg, unitPrefs.distance)
            : null,
      })),
    [chartData, unitPrefs.distance],
  );

  const overallAvg = useMemo(() => {
    if (displayData.length === 0) return null;
    const sum = displayData.reduce((s, d) => s + d.efficiency, 0);
    return sum / displayData.length;
  }, [displayData]);
  const hasRollingAverage = displayData.some(point => point.rollingAvg != null);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const axisLabels = useMemo(
    () => displayData.flatMap(point => [point.efficiency, point.rollingAvg])
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map(value => fmtNumber(value)),
    [displayData, fmtNumber],
  );
  const axisWidth = useMeasuredAxisWidth({
    labels: axisLabels, fontSize: 10, minWidth: 52, padding: 20, enabled: !isCompact,
  });

  // Series colour follows the active theme.
  const palette = useThemeChartPalette();

  const chartEl = (
    <EmbeddedChart
      title={t('widget.driveEfficiencyChart.title', 'Drive efficiency')}
      ariaLabel={t(
        'widget.driveEfficiencyChart.chartAria',
        'Daily and seven-day rolling drive efficiency',
      )}
      data={displayData}
      dataColumns={[
        { key: 'label', label: t('widget.driveEfficiencyChart.date', 'Date') },
        {
          key: 'efficiency',
          label: `${t('widget.driveEfficiencyChart.daily', 'Daily')} (${efficiencyUnit})`,
        },
        {
          key: 'rollingAvg',
          label: `${t('widget.driveEfficiencyChart.rolling', '7-day avg')} (${efficiencyUnit})`,
        },
      ]}
      chartKey="dashboard-drive-efficiency"
      className="px-2 pb-1"
    >
      {({ hiddenSeries }) => (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={displayData}
            margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
            {...chartAnimation}
          >
            {areaGradient('efficiency-grad', palette.series[0])}
            {chartGrid}
            <XAxis dataKey="label" tick={false} tickLine={false} axisLine={false} />
            <YAxis
              tick={axisTickSm}
              tickLine={false}
              axisLine={false}
              width={axisWidth}
              tickFormatter={(value: number) => fmtNumber(value)}
              domain={['dataMin - 20', 'dataMax + 20']}
            />
            <Tooltip content={<ChartTooltip />} />
            {overallAvg != null && <ReferenceLine
              y={overallAvg}
              stroke={ROLLING_AVG_COLOR}
              label={{
                value: `${t('widget.driveEfficiencyChart.avg', 'Avg')}: ${fmtNumber(overallAvg)} ${efficiencyUnit}`,
                position: 'insideTopRight',
                fill: ROLLING_AVG_COLOR,
                fontSize: 10,
              }}
            />}
            <ChartLegend />
            <Area
              {...AREA_DEFAULTS}
              dataKey="efficiency"
              stroke={palette.series[0]}
              fill="url(#efficiency-grad)"
              fillOpacity={0.08}
              dot={{ r: 2, fill: palette.series[0], strokeWidth: 0 }}
              activeDot={{ r: 3 }}
              name={t('widget.driveEfficiencyChart.daily', 'Daily') + ` (${efficiencyUnit})`}
              hide={hiddenSeries?.isHidden('efficiency')}
            />
            {hasRollingAverage && <Area
              {...AREA_DEFAULTS}
              dataKey="rollingAvg"
              stroke={ROLLING_AVG_COLOR}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              name={t('widget.driveEfficiencyChart.rolling', '7-day avg') + ` (${efficiencyUnit})`}
              hide={hiddenSeries?.isHidden('rollingAvg')}
            />}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </EmbeddedChart>
  );

  return (
    <WidgetShell
      title={!isCompact ? t('widget.driveEfficiencyChart.title', 'Drive efficiency') : undefined}
      icon={!isCompact ? <TrendingUp className="h-3.5 w-3.5 text-cyan-300" /> : undefined}
      loading={isLoading}
      dataState={drives != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {displayData.length === 0 ? (
        <WidgetChartSummary
          chart={null}
          stats={[]}
          compact={isCompact}
          isEmpty
          emptyMessage={t('widget.driveEfficiencyChart.empty', 'No efficiency data yet')}
          emptyIcon={<TrendingUp className="h-5 w-5" />}
        />
      ) : (
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          {!isCompact && (
            <div className="shrink-0">
            <WidgetBigNumber
              value={overallAvg != null ? fmtNumber(overallAvg, 0) : null}
              unit={efficiencyUnit}
              subtitle={t('widget.driveEfficiencyChart.windowAverage', '30-day average')}
              animated={false}
            />
            </div>
          )}
          {isCompact ? (
            <WidgetBigNumber
              value={overallAvg != null ? fmtNumber(overallAvg, 0) : null}
              unit={efficiencyUnit}
              align="center"
              animated={false}
            />
          ) : (
            <div className="min-h-0 flex-1">
            <WidgetChartSummary
              stats={[]}
              chart={chartEl}
              legend={[
                { label: t('widget.driveEfficiencyChart.daily', 'Daily'), color: palette.series[0] },
                ...(hasRollingAverage ? [{ label: t('widget.driveEfficiencyChart.rolling', '7-day avg'), color: ROLLING_AVG_COLOR }] : []),
              ]}
            />
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
