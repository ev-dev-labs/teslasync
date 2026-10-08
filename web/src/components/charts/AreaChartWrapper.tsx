import { forwardRef, useId, useMemo } from 'react';
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
import { chartTokens } from '@/lib/tokens';
import { ChartTooltip } from './ChartTooltip';
import { ChartLegend } from './ChartLegend';
import { resolveChartHeights } from './chartSizing';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useMeasuredAxisWidth } from './useMeasuredAxisWidth';
import { useMotionPreference } from '@/hooks/useMotionPreference';

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
  /** Numeric Y-axis/tooltip semantics; count preserves integer tick labels. */
  kind?: 'measurement' | 'count';
  className?: string;
  /**
   * Accessible name for the chart. When provided the wrapper exposes
   * `role="img"` so screen readers announce the otherwise-opaque SVG.
   */
  ariaLabel?: string;
}

/** Stable SVG gradient id for a series — shared by the `<defs>` and the `<Area fill>`. */
const gradientId = (instanceId: string, key: string): string =>
  `gradient-${instanceId}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

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
    { data, xKey, series, height = 300, xFormatter, yFormatter, kind, className, ariaLabel },
    ref,
  ) {
    const safeSeries = series ?? [];
    const { reduce } = useMotionPreference();
    const { fmtNumber, fmtInt } = useNumberFormatting();
    const formatY = yFormatter ?? (kind === 'count'
      ? (value: number) => fmtInt(value)
      : kind === 'measurement' ? (value: number) => fmtNumber(value) : undefined);
    const safeData = data ?? [];
    const instanceId = useId().replace(/:/g, '');
    const chartHeight = resolveChartHeights('standard', height).desktop;
    const axisLabels = useMemo(() => {
      const labels = new Set([formatY ? formatY(0) : '0']);
      for (const row of safeData) {
        for (const item of safeSeries) {
          const value = row?.[item.key];
          if (typeof value === 'number' && Number.isFinite(value)) {
            labels.add(formatY ? formatY(value) : String(value));
          }
        }
      }
      return [...labels];
    }, [safeData, safeSeries, formatY]);
    const axisWidth = useMeasuredAxisWidth({ labels: axisLabels, fontSize: 11, minWidth: 60, padding: 24 });

    return (
      <div
        ref={ref}
        className={cn('w-full', className)}
        role={ariaLabel ? 'img' : undefined}
        aria-label={ariaLabel}
      >
        <ResponsiveContainer width="100%" height={chartHeight}>
          <AreaChart data={safeData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              {safeSeries.map((s) => (
                <linearGradient
                  key={s.key}
                  id={gradientId(instanceId, s.key)}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartTokens.gridStroke}
              strokeOpacity={0.4}
            />

            <XAxis
              dataKey={xKey}
              stroke={chartTokens.axisStroke}
              tick={{ fill: chartTokens.axisStroke, fontSize: 11 }}
              tickFormatter={xFormatter}
            />
            <YAxis
              width={axisWidth}
              stroke={chartTokens.axisStroke}
              tick={{ fill: chartTokens.axisStroke, fontSize: 11 }}
              tickFormatter={formatY}
            />

            <Tooltip
              cursor={chartTokens.cursor}
              content={(
                <ChartTooltip
                  valueFormatter={
                    formatY
                      ? (value) => value == null || !Number.isFinite(Number(value)) ? '—' : formatY(Number(value))
                      : undefined
                  }
                  labelFormatter={
                    xFormatter
                      ? (label) => xFormatter(String(label ?? ''))
                      : undefined
                  }
                />
              )}
            />
            {safeSeries.length > 1 ? <ChartLegend /> : null}

            {safeSeries.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                isAnimationActive={reduce ? false : undefined}
                fill={`url(#${gradientId(instanceId, s.key)})`}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  },
);
