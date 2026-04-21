import { useTranslation } from 'react-i18next';

import {
  ChartContainer,
  ChartTooltip,
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

import type { MotorChartDataPoint } from './constants';

interface StatorTempChartProps {
  data: MotorChartDataPoint[];
}

export function StatorTempChart({ data }: StatorTempChartProps) {
  const { t } = useTranslation();
  const { convertTemp, tempUnit } = useSettings();

  if (data.length <= 1) return null;

  return (
    <FadeIn delay={0.23}>
      <ChartContainer
        title={t('drivetrain.statorTempHistory', 'Stator Temperature History')}
        subtitle={t('drivetrain.statorTempSub', 'Motor stator temperature over recent snapshots')}
        height={280}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="stator"
              name={`${t('drivetrain.statorTemp', 'Stator Temp')} (${tempUnit})`}
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="statorRel"
              name={`${t('drivetrain.statorTempRearLeft', 'Rear-Left Stator Temp')} (${tempUnit})`}
              stroke="#a855f7"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="statorRer"
              name={`${t('drivetrain.statorTempRearRight', 'Rear-Right Stator Temp')} (${tempUnit})`}
              stroke="#06b6d4"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <ReferenceLine
              y={convertTemp(60)}
              stroke="#4ade80"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: t('drivetrain.normal', 'Normal'), position: 'right', fill: '#4ade80', fontSize: 10 }}
            />
            <ReferenceLine
              y={convertTemp(80)}
              stroke="#fbbf24"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: t('drivetrain.warm', 'Warm'), position: 'right', fill: '#fbbf24', fontSize: 10 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    </FadeIn>
  );
}
