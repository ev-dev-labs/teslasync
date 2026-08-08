import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  Cell,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { fmtInt } from '@/lib/numberFormat';

export interface DriveDnaDistributionRow {
  id: string;
  label: string;
  count: number;
  color: string;
}

interface DriveDnaDistributionBarPlotProps {
  rows: DriveDnaDistributionRow[];
  seriesName: string;
  categoryWidth: number;
  maxBarSize: number;
}

export function DriveDnaDistributionBarPlot({
  rows,
  seriesName,
  categoryWidth,
  maxBarSize,
}: DriveDnaDistributionBarPlotProps) {
  const { t } = useTranslation();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 10, right: 18, left: 38, bottom: 8 }}
      >
        {chartGrid}
        <XAxis
          type="number"
          allowDecimals={false}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={categoryWidth}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={
            <ChartTooltip
              valueFormatter={(value) =>
                t(
                  'driveDna.distributions.emissionValue',
                  '{{value}} emissions',
                  { value: fmtInt(value) },
                )
              }
            />
          }
        />
        <Bar
          dataKey="count"
          name={seriesName}
          radius={[0, 5, 5, 0]}
          maxBarSize={maxBarSize}
        >
          {rows.map((row) => (
            <Cell key={row.id} fill={row.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
