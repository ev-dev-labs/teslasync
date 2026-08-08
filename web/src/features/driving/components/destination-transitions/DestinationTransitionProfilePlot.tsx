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
import { fmtNumber } from '@/lib/numberFormat';

export interface DestinationTransitionProfileRow {
  [key: string]: string | number | null | undefined;
  label: string;
  samples: number;
  origins: number;
  destinations: number;
  concentration: number | null;
  leadingShare: number | null;
  support: string;
}

interface DestinationTransitionProfilePlotProps {
  rows: DestinationTransitionProfileRow[];
  locale: string;
  countSeriesName: string;
  concentrationSeriesName: string;
  hiddenCount?: boolean;
  hiddenConcentration?: boolean;
}

export function DestinationTransitionProfilePlot({
  rows,
  locale,
  countSeriesName,
  concentrationSeriesName,
  hiddenCount = false,
  hiddenConcentration = false,
}: DestinationTransitionProfilePlotProps) {
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
          yAxisId="count"
          allowDecimals={false}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="index"
          orientation="right"
          domain={[0, 100]}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={
            <ChartTooltip
              valueFormatter={(value) => fmtNumber(value, 1, locale)}
            />
          }
        />
        <ChartLegend verticalAlign="top" align="right" />
        <Bar
          yAxisId="count"
          dataKey="samples"
          name={countSeriesName}
          fill={CHART_COLORS[0]}
          radius={[3, 3, 0, 0]}
          hide={hiddenCount}
        />
        <Line
          yAxisId="index"
          type="monotone"
          connectNulls={false}
          dataKey="concentration"
          name={concentrationSeriesName}
          stroke={CHART_COLORS[3]}
          strokeWidth={2}
          hide={hiddenConcentration}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
