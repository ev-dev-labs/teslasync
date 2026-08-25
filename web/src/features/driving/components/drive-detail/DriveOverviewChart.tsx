import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartContainer, ChartLegend, ChartTooltip,
  ComposedChart, Area, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS, areaGradient,
  ChartBrush, useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt, fmtPercent, fmtWithUnit } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';
import type { ChartDataPoint } from './types';

interface DriveOverviewChartProps {
  drive: DriveDetail;
  chartData: ChartDataPoint[];
}

export function DriveOverviewChart({ chartData }: DriveOverviewChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const distanceUnit = unitPrefs.distance;
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  // A single sample can't form a line — treat 0 or 1 points as "no chart".
  const hasChart = (chartData ?? []).length > 1;

  // Precompute which optional series actually carry data so the chart body
  // doesn't re-scan the (potentially thousands-of-points) dataset four times
  // on every render. recharts requires <Line>/<Area> to be direct children,
  // so these flags gate rendering while each dataKey stays static.
  const series = useMemo(() => {
    const data = chartData ?? [];
    return {
      hasIdealRange: data.some((d) => d.idealRange !== null),
      hasRangeSeries: data.some((d) => d.estRange !== null || d.ratedRange !== null),
      estRangeKey: (data.some((d) => d.estRange !== null) ? 'estRange' : 'ratedRange') as 'estRange' | 'ratedRange',
      hasUsableSoc: data.some((d) => d.usableSoc !== null),
    };
  }, [chartData]);

  return (
    <FadeIn>
      {/* chart-a11y:no-table dense per-sample drive trace; mean/max/min summary table follows below in the rich legend */}
      <ChartContainer
        title={t('driveDetail.driveChart', 'Drive Overview')}
        ariaLabel={t('driveDetail.driveChart.aria', 'Drive overview composed chart of speed, range, SOC and power over time')}
        chartKey="drive-detail-overview"
        height={360}
      >
        {({ hiddenSeries }) => (
          hasChart ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
              data={chartData}
              syncId={syncProps.syncId}
              syncMethod={syncProps.syncMethod}
              onMouseMove={syncProps.onMouseMove}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis yAxisId="power" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} unit=" kW" />
              <YAxis yAxisId="speed" hide />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              {areaGradient('driveOverviewSpeed', '#3b82f6', 0.08)}
              <ReferenceLine yAxisId="power" y={0} stroke="rgba(255,255,255,0.1)" />
              <Area {...AREA_DEFAULTS} yAxisId="speed" dataKey="speed" stroke="#3b82f6" fill="url(#driveOverviewSpeed)" strokeWidth={1.5} name={`${t('driveDetail.speed', 'Speed')} (${speedUnit})`} hide={hiddenSeries?.isHidden('speed')} />
              {series.hasIdealRange && (
                <Line {...AREA_DEFAULTS} yAxisId="speed" dataKey="idealRange" stroke="#c084fc" strokeWidth={1} name={`${t('driveDetail.rangeIdeal', 'Range ideal')} (${distanceUnit})`} strokeDasharray="4 2" hide={hiddenSeries?.isHidden('idealRange')} />
              )}
              {series.hasRangeSeries && (
                <Line {...AREA_DEFAULTS} yAxisId="speed" dataKey={series.estRangeKey} stroke="#a855f7" strokeWidth={1} name={`${t('driveDetail.rangeEst', 'Range est.')} (${distanceUnit})`} strokeDasharray="4 2" hide={hiddenSeries?.isHidden(series.estRangeKey)} />
              )}
              <Line {...AREA_DEFAULTS} yAxisId="speed" dataKey="battery" stroke="#84cc16" strokeWidth={1.5} name={`${t('driveDetail.soc', 'SOC')} %`} hide={hiddenSeries?.isHidden('battery')} />
              {series.hasUsableSoc && (
                <Line {...AREA_DEFAULTS} yAxisId="speed" dataKey="usableSoc" stroke="#22d3ee" strokeWidth={1} name={`${t('driveDetail.usableSoc', 'Usable SOC')} %`} hide={hiddenSeries?.isHidden('usableSoc')} />
              )}
              <Line {...AREA_DEFAULTS} yAxisId="power" dataKey="power" stroke="#f59e0b" name={`${t('driveDetail.power', 'Power')} kW`} hide={hiddenSeries?.isHidden('power')} />
              {syncedX != null && (
                <ReferenceLine
                  yAxisId="power"
                  x={syncedX}
                  stroke={chartTokens.cursor.stroke}
                  strokeWidth={chartTokens.cursor.strokeWidth}
                  strokeDasharray={chartTokens.cursor.strokeDasharray}
                  ifOverflow="hidden"
                  isFront
                />
              )}
              {/*
                Brush at the bottom of the overview chart. When this chart is
                inside a `<ChartTimeRangeProvider>` (DriveDetailPage wraps it),
                recharts' native syncId mechanism propagates the visible window
                to every other chart sharing the same dataset.
              */}
              <ChartBrush dataKey="time" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" />
              <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
            </div>
          )
        )}
      </ChartContainer>
      {/* Rich legend with Mean/Max/Min stats */}
      {hasChart && <DriveStatsLegend chartData={chartData} />}
    </FadeIn>
  );
}

type LegendItem = { color: string; dash?: boolean; label: string; mean: string; max: string; min: string };

interface SeriesStat {
  mean: number;
  max: number;
  min: number;
}

/**
 * Single-pass mean/max/min over a sparse series. Skips null AND non-finite
 * values (NaN / ±Infinity) so a bad sample never poisons the summary. Uses a
 * running compare instead of `Math.max(...v)` — spreading a multi-thousand
 * point drive would blow the argument-count limit and throw a RangeError.
 */
function summarize(vals: (number | null)[]): SeriesStat | null {
  let count = 0;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const x of vals) {
    if (x == null || !Number.isFinite(x)) continue;
    count += 1;
    sum += x;
    if (x > max) max = x;
    if (x < min) min = x;
  }
  if (count === 0) return null;
  return { mean: sum / count, max, min };
}

function DriveStatsLegend({ chartData }: { chartData: ChartDataPoint[] }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const distanceUnit = unitPrefs.distance;

  const items = useMemo<LegendItem[]>(() => {
    const data = chartData ?? [];
    const speedS = summarize(data.map((d) => d.speed));
    const idealRangeS = summarize(data.map((d) => d.idealRange));
    const estRangeS = summarize(data.map((d) => d.estRange ?? d.ratedRange));
    const powerS = summarize(data.map((d) => d.power));
    const socS = summarize(data.map((d) => (d.battery > 0 ? d.battery : null)));
    const usableSocS = summarize(data.map((d) => d.usableSoc));

    const out: LegendItem[] = [];
    if (speedS) out.push({ color: '#3b82f6', label: t('driveDetail.speed', 'Speed'), mean: `${fmtNumber(speedS.mean)} ${speedUnit}`, max: `${fmtNumber(speedS.max)} ${speedUnit}`, min: `${fmtNumber(speedS.min)} ${speedUnit}` });
    if (idealRangeS) out.push({ color: '#c084fc', dash: true, label: t('driveDetail.rangeIdeal', 'Range (ideal)'), mean: `${fmtInt(idealRangeS.mean)} ${distanceUnit}`, max: `${fmtInt(idealRangeS.max)} ${distanceUnit}`, min: `${fmtInt(idealRangeS.min)} ${distanceUnit}` });
    if (estRangeS) out.push({ color: '#a855f7', dash: true, label: t('driveDetail.rangeEst', 'Range (est.)'), mean: `${fmtInt(estRangeS.mean)} ${distanceUnit}`, max: `${fmtInt(estRangeS.max)} ${distanceUnit}`, min: `${fmtInt(estRangeS.min)} ${distanceUnit}` });
    if (socS) out.push({ color: '#84cc16', label: t('driveDetail.soc', 'SOC'), mean: fmtPercent(socS.mean), max: fmtPercent(socS.max), min: fmtPercent(socS.min) });
    if (usableSocS) out.push({ color: '#22d3ee', label: t('driveDetail.usableSoc', 'Usable SOC'), mean: fmtPercent(usableSocS.mean), max: fmtPercent(usableSocS.max), min: fmtPercent(usableSocS.min) });
    if (powerS) out.push({ color: '#f59e0b', label: t('driveDetail.power', 'Power'), mean: fmtWithUnit(powerS.mean, 'kW'), max: fmtWithUnit(powerS.max, 'kW'), min: fmtWithUnit(powerS.min, 'kW') });
    return out;
  }, [chartData, t, speedUnit, distanceUnit]);

  if (items.length === 0) return null;

  const meanLabel = t('driveDetail.stat.mean', 'Mean');
  const maxLabel = t('driveDetail.stat.max', 'Max');
  const minLabel = t('driveDetail.stat.min', 'Min');

  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-2xs leading-tight">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="inline-block w-4 border-t-2" style={{ borderColor: item.color, borderStyle: item.dash ? 'dashed' : 'solid' }} />
          <strong style={{ color: item.color }}>{item.label}</strong>
          <span className="text-[var(--text-muted)]">{meanLabel}: {item.mean}</span>
          <span className="text-[var(--text-muted)]">{maxLabel}: {item.max}</span>
          <span className="text-[var(--text-muted)]">{minLabel}: {item.min}</span>
        </span>
      ))}
    </div>
  );
}
