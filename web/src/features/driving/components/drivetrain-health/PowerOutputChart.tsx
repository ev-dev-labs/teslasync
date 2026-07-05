import { useMemo } from 'react';
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
  loading?: boolean;
}

export function PowerOutputChart({ data, loading = false }: PowerOutputChartProps) {
  const { t } = useTranslation();

  // URL-persisted hidden-series state lets users declutter to one trace.
  const hidden = useHiddenSeries('drivetrain-power-output');

  // `data` is typed non-null, but the drivetrain-health data hook can hand
  // down `undefined` transiently while the drives query is still loading —
  // guard before `.length` / `.map` so a mid-fetch render never throws.
  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const empty = rows.length <= 1;

  // Shape the screen-reader / forced-colors fallback table once per data
  // change (keeps a stable array reference out of the ChartContainer prop on
  // unrelated re-renders) and coerce nullish samples to 0 for the cells.
  const tableData = useMemo(
    () =>
      rows.map((d) => ({
        date: d.date ?? '—',
        power_max_kw: d.powerMax ?? 0,
        power_min_kw: d.powerMin ?? 0,
      })),
    [rows],
  );

  return (
    <FadeIn delay={0.3}>
      <ChartContainer
        title={t('drivetrain.powerOutput', 'Power Output History')}
        subtitle={t('drivetrain.powerOutputSub', 'Peak and regen power per drive over time')}
        ariaLabel={t('drivetrain.powerOutput.aria', 'Per-drive peak and regen motor power output history area chart')}
        chartKey="drivetrain-power-output"
        loading={loading}
        empty={empty}
        data={tableData}
        dataColumns={[
          { key: 'date', label: t('drivetrain.col.date', 'Date') },
          { key: 'power_max_kw', label: t('drivetrain.col.powerMax', 'Peak (kW)') },
          { key: 'power_min_kw', label: t('drivetrain.col.powerMin', 'Regen (kW)') },
        ]}
        height={300}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows}>
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
