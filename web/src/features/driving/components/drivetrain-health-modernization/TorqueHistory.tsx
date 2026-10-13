import { useTranslation } from 'react-i18next';
import {
  ChartTooltip, ChartGradient, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, AREA_DEFAULTS,
} from '@/components/charts';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { chartTokens, typography } from '@/lib/tokens';
import { PreservedChartFrame } from './PreservedChartFrame';
import type { MotorHistoryChartProps } from './chartTypes';

const torqueAxisTick = { fill: chartTokens.axisStroke, className: typography.role.caption };

export function TorqueHistory({ rows, state, loading }: MotorHistoryChartProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const torque = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? `${fmtNumber(value)} Nm` : '—';
  const table = rows.map(row => ({ time: row.time, torque: torque(row.torque) }));
  return (
    <PreservedChartFrame
      state={state}
      title={t('drivetrain.torqueHistory', 'Motor Torque')}
      subtitle={t('drivetrain.torqueHistorySub', 'Drive inverter torque output over time')}
      ariaLabel={t('drivetrain.torqueHistoryAria', 'Motor inverter torque output history area chart')}
      ariaDescription={t('drivetrain.modernization.torqueHistoryDescription', 'Torque uses the front motor reading when supplied, otherwise the rear motor reading, in newton-metres. Missing readings remain gaps, not zero.')}
      height={280}
      loading={loading && !state.hasData}
      empty={rows.length <= 1 || !rows.some(row => row.torque != null)}
      data={table}
      exportData={table}
      dataColumns={[
        { key: 'time', label: t('drivetrain.col.time', 'Time') },
        { key: 'torque', label: t('drivetrain.col.torque', 'Torque (Nm)') },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows}>
          <defs><ChartGradient id="dtTorqueGrad" color={chartTokens.series[0]} opacity={0.08} /></defs>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
          <XAxis dataKey="time" tick={torqueAxisTick} />
          <YAxis tickFormatter={value => fmtNumber(value)} tick={torqueAxisTick} />
          <Tooltip content={<ChartTooltip valueFormatter={torque} />} />
          <Legend />
          <Area
            {...AREA_DEFAULTS}
            dataKey="torque"
            name={`${t('drivetrain.torque', 'Torque')} (Nm)`}
            stroke={chartTokens.series[0]}
            fill="url(#dtTorqueGrad)"
          />
          <ReferenceLine y={0} stroke={chartTokens.axisStroke} strokeDasharray="2 2" />
        </AreaChart>
      </ResponsiveContainer>
    </PreservedChartFrame>
  );
}
