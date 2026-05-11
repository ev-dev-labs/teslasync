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
}

export function TemperatureTrendChart({ data }: TemperatureTrendChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;

  if (data.length <= 1) return null;

  return (
    <FadeIn delay={0.25}>
      <ChartContainer
        title={t('drivetrain.tempHistory', 'Temperature Trend')}
        subtitle={t('drivetrain.tempHistorySub', 'Outside temperature recorded during recent drives')}
        ariaLabel={t('drivetrain.tempHistory.aria', 'Outside temperature trend line chart per recent drive')}
        data={data.map((d) => ({ date: d.date, outsideTemp: d.outsideTemp }))}
        dataColumns={[
          { key: 'date', label: t('drivetrain.col.date', 'Date') },
          { key: 'outsideTemp', label: `${t('drivetrain.col.outside', 'Outside')} (${tempUnit})` },
        ]}
        height={300}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
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
              y={toTemperatureDisplay(35)}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{
                value: t('drivetrain.warmZone', 'Warm Zone'),
                fill: '#f59e0b',
                fontSize: 10,
              }}
            />
            <ReferenceLine
              y={toTemperatureDisplay(0)}
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
