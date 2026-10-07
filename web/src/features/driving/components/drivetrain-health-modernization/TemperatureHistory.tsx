import { useTranslation } from 'react-i18next';
import {
  ChartTooltip, ChartGradient, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, AREA_DEFAULTS,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { PreservedChartFrame } from './PreservedChartFrame';
import type { DriveHistoryChartProps } from './chartTypes';

export function TemperatureHistory({ rows, state, loading }: DriveHistoryChartProps) {
  const { t } = useTranslation();
  const { formatTemperature, unitPrefs } = useUnits();
  const tempRows = rows.filter(row => row.outsideTemp != null);
  const table = tempRows.map(row => ({
    date: row.date,
    outsideTemp: formatTemperature(row.outsideTemp),
  }));
  return (
    <PreservedChartFrame
      state={state}
      title={t('drivetrain.tempHistory', 'Temperature Trend')}
      subtitle={t('drivetrain.tempHistorySub', 'Outside temperature recorded during recent drives')}
      ariaLabel={t('drivetrain.tempHistory.aria', 'Outside temperature trend line chart per recent drive')}
      height={300}
      loading={loading && !state.hasData}
      empty={tempRows.length <= 1}
      data={table}
      exportData={table}
      dataColumns={[
        { key: 'date', label: t('drivetrain.col.date', 'Date') },
        { key: 'outsideTemp', label: `${t('drivetrain.outsideTemp', 'Outside Temp')} (${unitPrefs.temperature})` },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={tempRows}>
          <defs><ChartGradient id="dtTempGrad" color="#06b6d4" /></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
          <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
          <YAxis tickFormatter={value => formatTemperature(Number(value))} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
          <Tooltip content={<ChartTooltip valueFormatter={value => formatTemperature(typeof value === 'number' ? value : null)} />} />
          <Legend />
          <Line
            {...AREA_DEFAULTS}
            dataKey="outsideTemp"
            name={t('drivetrain.outsideTemp', 'Outside Temp')}
            stroke="#06b6d4"
            dot={{ r: 3, fill: '#06b6d4' }}
          />
          <ReferenceLine
            y={35}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            label={{
              value: `${t('drivetrain.warmZone', 'Warm Zone')} · ${formatTemperature(35)}`,
              fill: '#f59e0b', fontSize: 10,
            }}
          />
          <ReferenceLine
            y={0}
            stroke="#06b6d4"
            strokeDasharray="4 4"
            label={{
              value: `${t('drivetrain.freezing', 'Freezing')} · ${formatTemperature(0)}`,
              fill: '#06b6d4', fontSize: 10,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </PreservedChartFrame>
  );
}
