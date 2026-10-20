import { useTranslation } from 'react-i18next';
import {
  ChartLegend, ChartTooltip, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, AREA_DEFAULTS, areaGradient,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { chartTokens, typography } from '@/lib/tokens';
import { PreservedChartFrame } from './PreservedChartFrame';
import type { DriveHistoryChartProps } from './chartTypes';

export function PowerHistory({ rows, state, loading }: DriveHistoryChartProps) {
  const { t } = useTranslation();
  const { formatPower, unitPrefs } = useUnits();
  const hidden = useHiddenSeries('drivetrain-power-output');
  const averagePowerLabel = `${t('drivetrain.modernization.peakAveragePower', 'Peak-labelled average drive power')} (${unitPrefs.power})`;
  const regenPowerLabel = t('drivetrain.powerMin', 'Regen Power (kW)').replace('(kW)', `(${unitPrefs.power})`);
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
      ariaLabel={t('drivetrain.powerOutputAria', 'Per-drive peak and regen motor power output history area chart')}
      ariaDescription={t('drivetrain.modernization.powerMethodology', 'Peak-labelled power uses average drive power from up to 30 returned drives. Per-drive regen power is not supplied; gaps are unknown, not zero.')}
      chartKey="drivetrain-power-output"
      height={300}
      loading={loading && !state.hasData}
      empty={rows.length <= 1}
      data={table}
      exportData={table}
      dataColumns={[
        { key: 'date', label: t('drivetrain.col.date', 'Date') },
        { key: 'power_max_kw', label: averagePowerLabel },
        { key: 'power_min_kw', label: t('drivetrain.col.powerMin', 'Regen (kW)').replace('(kW)', `(${unitPrefs.power})`) },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows}>
          {areaGradient('dtPwrMaxGrad', chartTokens.series[4], 0.08)}
          {areaGradient('dtPwrMinGrad', chartTokens.series[3], 0.08)}
          <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
          <XAxis dataKey="date" tick={{ fill: chartTokens.axisStroke, className: typography.role.caption }} />
          <YAxis tickFormatter={value => formatPower(Number(value))} tick={{ fill: chartTokens.axisStroke, className: typography.role.caption }} />
          <Tooltip content={<ChartTooltip valueFormatter={value => formatPower(typeof value === 'number' ? value : null)} />} />
          <ChartLegend state={hidden} />
          <Area
            {...AREA_DEFAULTS}
            dataKey="powerMax"
            name={averagePowerLabel}
            stroke={chartTokens.series[4]}
            fill="url(#dtPwrMaxGrad)"
            hide={hidden.isHidden('powerMax')}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="powerMin"
            name={regenPowerLabel}
            stroke={chartTokens.series[3]}
            fill="url(#dtPwrMinGrad)"
            hide={hidden.isHidden('powerMin')}
          />
          <ReferenceLine y={0} stroke={chartTokens.axisStroke} strokeDasharray="2 2" />
        </AreaChart>
      </ResponsiveContainer>
    </PreservedChartFrame>
  );
}
