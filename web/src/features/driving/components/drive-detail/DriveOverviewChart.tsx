import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartContainer, ChartTooltip,
  ComposedChart, Area, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
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

  return (
    <FadeIn>
      <ChartContainer title={t('driveDetail.driveChart', 'Drive Overview')} height={320}>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis yAxisId="power" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} unit=" kW" />
              <YAxis yAxisId="speed" hide />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine yAxisId="power" y={0} stroke="rgba(255,255,255,0.1)" />
              <Area yAxisId="speed" type="monotone" dataKey="speed" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.08} strokeWidth={1.5} name={`${t('driveDetail.speed', 'Speed')} (${speedUnit})`} />
              {chartData.some((d) => d.idealRange !== null) && (
                <Line yAxisId="speed" type="monotone" dataKey="idealRange" stroke="#c084fc" strokeWidth={1} dot={false} name={`${t('driveDetail.rangeIdeal', 'Range ideal')} (${distanceUnit})`} strokeDasharray="4 2" />
              )}
              {chartData.some((d) => d.estRange !== null || d.ratedRange !== null) && (
                <Line yAxisId="speed" type="monotone" dataKey={chartData.some((d) => d.estRange !== null) ? 'estRange' : 'ratedRange'} stroke="#a855f7" strokeWidth={1} dot={false} name={`${t('driveDetail.rangeEst', 'Range est.')} (${distanceUnit})`} strokeDasharray="4 2" />
              )}
              <Line yAxisId="speed" type="monotone" dataKey="battery" stroke="#84cc16" strokeWidth={1.5} dot={false} name={`${t('driveDetail.soc', 'SOC')} %`} />
              {chartData.some((d) => d.usableSoc !== null) && (
                <Line yAxisId="speed" type="monotone" dataKey="usableSoc" stroke="#22d3ee" strokeWidth={1} dot={false} name={`${t('driveDetail.usableSoc', 'Usable SOC')} %`} />
              )}
              <Line yAxisId="power" type="monotone" dataKey="power" stroke="#f59e0b" strokeWidth={2} dot={false} name={`${t('driveDetail.power', 'Power')} kW`} />
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
