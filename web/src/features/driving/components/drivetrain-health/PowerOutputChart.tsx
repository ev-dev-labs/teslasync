import { useTranslation } from 'react-i18next';

import {
  ChartContainer,
  ChartTooltip,
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
  areaGradient,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';

import type { ChartDataPoint } from './constants';

interface PowerOutputChartProps {
  data: ChartDataPoint[];
}

export function PowerOutputChart({ data }: PowerOutputChartProps) {
  const { t } = useTranslation();

  if (data.length <= 1) return null;

  return (
    <FadeIn delay={0.3}>
      <ChartContainer
        title={t('drivetrain.powerOutput', 'Power Output History')}
        subtitle={t('drivetrain.powerOutputSub', 'Peak and regen power per drive over time')}
        height={300}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            {areaGradient('dtPwrMaxGrad', '#8b5cf6')}
            {areaGradient('dtPwrMinGrad', '#ef4444')}
            <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
            <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <YAxis
              tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              label={{
                value: 'kW',
                angle: -90,
                position: 'insideLeft',
                style: { fill: 'var(--text-muted)', fontSize: 11 },
              }}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Area
              {...AREA_DEFAULTS}
              dataKey="powerMax"
              name={t('drivetrain.powerMax', 'Peak Power (kW)')}
              stroke="#8b5cf6"
              fill="url(#dtPwrMaxGrad)"
            />
            <Area
              {...AREA_DEFAULTS}
              dataKey="powerMin"
              name={t('drivetrain.powerMin', 'Regen Power (kW)')}
              stroke="#ef4444"
              fill="url(#dtPwrMinGrad)"
            />
            <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </FadeIn>
  );
}
