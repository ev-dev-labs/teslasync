import { useTranslation } from 'react-i18next';

import {
  ChartContainer,
  ChartTooltip,
  ChartGradient,
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
import { useSettings } from '@/hooks/useSettings';

import type { ChartDataPoint } from './constants';

interface TemperatureTrendChartProps {
  data: ChartDataPoint[];
}

export function TemperatureTrendChart({ data }: TemperatureTrendChartProps) {
  const { t } = useTranslation();
  const { convertTemp, tempUnit } = useSettings();

  if (data.length <= 1) return null;

  return (
    <FadeIn delay={0.25}>
      <ChartContainer
        title={t('drivetrain.tempHistory', 'Temperature Trend')}
        subtitle={t('drivetrain.tempHistorySub', 'Outside temperature recorded during recent drives')}
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
              type="monotone"
              dataKey="outsideTemp"
              name={t('drivetrain.outsideTemp', 'Outside Temp')}
              stroke="#06b6d4"
              strokeWidth={2}
              dot={{ r: 3, fill: '#06b6d4' }}
              connectNulls
            />
            <ReferenceLine
              y={convertTemp(35)}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{
                value: t('drivetrain.warmZone', 'Warm Zone'),
                fill: '#f59e0b',
                fontSize: 10,
              }}
            />
            <ReferenceLine
              y={convertTemp(0)}
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
