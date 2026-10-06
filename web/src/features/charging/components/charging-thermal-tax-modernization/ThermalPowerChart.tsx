import { useTranslation } from 'react-i18next';
import {
  ChartContainer, ChartTooltip, ChartLegend, ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { useUnits } from '@/hooks/useUnits';
import { cn } from '@/lib/cn';
import { chartTokens } from '@/lib/tokens';
import type { DataState } from '@/api/dataState';
import type { thermalPowerRows } from './thermalPresentation';

interface ThermalPowerChartProps {
  selected: boolean;
  loading: boolean;
  state: DataState<unknown>;
  data: ReturnType<typeof thermalPowerRows>;
}

export function ThermalPowerChart({ selected, loading, state, data }: ThermalPowerChartProps) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const { formatPower } = useUnits();

  return <ChartContainer
    title={t('chargingThermalTax.chart', 'Heater vs. Charge Power')}
    subtitle={t('chargingThermalTax.chartHint', 'The shaded area is heater draw; the line is total charger power')}
    ariaLabel={t('chargingThermalTax.chartAria', 'Chart of battery heater power and total charging power over the session timeline')}
    chartKey="charging-thermal-tax-power"
    className={cn('h-full min-w-0', placement?.className)}
    loading={loading}
    error={selected ? state.fatalError : null}
    onRetry={state.retry ?? undefined}
    empty={!selected || data.length === 0}
    emptyMessage={selected && !state.hasData && state.isRefreshBlocked
      ? t('chargingThermalTax.state.paused', 'Telemetry loading is paused. Connect to resume or retry.')
      : selected
      ? t('chargingThermalTax.noTelemetry', 'No telemetry samples were recorded for this session.')
      : t('chargingThermalTax.noSelection', 'Select a charging session above to see its thermal breakdown.')}
    height={320}
    data={data}
    exportData={data}
    dataColumns={[
      { key: 'time', label: t('chargingThermalTax.col.time', 'Time') },
      { key: 'heaterW', label: t('chargingThermalTax.col.heater', 'Heater (W)') },
      { key: 'chargeW', label: t('chargingThermalTax.col.charge', 'Charge power (W)') },
    ]}
  >
    {({ hiddenSeries }) => (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
          <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={value => formatPower(value)} />
          <Tooltip content={<ChartTooltip valueFormatter={value => formatPower(typeof value === 'number' ? value : null)} />} />
          <ChartLegend state={hiddenSeries ?? undefined} />
          <Area
            type="monotone"
            dataKey="heaterW"
            name={t('chargingThermalTax.series.heater', 'Heater')}
            fill={chartTokens.series[3]}
            stroke={chartTokens.series[3]}
            fillOpacity={0.35}
            hide={hiddenSeries?.isHidden('heaterW')}
          />
          <Line
            type="monotone"
            dataKey="chargeW"
            name={t('chargingThermalTax.series.charge', 'Charge power')}
            stroke={chartTokens.series[0]}
            strokeWidth={2}
            dot={false}
            hide={hiddenSeries?.isHidden('chargeW')}
          />
        </ComposedChart>
      </ResponsiveContainer>
    )}
  </ChartContainer>;
}
