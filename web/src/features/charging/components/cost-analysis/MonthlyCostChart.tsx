import { useCallback, useMemo } from 'react';
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

/**
 * Format a `YYYY-MM` bucket key as a compact `MM/YY` label. Shared by the
 * visible XAxis ticks and the screen-reader / forced-colors fallback table so
 * both read identically; any value that isn't a two-part `YYYY-MM` string (a
 * missing month coerced to the em dash, a stray key) is returned unchanged.
 */
function formatMonthShort(month: string): string {
  const parts = month.split('-');
  return parts.length === 2 ? `${parts[1]}/${parts[0].slice(2)}` : month;
}

export function MonthlyCostChart({ data, vehicleId, isLoading, error, onRetry }: MonthlyCostChartProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const { formatCurrency } = useFormatting();

  // Null-safe: a late/failed fetch can hand back undefined/null despite the
  // typed prop — degrade to the per-section empty state instead of crashing on
  // `.map` / `.length`. Missing per-row numerics coerce to 0 so neither the
  // Recharts area nor the fallback table can ever emit NaN.
  const chartData = useMemo(
    () => (data ?? []).map((d) => ({ month: d.month ?? '—', cost: d.cost ?? 0 })),
    [data],
  );
  const isEmpty = chartData.length === 0;

  const dataColumns = useMemo(
    () => [
      {
        key: 'month',
        label: t('costAnalysis.charts.col.month', 'Month'),
        format: (v: unknown) => formatMonthShort(String(v ?? '—')),
      },
      {
        key: 'cost',
        label: t('costAnalysis.charts.col.cost', 'Cost ($)'),
        format: (v: unknown) => formatCurrency(typeof v === 'number' ? v : 0, 2),
      },
    ],
    [t, formatCurrency],
  );

  const formatCostTick = useCallback(
    (v: number) => formatCurrency(v, 0),
    [formatCurrency],
  );

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
      data={chartData}
      dataColumns={dataColumns}
      height={260}
      loading={isLoading}
      empty={isEmpty}
      annotations={{ vehicleId, scope: 'cost', chartId: 'cost-monthly-trend' }}
    >
      {({ annotations: chartAnnotations }) => (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            {areaGradient('costGrad', palette[0])}
            <CartesianGrid {...chartGrid} />
            <XAxis
              dataKey="month"
              {...axisTickSm}
              tickFormatter={formatMonthShort}
            />
            <YAxis
              {...axisTickSm}
              tickFormatter={formatCostTick}
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
