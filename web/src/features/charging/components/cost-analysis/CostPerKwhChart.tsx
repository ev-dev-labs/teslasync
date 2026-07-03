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

interface CostPerKwhChartProps {
  data: { date: string; costPerKwh: number }[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function CostPerKwhChart({ data, isLoading, error, onRetry }: CostPerKwhChartProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const { formatCurrency } = useFormatting();

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
      data={data.map((d) => ({ date: d.date, costPerKwh: d.costPerKwh }))}
      dataColumns={[
        { key: 'date', label: t('costAnalysis.charts.col.date', 'Date') },
        { key: 'costPerKwh', label: t('costAnalysis.charts.rateLabel', '$/kWh') },
      ]}
      height={260}
      loading={isLoading}
      empty={data.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="date" {...axisTickSm} />
          <YAxis
            {...axisTickSm}
            tickFormatter={(v: number) => formatCurrency(v, 2)}
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
