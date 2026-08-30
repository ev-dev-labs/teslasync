import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { ChartContainer } from './ChartContainer';
import { ChartTooltip } from './ChartTooltip';
import { chartGrid, axisTick } from './chartUtils';
import { AREA_DEFAULTS, areaGradient } from './chartDefaults';
import { PillFilterBar, type PillItem } from '@/components/forms/PillFilterBar';

/**
 * Definition of one switchable metric inside {@link MetricSwitcherChart}.
 */
export interface MetricSwitcherMetric<P> {
  /** Stable key — used for active state, URL persistence. */
  key: string;
  /** Visible label on the pill. */
  label: string;
  /**
   * Visualisation type. `bar` is the safest default for count-like
   * metrics that may have many zero days; `area` and `line` work well
   * for continuous series like efficiency / score.
   */
  chart?: 'bar' | 'area' | 'line';
  /** Hex colour for the series fill / stroke. */
  color?: string;
  /** Optional accent for the active pill (defaults to cyan). */
  accent?: PillItem['accent'];
  /** Optional Y-axis unit suffix (e.g. " mi"). */
  unit?: string;
  /**
   * Per-metric value extractor. Receives the raw point and returns the
   * numeric Y value for that day. Defaults to `(p) => p.value` so the
   * canonical `{date, value}` shape is supported with zero config.
   */
  getValue?: (point: P) => number;
  /** Optional tooltip value formatter. */
  formatValue?: (value: number) => string;
  /**
   * Optional Y-axis tick formatter. Distinct from `formatValue` because
   * tooltips can show derived strings (e.g. a numeric average grade
   * rendered as "B") that would look weird as repeated axis labels.
   * Defaults to `formatValue` when not provided — opt out by setting
   * `formatTick: (v) => String(v)` for metrics where the tooltip is
   * categorical but the axis should stay numeric.
   */
  formatTick?: (value: number) => string;
}

export interface MetricSwitcherChartProps<P> {
  title: string;
  /** Localised string used as `aria-label` on the chart container. */
  ariaLabel: string;
  /**
   * Per-metric data series. Caller supplies the same shape per metric;
   * usually you'll memoise these so the chart only re-renders when the
   * underlying drives change.
   */
  series: Record<string, P[]>;
  metrics: readonly MetricSwitcherMetric<P>[];
  activeMetric: string;
  onMetricChange: (key: string) => void;
  /** Optional desktop-height override. The shared compact preset is used by default. */
  height?: number;
  /**
   * Optional X-axis tick formatter. Receives the raw `date` value (a
   * `YYYY-MM-DD` string for the canonical drives shape). Use to render
   * "Apr 24" instead of "2026-04-24" without duplicating the formatter
   * across every caller.
   */
  formatXTick?: (date: string) => string;
  /**
   * Empty-state message. Rendered when the active series is empty;
   * pass a localised string from the call site.
   */
  emptyMessage: string;
  /** Optional right-aligned actions appended to the title bar. */
  action?: ReactNode;
  /** Test hook on the outer container. */
  testId?: string;
}

const DEFAULT_X_KEY = 'date';

/**
 * `MetricSwitcherChart` — chart with a pill row above for switching the
 * displayed metric. Used by overview pages where one chart should answer
 * several questions ("Drives over time" / "Distance over time" / "Score
 * over time" / …) without dedicating a panel to each.
 *
 * The component owns layout + the pill bar; consumers own data shape
 * and per-metric chart type. Every metric uses the same x-axis key
 * (`date` by default, configured via `chart` shape inside the metric).
 *
 * Composition:
 * ```
 *   ┌── ChartContainer ──────────────────────────────────────────┐
 *   │  Title                              [pill row]   [actions] │
 *   ├────────────────────────────────────────────────────────────┤
 *   │  BarChart / AreaChart / LineChart depending on metric.chart │
 *   └────────────────────────────────────────────────────────────┘
 * ```
 */
export function MetricSwitcherChart<P extends { date: string }>({
  title,
  ariaLabel,
  series,
  metrics,
  activeMetric,
  onMetricChange,
  height,
  formatXTick,
  emptyMessage,
  action,
  testId,
}: MetricSwitcherChartProps<P>) {
  const { t } = useTranslation();
  const active = metrics.find((m) => m.key === activeMetric) ?? metrics[0];
  const data = active ? (series[active.key] ?? []) : [];
  const valueKey = '__value';

  const items: PillItem[] = useMemo(
    () =>
      metrics.map((m) => ({
        key: m.key,
        label: m.label,
        accent: m.accent,
      })),
    [metrics],
  );

  // Project P → {date, __value} so the chart layer doesn't need to know
  // the metric-specific accessor (kept as a closure on the metric).
  const projected = useMemo(() => {
    if (!active) return [];
    const get = active.getValue ?? ((p: P) => (p as unknown as { value: number }).value);
    return data.map((p) => ({ ...p, [valueKey]: get(p) }));
  }, [active, data]);

  const tooltipFormatter = (value: number | string): [string, string] => {
    const n = typeof value === 'number' ? value : Number(value);
    const formatted = active?.formatValue ? active.formatValue(n) : String(value);
    return [formatted, active?.label ?? ''];
  };

  // Y-axis tick formatter — prefer the metric's `formatTick`, fall back
  // to `formatValue` so callers that already pass `formatValue: v =>
  // "$" + v` get the dollar sign on the axis without extra config.
  const yTickFormatter = (value: number): string => {
    if (active?.formatTick) return active.formatTick(value);
    if (active?.formatValue) return active.formatValue(value);
    return String(value);
  };

  const xTickFormatter = formatXTick
    ? (value: string): string => formatXTick(value)
    : undefined;

  const chartType = active?.chart ?? 'bar';
  const color = active?.color ?? 'var(--theme-primary, #3b82f6)';
  const gradId = `metricSwitcherGrad-${active?.key ?? 'x'}`;

  const switcher = (
    <PillFilterBar
      items={items}
      activeKey={activeMetric}
      onChange={onMetricChange}
      ariaLabel={`${title} metric`}
      scrollable
      className="text-xs"
    />
  );

  // We slot the pill bar into ChartContainer's `action` area together
  // with any caller-provided actions so the title-bar layout stays clean.
  const combinedAction = (
    <div className="flex items-center gap-2">
      {switcher}
      {action}
    </div>
  );

  return (
    // chart-legend-audit:skip only one conditional metric series renders at a time.
    <ChartContainer
      title={title}
      ariaLabel={ariaLabel}
      size="compact"
      height={height}
      action={combinedAction}
      empty={projected.length === 0}
      emptyMessage={emptyMessage}
      data={projected}
      dataColumns={[
        { key: DEFAULT_X_KEY, label: t('chart.col.date', 'Date') },
        {
          key: valueKey,
          label: active?.label ?? t('chart.col.value', 'Value'),
          format: (value) => {
            const numeric = typeof value === 'number' ? value : Number(value);
            return active?.formatValue && Number.isFinite(numeric)
              ? active.formatValue(numeric)
              : String(value ?? '—');
          },
        },
      ]}
      data-testid={testId}
    >
      <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={projected}>
              {chartGrid}
              <XAxis
                dataKey={DEFAULT_X_KEY}
                type="category"
                tick={axisTick}
                tickFormatter={xTickFormatter}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis tick={axisTick} tickFormatter={yTickFormatter} />
              <Tooltip content={<ChartTooltip />} formatter={tooltipFormatter} />
              <Bar dataKey={valueKey} name={active?.label ?? ''} fill={color} fillOpacity={0.65} radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : chartType === 'area' ? (
            <AreaChart data={projected}>
              {areaGradient(gradId, color)}
              {chartGrid}
              <XAxis
                dataKey={DEFAULT_X_KEY}
                type="category"
                tick={axisTick}
                tickFormatter={xTickFormatter}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis tick={axisTick} tickFormatter={yTickFormatter} />
              <Tooltip content={<ChartTooltip />} formatter={tooltipFormatter} />
              <Area
                {...AREA_DEFAULTS}
                dataKey={valueKey}
                name={active?.label ?? ''}
                stroke={color}
                fill={`url(#${gradId})`}
              />
            </AreaChart>
          ) : (
            <LineChart data={projected}>
              {chartGrid}
              <XAxis
                dataKey={DEFAULT_X_KEY}
                type="category"
                tick={axisTick}
                tickFormatter={xTickFormatter}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis tick={axisTick} tickFormatter={yTickFormatter} />
              <Tooltip content={<ChartTooltip />} formatter={tooltipFormatter} />
              <Line type="monotone" dataKey={valueKey} name={active?.label ?? ''} stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          )}
      </ResponsiveContainer>
    </ChartContainer>
  );
}
