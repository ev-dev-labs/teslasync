import { useTranslation } from 'react-i18next';
import {
  ChartLegend, ChartTooltip, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, AREA_DEFAULTS, areaGradient,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { PreservedChartFrame } from './PreservedChartFrame';
import type { DriveHistoryChartProps } from './chartTypes';

export function PowerHistory({ rows, state, loading }: DriveHistoryChartProps) {
  const { t } = useTranslation();
  const { formatPower, unitPrefs } = useUnits();
  const hidden = useHiddenSeries('drivetrain-power-output');
  const table = rows.map(row => ({
    date: row.date,
    power_max_kw: formatPower(row.powerMax),
    power_min_kw: formatPower(row.powerMin),
  }));
  return (
    <PreservedChartFrame
      state={state}
      title={t('drivetrain.powerOutput', 'Power Output History')}
      subtitle={t('drivetrain.powerOutputSub', 'Peak and regen power per drive over time')}
      ariaLabel={t('drivetrain.powerOutput.aria', 'Per-drive peak and regen motor power output history area chart')}
      ariaDescription={t('drivetrain.modernization.powerMethodology', 'Peak-labelled power uses average drive power from up to 30 returned drives. Per-drive regen power is not supplied; gaps are unknown, not zero.')}
      chartKey="drivetrain-power-output"
      height={300}
      loading={loading && !state.hasData}
      empty={rows.length <= 1}
      data={table}
      exportData={table}
      dataColumns={[
        { key: 'date', label: t('drivetrain.col.date', 'Date') },
        { key: 'power_max_kw', label: `${t('drivetrain.modernization.peakAveragePower', 'Peak-labelled average drive power')} (${unitPrefs.power})` },
        { key: 'power_min_kw', label: t('drivetrain.col.powerMin', 'Regen (kW)') },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows}>
          {areaGradient('dtPwrMaxGrad', '#8b5cf6')}
          {areaGradient('dtPwrMinGrad', '#ef4444')}
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
          <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
          <YAxis tickFormatter={value => formatPower(Number(value))} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
          <Tooltip content={<ChartTooltip valueFormatter={value => formatPower(typeof value === 'number' ? value : null)} />} />
          <ChartLegend state={hidden} />
          <Area
            {...AREA_DEFAULTS}
            dataKey="powerMax"
            name={t('drivetrain.powerMax', 'Peak Power (kW)')}
            stroke="#8b5cf6"
            fill="url(#dtPwrMaxGrad)"
            hide={hidden.isHidden('powerMax')}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="powerMin"
            name={t('drivetrain.powerMin', 'Regen Power (kW)')}
            stroke="#ef4444"
            fill="url(#dtPwrMinGrad)"
            hide={hidden.isHidden('powerMin')}
          />
          <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
        </AreaChart>
      </ResponsiveContainer>
    </PreservedChartFrame>
  );
}
