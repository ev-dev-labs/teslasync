import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar, ChartLegend, ChartTooltip, CHART_COLORS, ComposedChart, EmbeddedChart,
  type ChartDataColumn, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick, chartGrid,
} from '@/components/charts';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { MonthlyRecoveryChartRow, RegenSectionState } from '../regen-efficiency';
import { isKnownNumber } from './presentation';

interface MonthlyRecoveryChartProps {
  rows: MonthlyRecoveryChartRow[];
  hasData: boolean;
  state: RegenSectionState;
  energySeries: string;
  ratioSeries: string;
  energyUnit: string;
  isEnergyHidden: boolean;
  isRatioHidden: boolean;
}

export function MonthlyRecoveryChart({
  rows, hasData, state, energySeries, ratioSeries, energyUnit, isEnergyHidden, isRatioHidden,
}: MonthlyRecoveryChartProps) {
  const { t } = useTranslation();
  const { fmtNumber, fmtPercent } = useNumberFormatting();
  const dataColumns = useMemo<ChartDataColumn[]>(() => [
    { key: 'month', label: t('regen.monthly.colMonth', 'Month') },
    {
      key: 'recoveredEnergy', label: energySeries,
      format: value => isKnownNumber(value) ? `${fmtNumber(value)} ${energyUnit}` : '—',
    },
    {
      key: 'recoveryRatio', label: ratioSeries,
      format: value => isKnownNumber(value) ? fmtPercent(value) : '—',
    },
  ], [t, energySeries, ratioSeries, energyUnit, fmtNumber, fmtPercent]);
  return (
    <EmbeddedChart
      chartKey="monthly-recovery"
      title={t('regen.monthly.title', 'Monthly Recovery')}
      ariaLabel={t('regen.monthly.aria', 'Recovered energy and recovery ratio by calendar month')}
      loading={state.isLoading}
      error={state.error}
      onRetry={state.onRetry}
      empty={!hasData || !state.isResolved}
      emptyMessage={!state.isResolved
        ? t('regen.states.detailPending', 'Detailed data availability has not resolved.')
        : t('regen.monthly.empty', 'No eligible dated drives are available for a monthly trend.')}
      data={rows}
      dataColumns={dataColumns}
    >
      {({ hiddenSeries }) => (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
            {chartGrid}
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis
              yAxisId="energy" tick={axisTick} tickLine={false} axisLine={false}
              tickFormatter={value => isKnownNumber(value) ? fmtNumber(value) : '—'}
            />
            <YAxis
              yAxisId="ratio" orientation="right" tick={axisTick} tickLine={false} axisLine={false}
              tickFormatter={value => isKnownNumber(value) ? `${fmtNumber(value)}%` : '—'}
            />
            <Tooltip content={<ChartTooltip valueFormatter={(value, name) =>
              !isKnownNumber(value) ? '—'
                : name === energySeries ? `${fmtNumber(value)} ${energyUnit}` : fmtPercent(value)
            } />} />
            <ChartLegend verticalAlign="top" align="right" />
            <Bar
              yAxisId="energy" dataKey="recoveredEnergy" name={energySeries}
              fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={38}
              hide={(hiddenSeries?.isHidden('recoveredEnergy') ?? false) || isEnergyHidden}
            />
            <Line
              yAxisId="ratio" type="monotone" dataKey="recoveryRatio" name={ratioSeries}
              stroke={CHART_COLORS[5]} strokeWidth={2.5} connectNulls={false} dot={{ r: 2.5 }}
              hide={(hiddenSeries?.isHidden('recoveryRatio') ?? false) || isRatioHidden}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </EmbeddedChart>
  );
}
