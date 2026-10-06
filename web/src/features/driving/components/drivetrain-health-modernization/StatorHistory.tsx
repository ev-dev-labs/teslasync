import { useTranslation } from 'react-i18next';
import {
  ChartLegend, ChartTooltip, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, AREA_DEFAULTS,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { PreservedChartFrame } from './PreservedChartFrame';
import type { MotorHistoryChartProps } from './chartTypes';

export function StatorHistory({ rows, state, loading }: MotorHistoryChartProps) {
  const { t } = useTranslation();
  const { formatTemperature, unitPrefs } = useUnits();
  const hidden = useHiddenSeries('stator-temp-chart');
  const table = rows.map(row => ({
    time: row.time,
    stator: formatTemperature(row.stator),
    statorRel: formatTemperature(row.statorRel),
    statorRer: formatTemperature(row.statorRer),
  }));
  return (
    <PreservedChartFrame
      state={state}
      title={t('drivetrain.statorTempHistory', 'Stator Temperature History')}
      subtitle={t('drivetrain.statorTempSub', 'Motor stator temperature over recent snapshots')}
      ariaLabel={t('drivetrain.modernization.statorHistorySummary', 'Front motor, rear motor and inverter temperature over returned motor snapshots, displayed under the existing stator series aliases.')}
      ariaDescription={t('drivetrain.modernization.statorAliases', 'Existing Stator, Rear-Left and Rear-Right series map to front motor, rear motor and inverter temperature respectively. These aliases do not identify additional motors.')}
      chartKey="stator-temp-chart"
      height={280}
      loading={loading && !state.hasData}
      empty={rows.length <= 1 || !rows.some(row => row.stator != null || row.statorRel != null || row.statorRer != null)}
      data={table}
      exportData={table}
      dataColumns={[
        { key: 'time', label: t('drivetrain.col.time', 'Time') },
        { key: 'stator', label: `${t('drivetrain.col.stator', 'Stator')} — ${t('drivetrain.frontMotor', 'Front Motor')} (${unitPrefs.temperature})` },
        { key: 'statorRel', label: `${t('drivetrain.col.statorRel', 'Rear-Left')} — ${t('drivetrain.rearMotor', 'Rear Motor')} (${unitPrefs.temperature})` },
        { key: 'statorRer', label: `${t('drivetrain.col.statorRer', 'Rear-Right')} — ${t('drivetrain.inverter', 'Inverter')} (${unitPrefs.temperature})` },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
          <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
          <YAxis tickFormatter={value => formatTemperature(Number(value))} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
          <Tooltip content={<ChartTooltip valueFormatter={value => formatTemperature(typeof value === 'number' ? value : null)} />} />
          <ChartLegend state={hidden} />
          <Line
            {...AREA_DEFAULTS}
            dataKey="stator"
            name={t('drivetrain.statorTemp', 'Stator Temp')}
            stroke="#ef4444"
            hide={hidden.isHidden('stator')}
          />
          <Line
            {...AREA_DEFAULTS}
            dataKey="statorRel"
            name={t('drivetrain.statorTempRearLeft', 'Rear-Left Stator Temp')}
            stroke="#a855f7"
            hide={hidden.isHidden('statorRel')}
          />
          <Line
            {...AREA_DEFAULTS}
            dataKey="statorRer"
            name={t('drivetrain.statorTempRearRight', 'Rear-Right Stator Temp')}
            stroke="#06b6d4"
            hide={hidden.isHidden('statorRer')}
          />
          {/* SI thresholds share the raw series scale; only text is formatted. */}
          <ReferenceLine
            y={60}
            stroke="#4ade80"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
            label={{
              value: `${t('drivetrain.normal', 'Normal')} · ${formatTemperature(60)}`,
              position: 'right', fill: '#4ade80', fontSize: 10,
            }}
          />
          <ReferenceLine
            y={80}
            stroke="#fbbf24"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
            label={{
              value: `${t('drivetrain.warm', 'Warm')} · ${formatTemperature(80)}`,
              position: 'right', fill: '#fbbf24', fontSize: 10,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </PreservedChartFrame>
  );
}
