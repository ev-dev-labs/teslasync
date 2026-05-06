import { useTranslation } from 'react-i18next';
import {
  ChartContainer,
  ChartTooltip, chartGrid, axisTickSm,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
  renderAnnotationLines,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts';
import { useChartPalette } from '@/hooks/useChartPalette';
import type { MonthlyBucket } from './types';

interface MonthlyCostChartProps {
  data: MonthlyBucket[];
  vehicleId: number | null;
}

export function MonthlyCostChart({ data, vehicleId }: MonthlyCostChartProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();

  return (
    <ChartContainer
      title={t('costAnalysis.charts.monthlyCost', 'Monthly Cost Trend')}
      ariaLabel={t('costAnalysis.charts.monthlyCost.aria', 'Monthly charging cost trend area chart')}
      data={data.map((d) => ({ month: d.month, cost: d.cost }))}
      dataColumns={[
        { key: 'month', label: t('costAnalysis.charts.col.month', 'Month') },
        { key: 'cost', label: t('costAnalysis.charts.col.cost', 'Cost ($)') },
      ]}
      height={260}
      annotations={{ vehicleId, scope: 'cost', chartId: 'cost-monthly-trend' }}
    >
      {({ annotations: chartAnnotations }) =>
        data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              {areaGradient('costGrad', palette[0])}
              <CartesianGrid {...chartGrid} />
              <XAxis
                dataKey="month"
                {...axisTickSm}
                tickFormatter={(v: string) => {
                  const parts = v.split('-');
                  return parts.length === 2 ? `${parts[1]}/${parts[0].slice(2)}` : v;
                }}
              />
              <YAxis
                {...axisTickSm}
                tickFormatter={(v: number) => `$${v}`}
              />
              <Tooltip content={<ChartTooltip />} />
              {renderAnnotationLines(chartAnnotations, (ts) => ts)}
              <Area
                {...AREA_DEFAULTS}
                dataKey="cost"
                name={t('costAnalysis.charts.cost', 'Cost ($)')}
                stroke={palette[0]}
                fill="url(#costGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
            {t('costAnalysis.charts.noData', 'Not enough data')}
          </div>
        )
      }
    </ChartContainer>
  );
}
