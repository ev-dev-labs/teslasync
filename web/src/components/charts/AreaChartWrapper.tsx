import { forwardRef } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { cn } from '@/lib/cn';

interface SeriesConfig {
  key: string;
  label: string;
  color: string;
}

interface AreaChartWrapperProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesConfig[];
  height?: number;
  xFormatter?: (value: string) => string;
  yFormatter?: (value: number) => string;
  className?: string;
}

export const AreaChartWrapper = forwardRef<HTMLDivElement, AreaChartWrapperProps>(
  function AreaChartWrapper(
    { data, xKey, series, height = 300, xFormatter, yFormatter, className },
    ref,
  ) {
    return (
      <div ref={ref} className={cn('w-full', className)}>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`gradient-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>

            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />

            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 11 }}
              tickFormatter={xFormatter}
              className="text-gray-500 dark:text-gray-400"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={yFormatter}
              className="text-gray-500 dark:text-gray-400"
            />

            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(17, 24, 39, 0.95)',
                border: '1px solid rgba(75, 85, 99, 0.5)',
                borderRadius: 8,
                fontSize: 12,
                color: '#e5e7eb',
              }}
              formatter={(value: number, name: string) => {
                const s = series.find((s) => s.key === name);
                const formatted = yFormatter ? yFormatter(value) : value;
                return [formatted, s?.label ?? name];
              }}
              labelFormatter={xFormatter}
            />

            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.key}
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#gradient-${s.key})`}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  },
);
