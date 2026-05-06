import { useTranslation } from 'react-i18next';

import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  AREA_DEFAULTS,
  areaGradient,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';

import type { ChartDataPoint } from './constants';

interface PowerOutputChartProps {
  data: ChartDataPoint[];
}

export function PowerOutputChart({ data }: PowerOutputChartProps) {
  const { t } = useTranslation();

  // Phase-46 / Prompt 67 — URL-persisted hidden-series state for the
  // peak vs regen power chart so users can declutter to a single trace.
  const hidden = useHiddenSeries('drivetrain-power-output');

  if (data.length <= 1) return null;

  return (
    <FadeIn delay={0.3}>
      <ChartContainer
        title={t('drivetrain.powerOutput', 'Power Output History')}
        subtitle={t('drivetrain.powerOutputSub', 'Peak and regen power per drive over time')}
        ariaLabel={t('drivetrain.powerOutput.aria', 'Per-drive peak and regen motor power output history area chart')}
        chartKey="drivetrain-power-output"
        data={data.map((d) => ({
          date: d.date,
          power_max_kw: d.powerMax,
          power_min_kw: d.powerMin,
        }))}
        dataColumns={[
          { key: 'date', label: t('drivetrain.col.date', 'Date') },
          { key: 'power_max_kw', label: t('drivetrain.col.powerMax', 'Peak (kW)') },
          { key: 'power_min_kw', label: t('drivetrain.col.powerMin', 'Regen (kW)') },
        ]}
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
            <ChartLegend state={hidden} />
            <Area
              {...AREA_DEFAULTS}
              dataKey="powerMax"
              name={t('drivetrain.powerMax', 'Peak Power (kW)')}
              stroke="#8b5cf6"
              fill="url(#dtPwrMaxGrad)"
              hide={hidden.isHidden('powerMax')}
            />
            <Area
              {...AREA_DEFAULTS}
              dataKey="powerMin"
              name={t('drivetrain.powerMin', 'Regen Power (kW)')}
              stroke="#ef4444"
              fill="url(#dtPwrMinGrad)"
              hide={hidden.isHidden('powerMin')}
            />
            <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </FadeIn>
  );
}
