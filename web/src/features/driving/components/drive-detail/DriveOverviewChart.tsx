import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartContainer, ChartTooltip,
  ComposedChart, Area, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS, areaGradient,
  ChartBrush, useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt, fmtPercent, fmtWithUnit } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';
import type { ChartDataPoint } from './types';

interface DriveOverviewChartProps {
  drive: DriveDetail;
  chartData: ChartDataPoint[];
}

export function DriveOverviewChart({ chartData }: DriveOverviewChartProps) {
  const { t } = useTranslation();
  const { speedUnit, distanceUnit } = useSettings();
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  return (
    <FadeIn>
      <ChartContainer title={t('driveDetail.driveChart', 'Drive Overview')} height={360}>
        {chartData.length > 1 ? (
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
              {areaGradient('driveOverviewSpeed', '#3b82f6', 0.08)}
              <ReferenceLine yAxisId="power" y={0} stroke="rgba(255,255,255,0.1)" />
              <Area {...AREA_DEFAULTS} yAxisId="speed" dataKey="speed" stroke="#3b82f6" fill="url(#driveOverviewSpeed)" strokeWidth={1.5} name={`${t('driveDetail.speed', 'Speed')} (${speedUnit})`} />
              {chartData.some((d) => d.idealRange !== null) && (
                <Line {...AREA_DEFAULTS} yAxisId="speed" dataKey="idealRange" stroke="#c084fc" strokeWidth={1} name={`${t('driveDetail.rangeIdeal', 'Range ideal')} (${distanceUnit})`} strokeDasharray="4 2" />
              )}
              {chartData.some((d) => d.estRange !== null || d.ratedRange !== null) && (
                <Line {...AREA_DEFAULTS} yAxisId="speed" dataKey={chartData.some((d) => d.estRange !== null) ? 'estRange' : 'ratedRange'} stroke="#a855f7" strokeWidth={1} name={`${t('driveDetail.rangeEst', 'Range est.')} (${distanceUnit})`} strokeDasharray="4 2" />
              )}
              <Line {...AREA_DEFAULTS} yAxisId="speed" dataKey="battery" stroke="#84cc16" strokeWidth={1.5} name={`${t('driveDetail.soc', 'SOC')} %`} />
              {chartData.some((d) => d.usableSoc !== null) && (
                <Line {...AREA_DEFAULTS} yAxisId="speed" dataKey="usableSoc" stroke="#22d3ee" strokeWidth={1} name={`${t('driveDetail.usableSoc', 'Usable SOC')} %`} />
              )}
              <Line {...AREA_DEFAULTS} yAxisId="power" dataKey="power" stroke="#f59e0b" name={`${t('driveDetail.power', 'Power')} kW`} />
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
        )}
      </ChartContainer>
      {/* Rich legend with Mean/Max/Min stats */}
      {chartData.length > 1 && <ChartLegend chartData={chartData} />}
    </FadeIn>
  );
}

function ChartLegend({ chartData }: { chartData: ChartDataPoint[] }) {
  const { t } = useTranslation();
  const { speedUnit, distanceUnit } = useSettings();

  const statFn = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x != null);
    if (v.length === 0) return null;
    return { mean: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v), min: Math.min(...v) };
  };

  const speedS = statFn(chartData.map((d) => d.speed));
  const idealRangeS = statFn(chartData.map((d) => d.idealRange));
  const estRangeS = statFn(chartData.map((d) => d.estRange ?? d.ratedRange));
  const powerS = statFn(chartData.map((d) => d.power));
  const socS = statFn(chartData.map((d) => d.battery > 0 ? d.battery : null));
  const usableSocS = statFn(chartData.map((d) => d.usableSoc));

  type LegendItem = { color: string; dash?: boolean; label: string; mean: string; max: string; min: string };
  const items: LegendItem[] = [];
  if (speedS) items.push({ color: '#3b82f6', label: t('driveDetail.speed', 'Speed'), mean: `${fmtNumber(speedS.mean)} ${speedUnit}`, max: `${fmtNumber(speedS.max)} ${speedUnit}`, min: `${fmtInt(speedS.min)} ${speedUnit}` });
  if (idealRangeS) items.push({ color: '#c084fc', dash: true, label: t('driveDetail.rangeIdeal', 'Range (ideal)'), mean: `${fmtInt(idealRangeS.mean)} ${distanceUnit}`, max: `${fmtInt(idealRangeS.max)} ${distanceUnit}`, min: `${fmtInt(idealRangeS.min)} ${distanceUnit}` });
  if (estRangeS) items.push({ color: '#a855f7', dash: true, label: t('driveDetail.rangeEst', 'Range (est.)'), mean: `${fmtInt(estRangeS.mean)} ${distanceUnit}`, max: `${fmtInt(estRangeS.max)} ${distanceUnit}`, min: `${fmtInt(estRangeS.min)} ${distanceUnit}` });
  if (socS) items.push({ color: '#84cc16', label: t('driveDetail.soc', 'SOC'), mean: fmtPercent(socS.mean), max: fmtPercent(socS.max), min: fmtPercent(socS.min) });
  if (usableSocS) items.push({ color: '#22d3ee', label: t('driveDetail.usableSoc', 'Usable SOC'), mean: fmtPercent(usableSocS.mean), max: fmtPercent(usableSocS.max), min: fmtPercent(usableSocS.min) });
  if (powerS) items.push({ color: '#f59e0b', label: t('driveDetail.power', 'Power'), mean: fmtWithUnit(powerS.mean, 'kW'), max: fmtWithUnit(powerS.max, 'kW'), min: fmtWithUnit(powerS.min, 'kW') });

  if (items.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[10px] leading-tight">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="inline-block w-4 border-t-2" style={{ borderColor: item.color, borderStyle: item.dash ? 'dashed' : 'solid' }} />
          <strong style={{ color: item.color }}>{item.label}</strong>
          <span className="text-[var(--text-muted)]">Mean: {item.mean}</span>
          <span className="text-[var(--text-muted)]">Max: {item.max}</span>
          <span className="text-[var(--text-muted)]">Min: {item.min}</span>
        </span>
      ))}
    </div>
  );
}
