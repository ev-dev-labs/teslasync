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
import { useFormatting } from '@/hooks/useFormatting';
import { CostSection } from './CostSection';
import type { MonthlyBucket } from './types';

interface MonthlyCostChartProps {
  data: MonthlyBucket[];
  vehicleId: number | null;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function MonthlyCostChart({ data, vehicleId, isLoading, error, onRetry }: MonthlyCostChartProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const { formatCurrency } = useFormatting();

  if (error) {
    return (
      <CostSection
        title={t('costAnalysis.charts.monthlyCost', 'Monthly Cost Trend')}
        error={error}
        onRetry={onRetry}
      >
        {null}
      </CostSection>
    );
  }

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
      loading={isLoading}
      empty={data.length === 0}
      annotations={{ vehicleId, scope: 'cost', chartId: 'cost-monthly-trend' }}
    >
      {({ annotations: chartAnnotations }) => (
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
              tickFormatter={(v: number) => formatCurrency(v, 0)}
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
      )}
    </ChartContainer>
  );
}
