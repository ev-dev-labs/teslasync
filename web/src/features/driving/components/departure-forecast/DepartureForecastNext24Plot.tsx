import {
  Bar,
  CartesianGrid,
  Cell,
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
import { fmtNumber } from '@/lib/numberFormat';

export interface DepartureForecastNext24Row {
  slotId: number;
  slot: string;
  likelihood: number;
  cumulative: number;
  departures: number;
  occurrences: number;
  support: string;
  isPeak: boolean;
}

interface DepartureForecastNext24PlotProps {
  rows: DepartureForecastNext24Row[];
  likelihoodName: string;
  cumulativeName: string;
  locale: string;
  hiddenSeries: HiddenSeriesState | null;
}

export function DepartureForecastNext24Plot({
  rows,
  likelihoodName,
  cumulativeName,
  locale,
  hiddenSeries,
}: DepartureForecastNext24PlotProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--glass-border)"
          strokeOpacity={0.4}
        />
        <XAxis
          dataKey="slot"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          interval={2}
        />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          domain={[0, 100]}
          unit="%"
        />
        <Tooltip
          content={
            <ChartTooltip
              valueFormatter={(value) =>
                `${fmtNumber(value, 1, locale)}%`
              }
            />
          }
        />
        <ChartLegend verticalAlign="top" align="right" />
        <Bar
          dataKey="likelihood"
          name={likelihoodName}
          radius={[3, 3, 0, 0]}
          hide={hiddenSeries?.isHidden('likelihood') ?? false}
        >
          {rows.map((row) => (
            <Cell
              key={row.slotId}
              fill={
                row.isPeak
                  ? CHART_COLORS[3]
                  : row.departures > 0
                    ? CHART_COLORS[0]
                    : CHART_COLORS[4]
              }
              fillOpacity={row.departures > 0 ? 0.9 : 0.35}
            />
          ))}
        </Bar>
        <Line
          type="monotone"
          dataKey="cumulative"
          name={cumulativeName}
          stroke={CHART_COLORS[2]}
          strokeWidth={2}
          dot={false}
          hide={hiddenSeries?.isHidden('cumulative') ?? false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
