import {
  Bar,
  BarChart,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { fmtInt } from '@/lib/numberFormat';

interface ParkingStartRow {
  label: string;
  stints: number;
}

interface ParkingStartBarChartProps {
  rows: ParkingStartRow[];
  seriesName: string;
  colorIndex: 0 | 2;
  interval: number;
}

/** Shared compact bar visual used by both local-time start profiles. */
export function ParkingStartBarChart({
  rows,
  seriesName,
  colorIndex,
  interval,
}: ParkingStartBarChartProps) {
  return (
    <div className="h-36 sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 8, right: 4, left: -20, bottom: 0 }}
        >
          {chartGrid}
          <XAxis
            dataKey="label"
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            interval={interval}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            content={
              <ChartTooltip valueFormatter={(value) => fmtInt(value)} />
            }
          />
          <Bar
            dataKey="stints"
            name={seriesName}
            fill={CHART_COLORS[colorIndex]}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
