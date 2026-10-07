import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartContainer,
  ChartTooltip, chartGrid, axisTickSm,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AREA_DEFAULTS,
} from '@/components/charts';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useFormatting } from '@/hooks/useFormatting';
import { CostSection } from './CostSection';

/** A single point on the cost-per-kWh trend line. Declared as a `type` alias
 *  (not an `interface`) so it carries an implicit index signature and stays
 *  assignable to ChartContainer's `ChartDataRow` fallback-table shape. */
type CostPerKwhPoint = {
  date: string;
  costPerKwh: number;
};

interface CostPerKwhChartProps {
  data: CostPerKwhPoint[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function CostPerKwhChart({ data, isLoading, error, onRetry }: CostPerKwhChartProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const { formatCurrency } = useFormatting();

  // Null-safe, memoised single source of truth. Callers may hand us `undefined`
  // at runtime (e.g. before sessions have loaded) despite the non-optional prop
  // type, so we guard the array before mapping and coerce each field. The SAME
  // rows feed the visual line chart, the ChartContainer screen-reader fallback
  // table and the CSV export so the three can never diverge.
  const rows = useMemo<CostPerKwhPoint[]>(
    () =>
      (data ?? []).map((d) => ({
        date: d.date ?? '',
        costPerKwh: d.costPerKwh ?? 0,
      })),
    [data],
  );

  // Stable currency tick formatter so the Y axis isn't handed a fresh closure
  // on every render.
  const formatRate = useCallback((v: number) => formatCurrency(v, 2), [formatCurrency]);

  if (error) {
    return (
      <CostSection
        title={t('costAnalysis.charts.costPerKwh', 'Cost per kWh Trend')}
        error={error}
        onRetry={onRetry}
      >
        {null}
      </CostSection>
    );
  }

  return (
    <ChartContainer
      title={t('costAnalysis.charts.costPerKwh', 'Cost per kWh Trend')}
      ariaLabel={t('costAnalysis.charts.costPerKwh.aria', 'Cost per kilowatt-hour trend line chart')}
      data={rows}
      dataColumns={[
        { key: 'date', label: t('costAnalysis.charts.col.date', 'Date') },
        { key: 'costPerKwh', label: t('costAnalysis.charts.rateLabel', '$/kWh') },
      ]}
      height={260}
      loading={isLoading}
      empty={rows.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows}>
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="date" {...axisTickSm} />
          <YAxis
            {...axisTickSm}
            tickFormatter={formatRate}
          />
          <Tooltip content={<ChartTooltip />} />
          <Line
            {...AREA_DEFAULTS}
            dataKey="costPerKwh"
            name={t('costAnalysis.charts.rateLabel', '$/kWh')}
            stroke={palette[2]}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
