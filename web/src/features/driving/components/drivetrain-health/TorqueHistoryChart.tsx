import { useTranslation } from 'react-i18next';

import {
  ChartContainer,
  ChartTooltip,
  ChartGradient,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';

import type { MotorChartDataPoint } from './constants';

interface TorqueHistoryChartProps {
  data: MotorChartDataPoint[];
}

export function TorqueHistoryChart({ data }: TorqueHistoryChartProps) {
  const { t } = useTranslation();

  if (data.length <= 1 || !data.some((d) => d.torque !== null)) return null;

  return (
    <FadeIn delay={0.24}>
      <ChartContainer
        title={t('drivetrain.torqueHistory', 'Motor Torque')}
        subtitle={t('drivetrain.torqueHistorySub', 'Drive inverter torque output over time')}
        ariaLabel={t('drivetrain.torqueHistory.aria', 'Motor inverter torque output history area chart')}
        data={data.map((d) => ({ time: d.time, torque: d.torque }))}
        dataColumns={[
          { key: 'time', label: t('drivetrain.col.time', 'Time') },
          { key: 'torque', label: t('drivetrain.col.torque', 'Torque (Nm)') },
        ]}
        height={280}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <ChartGradient id="dtTorqueGrad" color="#00f0ff" />
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Area
              {...AREA_DEFAULTS}
              dataKey="torque"
              name={`${t('drivetrain.torque', 'Torque')} (Nm)`}
              stroke="#00f0ff"
              fill="url(#dtTorqueGrad)"
            />
            <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </FadeIn>
  );
}
