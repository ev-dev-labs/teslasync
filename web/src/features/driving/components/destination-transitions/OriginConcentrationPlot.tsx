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

export interface OriginConcentrationRow {
  [key: string]: string | number | null | undefined;
  origin: string;
  concentration: number;
  leadingShare: number;
  outgoing: number;
  successors: number;
  supportIndex: number;
  support: string;
}

interface OriginConcentrationPlotProps {
  rows: OriginConcentrationRow[];
  locale: string;
  concentrationName: string;
  leadingName: string;
  hiddenConcentration: boolean;
  hiddenLeadingShare: boolean;
}

export function OriginConcentrationPlot({
  rows,
  locale,
  concentrationName,
  leadingName,
  hiddenConcentration,
  hiddenLeadingShare,
}: OriginConcentrationPlotProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--glass-border)"
          strokeOpacity={0.4}
        />
        <XAxis
          dataKey="origin"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <YAxis
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
          dataKey="concentration"
          name={concentrationName}
          fill={CHART_COLORS[1]}
          radius={[3, 3, 0, 0]}
          hide={hiddenConcentration}
        />
        <Line
          type="monotone"
          dataKey="leadingShare"
          name={leadingName}
          stroke={CHART_COLORS[2]}
          strokeWidth={2}
          hide={hiddenLeadingShare}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
