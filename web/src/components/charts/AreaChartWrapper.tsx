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

export interface SeriesConfig {
  key: string;
  label: string;
  color: string;
}

export interface AreaChartWrapperProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesConfig[];
  height?: number;
  xFormatter?: (value: string) => string;
  yFormatter?: (value: number) => string;
  className?: string;
  /**
   * Accessible name for the chart. When provided the wrapper exposes
   * `role="img"` so screen readers announce the otherwise-opaque SVG.
   */
  ariaLabel?: string;
}

/** Stable SVG gradient id for a series — shared by the `<defs>` and the `<Area fill>`. */
const gradientId = (key: string): string => `gradient-${key}`;

/**
 * Resolves a Recharts tooltip entry: maps the hovered `dataKey` to its
 * friendly series label (falling back to the raw key) and applies the
 * optional y-axis formatter to the value. Exported for direct unit testing
 * of the branch logic, which cannot be exercised through a jsdom hover.
 */
export function resolveAreaTooltip(
  series: SeriesConfig[],
  value: number,
  name: string,
  yFormatter?: (value: number) => string,
): [string | number, string] {
  const match = (series ?? []).find((s) => s.key === name);
  const formatted = yFormatter ? yFormatter(value) : value;
  return [formatted, match?.label ?? name];
}

export const AreaChartWrapper = forwardRef<HTMLDivElement, AreaChartWrapperProps>(
  function AreaChartWrapper(
    { data, xKey, series, height = 300, xFormatter, yFormatter, className, ariaLabel },
    ref,
  ) {
    const safeSeries = series ?? [];
    const safeData = data ?? [];

    return (
      <div
        ref={ref}
        className={cn('w-full', className)}
        role={ariaLabel ? 'img' : undefined}
        aria-label={ariaLabel}
      >
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={safeData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              {safeSeries.map((s) => (
                <linearGradient key={s.key} id={gradientId(s.key)} x1="0" y1="0" x2="0" y2="1">
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
              className="text-[var(--text-muted)]"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={yFormatter}
              className="text-[var(--text-muted)]"
            />

            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(17, 24, 39, 0.95)',
                border: '1px solid rgba(75, 85, 99, 0.5)',
                borderRadius: 8,
                fontSize: 12,
                color: '#e5e7eb',
              }}
              formatter={(value: number, name: string) =>
                resolveAreaTooltip(safeSeries, value, name, yFormatter)
              }
              labelFormatter={xFormatter}
            />

            {safeSeries.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.key}
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#${gradientId(s.key)})`}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  },
);
