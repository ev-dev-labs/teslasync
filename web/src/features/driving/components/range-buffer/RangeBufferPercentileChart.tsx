import {
  Bar,
  CartesianGrid,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import type { HiddenSeriesState } from '@/hooks/useHiddenSeries';

export type RangeBufferProfileChartRow = {
  key: string;
  label: string;
  samples: number;
  p10Pct: number | null;
  medianPct: number | null;
  p90Pct: number | null;
  contextPct?: number | null;
};

interface RangeBufferPercentileChartProps {
  rows: RangeBufferProfileChartRow[];
  samplesName: string;
  p10Name: string;
  medianName: string;
  p90Name: string;
  contextName?: string;
  hiddenSeries: HiddenSeriesState | null;
}

export function RangeBufferPercentileChart({
  rows,
  samplesName,
  p10Name,
  medianName,
  p90Name,
  contextName,
  hiddenSeries,
}: RangeBufferPercentileChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--glass-border)"
          strokeOpacity={0.4}
        />
        <XAxis
          dataKey="label"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <YAxis
          yAxisId="percent"
          domain={[0, 100]}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="count"
          orientation="right"
          allowDecimals={false}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<ChartTooltip />} />
        <ChartLegend verticalAlign="top" align="right" />
        <Bar
          yAxisId="count"
          dataKey="samples"
          name={samplesName}
          fill={CHART_COLORS[4]}
          fillOpacity={0.3}
          radius={[3, 3, 0, 0]}
          hide={hiddenSeries?.isHidden('samples') ?? false}
        />
        <Line
          yAxisId="percent"
          type="monotone"
          dataKey="p10Pct"
          name={p10Name}
          stroke={CHART_COLORS[3]}
          strokeWidth={2}
          connectNulls={false}
          hide={hiddenSeries?.isHidden('p10Pct') ?? false}
        />
        <Line
          yAxisId="percent"
          type="monotone"
          dataKey="medianPct"
          name={medianName}
          stroke={CHART_COLORS[0]}
          strokeWidth={2.5}
          connectNulls={false}
          hide={hiddenSeries?.isHidden('medianPct') ?? false}
        />
        <Line
          yAxisId="percent"
          type="monotone"
          dataKey="p90Pct"
          name={p90Name}
          stroke={CHART_COLORS[2]}
          strokeWidth={2}
          connectNulls={false}
          hide={hiddenSeries?.isHidden('p90Pct') ?? false}
        />
        {contextName ? (
          <Line
            yAxisId="percent"
            type="monotone"
            dataKey="contextPct"
            name={contextName}
            stroke={CHART_COLORS[5]}
            strokeWidth={2}
            strokeDasharray="5 4"
            connectNulls={false}
            hide={hiddenSeries?.isHidden('contextPct') ?? false}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
