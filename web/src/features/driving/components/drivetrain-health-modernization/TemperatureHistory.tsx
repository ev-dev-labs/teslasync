import { useTranslation } from 'react-i18next';
import {
  ChartTooltip, ChartGradient, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, AREA_DEFAULTS,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { chartTokens } from '@/lib/tokens';
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';
import { PreservedChartFrame } from './PreservedChartFrame';
import type { DriveHistoryChartProps } from './chartTypes';

export function TemperatureHistory({ rows, state, loading }: DriveHistoryChartProps) {
  const { t } = useTranslation();
  const { formatTemperature, unitPrefs } = useUnits();
  const chartText = {
    fill: chartTokens.axisStroke,
    fontSize: getChartFontSize(12),
    fontFamily: getChartFontFamily(),
  };
  const measuredCount = rows.filter(row => row.outsideTemp != null).length;
  const table = rows.map(row => ({
    date: row.date,
    outsideTemp: formatTemperature(row.outsideTemp),
  }));
  return (
    <PreservedChartFrame
      state={state}
      title={t('drivetrain.tempHistory', 'Temperature Trend')}
      subtitle={t('drivetrain.tempHistorySub', 'Outside temperature recorded during recent drives')}
      ariaLabel={t('drivetrain.tempHistoryAria', 'Outside temperature trend line chart per recent drive')}
      height={300}
      loading={loading && !state.hasData}
      empty={measuredCount <= 1}
      data={table}
      exportData={table}
      dataColumns={[
        { key: 'date', label: t('drivetrain.col.date', 'Date') },
        { key: 'outsideTemp', label: `${t('drivetrain.outsideTemp', 'Outside Temp')} (${unitPrefs.temperature})` },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows}>
          <defs><ChartGradient id="dtTempGrad" color={chartTokens.series[0]} /></defs>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
          <XAxis dataKey="date" tick={chartText} />
          <YAxis tickFormatter={value => formatTemperature(Number(value))} tick={chartText} />
          <Tooltip content={<ChartTooltip valueFormatter={value => formatTemperature(typeof value === 'number' ? value : null)} />} />
          <Legend />
          <Line
            {...AREA_DEFAULTS}
            dataKey="outsideTemp"
            name={t('drivetrain.outsideTemp', 'Outside Temp')}
            stroke={chartTokens.series[0]}
            dot={{ r: 3, fill: chartTokens.series[0] }}
          />
          <ReferenceLine
            y={35}
            stroke={chartTokens.series[2]}
            strokeDasharray="4 4"
            label={{
              value: `${t('drivetrain.warmZone', 'Warm Zone')} · ${formatTemperature(35)}`,
              ...chartText, fill: chartTokens.series[2],
            }}
          />
          <ReferenceLine
            y={0}
            stroke={chartTokens.series[0]}
            strokeDasharray="4 4"
            label={{
              value: `${t('drivetrain.freezing', 'Freezing')} · ${formatTemperature(0)}`,
              ...chartText, fill: chartTokens.series[0],
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </PreservedChartFrame>
  );
}
