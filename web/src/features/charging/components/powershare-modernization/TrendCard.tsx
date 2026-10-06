import { useTranslation } from 'react-i18next';
import { ChartCard } from '@/components/layout';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip,
  ChartTooltip, ChartGradient, chartGrid, axisTickSm, AREA_DEFAULTS,
} from '@/components/charts';
import { useChartPalette } from '@/hooks/useChartPalette';
import type { TrendPoint } from '../powershare';

interface TrendCardProps {
  kind: 'power' | 'hours';
  points: TrendPoint[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const ACTIVE_DOT = { r: 4 };

/** Both observation trends share the canonical chart frame and its tools. */
export function TrendCard({ kind, points, isLoading, error, onRetry }: TrendCardProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const power = kind === 'power';
  const data = points ?? [];
  const color = palette[power ? 0 : 1];
  const title = power
    ? t('powershare.powerTrend.title', 'Output Power Trend')
    : t('powershare.hoursTrend.title', 'Remaining Runtime Trend');
  const label = power
    ? t('powershare.kpi.outputPower', 'Output Power')
    : t('powershare.kpi.hoursRemaining', 'Hours Remaining');

  return (
    <ChartCard
      title={title}
      ariaLabel={power
        ? t('powershare.powerTrend.ariaLabel', 'Output power trend chart')
        : t('powershare.hoursTrend.ariaLabel', 'Estimated remaining runtime trend')}
      data={data.map(({ label: time, value }) => ({ label: time, value }))}
      exportData={data.map(({ label: time, value }) => ({ label: time, value }))}
      exportable
      fullscreen
      dataColumns={[
        { key: 'label', label: t('powershare.time', 'Time') },
        { key: 'value', label: `${label} (${power ? 'kW' : 'h'})` },
      ]}
      loading={isLoading}
      error={error}
      onRetry={onRetry}
      empty={data.length === 0}
      emptyMessage={power
        ? t('powershare.powerTrend.noData', 'No power readings yet. The chart fills in as your vehicle streams Powershare telemetry.')
        : t('powershare.hoursTrend.noData', 'No runtime readings yet. Estimated hours appear once Powershare reports telemetry.')}
    >
      <ResponsiveContainer width="100%" height="100%">
        {power ? (
          <AreaChart data={data}>
            <defs><ChartGradient id="powershare-power" color={color} /></defs>
            {chartGrid}
            <XAxis dataKey="label" tick={axisTickSm} minTickGap={24} />
            <YAxis tick={axisTickSm} width={40} unit=" kW" />
            <Tooltip content={<ChartTooltip />} />
            <Area {...AREA_DEFAULTS} dataKey="value" name={label} stroke={color} fill="url(#powershare-power)" />
          </AreaChart>
        ) : (
          <LineChart data={data}>
            {chartGrid}
            <XAxis dataKey="label" tick={axisTickSm} minTickGap={24} />
            <YAxis tick={axisTickSm} width={36} unit=" h" allowDecimals />
            <Tooltip content={<ChartTooltip />} />
            <Line type="monotone" dataKey="value" name={label} stroke={color} strokeWidth={2}
              dot={false} activeDot={ACTIVE_DOT} isAnimationActive={false} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </ChartCard>
  );
}
