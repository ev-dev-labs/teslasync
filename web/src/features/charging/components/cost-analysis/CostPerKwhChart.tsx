import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import {
  ChartTooltip, chartGrid, axisTickSm,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, CHART_COLORS,
} from '@/components/charts';
import { fmtNumber } from '@/lib/numberFormat';

interface CostPerKwhChartProps {
  data: { date: string; costPerKwh: number }[];
}

export function CostPerKwhChart({ data }: CostPerKwhChartProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className="p-4">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <BarChart3 className="h-4 w-4 text-purple-400" />
        {t('costAnalysis.charts.costPerKwh', 'Cost per kWh Trend')}
      </h3>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="date" {...axisTickSm} />
            <YAxis
              {...axisTickSm}
              tickFormatter={(v: number) => `$${fmtNumber(v, 2)}`}
            />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="costPerKwh"
              name={t('costAnalysis.charts.rateLabel', '$/kWh')}
              stroke={CHART_COLORS[2]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-[260px] items-center justify-center text-sm text-gray-500">
          {t('costAnalysis.charts.noData', 'Not enough data')}
        </div>
      )}
    </GlassPanel>
  );
}
