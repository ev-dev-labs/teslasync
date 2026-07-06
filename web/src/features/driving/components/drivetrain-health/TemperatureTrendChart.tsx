import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ChartContainer,
  ChartTooltip,
  ChartGradient,
  AREA_DEFAULTS,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';

import type { ChartDataPoint } from './constants';
import { convertTempFromSI } from '@/lib/unitConversion';

interface TemperatureTrendChartProps {
  data: ChartDataPoint[];
  loading?: boolean;
}

export function TemperatureTrendChart({ data, loading = false }: TemperatureTrendChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;

  // The page hands us SI °C (`outsideTempAvgC`), but the Y-axis label, the
  // freezing/warm reference bands, and the a11y fallback table all read in the
  // user's display unit. Convert the plotted series to that same unit so every
  // layer shares one scale (identity in °C; the °F path previously plotted raw
  // Celsius under an "°F" axis with mis-scaled reference lines). A null reading
  // stays null so Recharts renders a gap and the fallback table shows "—".
  const chartData = useMemo(
    () =>
      (data ?? []).map((d) => ({
        date: d.date,
        outsideTemp: d.outsideTemp != null ? convertTempFromSI(d.outsideTemp, tempUnit) : null,
      })),
    [data, tempUnit],
  );

  // Reference bands are authored in SI °C; convert once to the display unit so
  // they land on the same axis as the converted series above.
  const warmZone = convertTempFromSI(35, tempUnit);
  const freezing = convertTempFromSI(0, tempUnit);

  const empty = chartData.length <= 1;

  return (
    <FadeIn delay={0.25}>
      <ChartContainer
        title={t('drivetrain.tempHistory', 'Temperature Trend')}
        subtitle={t('drivetrain.tempHistorySub', 'Outside temperature recorded during recent drives')}
        ariaLabel={t('drivetrain.tempHistory.aria', 'Outside temperature trend line chart per recent drive')}
        loading={loading}
        empty={empty}
        data={chartData}
        dataColumns={[
          { key: 'date', label: t('drivetrain.col.date', 'Date') },
          { key: 'outsideTemp', label: `${t('drivetrain.col.outside', 'Outside')} (${tempUnit})` },
        ]}
        height={300}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <defs>
              <ChartGradient id="dtTempGrad" color="#06b6d4" />
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
            <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <YAxis
              tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              label={{
                value: tempUnit,
                angle: -90,
                position: 'insideLeft',
                style: { fill: 'var(--text-muted)', fontSize: 11 },
              }}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Line
              {...AREA_DEFAULTS}
              dataKey="outsideTemp"
              name={t('drivetrain.outsideTemp', 'Outside Temp')}
              stroke="#06b6d4"
              dot={{ r: 3, fill: '#06b6d4' }}
            />
            <ReferenceLine
              y={warmZone}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{
                value: t('drivetrain.warmZone', 'Warm Zone'),
                fill: '#f59e0b',
                fontSize: 10,
              }}
            />
            <ReferenceLine
              y={freezing}
              stroke="#06b6d4"
              strokeDasharray="4 4"
              label={{
                value: t('drivetrain.freezing', 'Freezing'),
                fill: '#06b6d4',
                fontSize: 10,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    </FadeIn>
  );
}
