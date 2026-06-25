// Native parity port of web/src/components/charts/MetricSwitcherChart.tsx.
// Replaces Recharts and the web PillFilterBar with React Native primitives
// while preserving the metric-switching API, active metric state, and formatters.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../components/feedback/EmptyState';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {ChartContainer} from './ChartContainer';
import {ChartTooltip} from './ChartTooltip';

type MetricChartType = 'bar' | 'area' | 'line';
type PillAccent = 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'blue';

interface PillItem {
  key: string;
  label: string;
  accent?: PillAccent;
  disabled?: boolean;
}

/**
 * Definition of one switchable metric inside {@link MetricSwitcherChart}.
 */
export interface MetricSwitcherMetric<P> {
  /** Stable key -- used for active state, URL persistence. */
  key: string;
  /** Visible label on the pill. */
  label: string;
  /**
   * Visualisation type. `bar` is the safest default for count-like
   * metrics that may have many zero days; `area` and `line` work well
   * for continuous series like efficiency / score.
   */
  chart?: MetricChartType;
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
   * Defaults to `formatValue` when not provided -- opt out by setting
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
  /** Optional override for chart height. Defaults to 220. */
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
const VALUE_KEY = '__value';
const GRID_LINES = [0, 50, 100] as const;
const MIN_SAMPLE_WIDTH = 18;
const MIN_PLOT_WIDTH = 220;

type ProjectedPoint<P> = P & {[VALUE_KEY]: number};

interface Domain {
  min: number;
  max: number;
}

interface IndexedPoint<P> {
  index: number;
  point: ProjectedPoint<P>;
}

/**
 * `MetricSwitcherChart` -- chart with a pill row above for switching the
 * displayed metric. Used by overview pages where one chart should answer
 * several questions ("Drives over time" / "Distance over time" / "Score
 * over time" / ...) without dedicating a panel to each.
 *
 * The component owns layout + the pill bar; consumers own data shape
 * and per-metric chart type. Every metric uses the same x-axis key
 * (`date` by default, configured via `chart` shape inside the metric).
 */
export function MetricSwitcherChart<P extends {date: string}>({
  title,
  ariaLabel,
  series,
  metrics,
  activeMetric,
  onMetricChange,
  height = 220,
  formatXTick,
  emptyMessage,
  action,
  testId,
}: MetricSwitcherChartProps<P>) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const active = metrics.find(m => m.key === activeMetric) ?? metrics[0];
  const activeKey = active?.key;
  const data = useMemo(
    () => (activeKey ? series[activeKey] ?? [] : []),
    [activeKey, series],
  );
  const valueKey = VALUE_KEY;

  const items: PillItem[] = useMemo(
    () =>
      metrics.map(m => ({
        key: m.key,
        label: m.label,
        accent: m.accent,
      })),
    [metrics],
  );

  // Project P -> {date, __value} so the chart layer does not need to know
  // the metric-specific accessor (kept as a closure on the metric).
  const projected = useMemo(() => {
    if (!active) {
      return [];
    }
    const get =
      active.getValue ??
      ((p: P) => {
        const raw = (p as P & {value?: number}).value;
        return typeof raw === 'number' ? raw : 0;
      });
    return data.map(
      p =>
        ({
          ...p,
          [valueKey]: safeFiniteNumber(get(p)),
        }) as ProjectedPoint<P>,
    );
  }, [active, data, valueKey]);

  useEffect(() => {
    setSelectedIndex(null);
  }, [activeMetric, projected.length]);

  const tooltipFormatter = useCallback(
    (value: number | string): [string, string] => {
      const n = typeof value === 'number' ? value : Number(value);
      const formatted = active?.formatValue ? active.formatValue(n) : String(value);
      return [formatted, active?.label ?? ''];
    },
    [active],
  );

  // Y-axis tick formatter -- prefer the metric's `formatTick`, fall back
  // to `formatValue` so callers that already pass `formatValue: v =>
  // "$" + v` get the dollar sign on the axis without extra config.
  const yTickFormatter = useCallback(
    (value: number): string => {
      if (active?.formatTick) {
        return active.formatTick(value);
      }
      if (active?.formatValue) {
        return active.formatValue(value);
      }
      return String(value);
    },
    [active],
  );

  const xTickFormatter = useMemo(
    () =>
      formatXTick
        ? (value: string): string => formatXTick(value)
        : undefined,
    [formatXTick],
  );

  const chartType = active?.chart ?? 'bar';
  const color = active?.color ?? '#00f0ff';
  const domain = useMemo(() => buildDomain(projected), [projected]);
  const yTicks = useMemo(
    () => [domain.max, (domain.max + domain.min) / 2, domain.min],
    [domain],
  );
  const xTicks = useMemo(() => pickXTicks(projected), [projected]);
  const selectedPoint = pickSelectedPoint(projected, selectedIndex);
  const plotWidth = Math.max(
    MIN_PLOT_WIDTH,
    projected.length * MIN_SAMPLE_WIDTH,
  );
  const selectedLabel = selectedPoint
    ? formatDateLabel(selectedPoint.point[DEFAULT_X_KEY], xTickFormatter)
    : '';
  const [selectedValue] = selectedPoint
    ? tooltipFormatter(selectedPoint.point[VALUE_KEY])
    : ['', ''];

  const switcher = (
    <PillFilterBar
      ariaLabel={`${title} metric`}
      activeKey={activeMetric}
      items={items}
      onChange={onMetricChange}
      scrollable
    />
  );

  // We slot the pill bar into ChartContainer's `action` area together
  // with any caller-provided actions so the title-bar layout stays clean.
  const combinedAction = (
    <View style={styles.actionRow}>
      {switcher}
      {action}
    </View>
  );

  return (
    <ChartContainer
      ariaLabel={ariaLabel}
      height={height}
      action={combinedAction}
      testID={testId}
      title={title}>
      {projected.length === 0 ? (
        <EmptyState message={emptyMessage} title={title} />
      ) : (
        <View style={styles.root}>
          <View style={styles.chartFrame}>
            <View style={styles.yAxis}>
              {yTicks.map((tick, index) => (
                <AppText
                  key={`${tick}-${index}`}
                  numberOfLines={1}
                  style={styles.axisLabel}
                  variant="caption">
                  {yTickFormatter(tick)}
                </AppText>
              ))}
            </View>

            <View style={styles.plotColumn}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[
                  styles.plotScroller,
                  {minWidth: plotWidth},
                ]}>
                <View style={styles.plotStack}>
                  <View
                    accessible
                    accessibilityLabel={ariaLabel}
                    accessibilityRole="image"
                    style={styles.plotArea}>
                    {GRID_LINES.map(line => (
                      <View
                        key={`grid-${line}`}
                        pointerEvents="none"
                        style={[
                          styles.gridLine,
                          {top: `${line}%` as DimensionValue},
                        ]}
                      />
                    ))}

                    <View style={styles.seriesLayer}>
                      {projected.map((point, index) => {
                        const selected = selectedPoint?.index === index;
                        return (
                          <Pressable
                            key={`${point[DEFAULT_X_KEY]}-${index}`}
                            accessibilityLabel={`${active?.label ?? title}: ${
                              tooltipFormatter(point[VALUE_KEY])[0]
                            } on ${formatDateLabel(
                              point[DEFAULT_X_KEY],
                              xTickFormatter,
                            )}`}
                            accessibilityRole="button"
                            accessibilityState={{selected}}
                            onPress={() => setSelectedIndex(index)}
                            style={({pressed}) => [
                              styles.sample,
                              pressed && styles.samplePressed,
                            ]}>
                            <SeriesSample
                              chartType={chartType}
                              color={color}
                              domain={domain}
                              selected={selected}
                              value={point[VALUE_KEY]}
                            />
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View style={styles.xAxis}>
                    {xTicks.map(tick => (
                      <AppText
                        key={`${tick.index}-${tick.point[DEFAULT_X_KEY]}`}
                        numberOfLines={1}
                        style={styles.xAxisLabel}
                        variant="caption">
                        {formatDateLabel(
                          tick.point[DEFAULT_X_KEY],
                          xTickFormatter,
                        )}
                      </AppText>
                    ))}
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>

          <ChartTooltip
            active={Boolean(selectedPoint)}
            label={selectedLabel}
            payload={[
              {
                color,
                dataKey: valueKey,
                fill: color,
                name: active?.label ?? '',
                value: selectedValue,
              },
            ]}
            valueFormatter={value => String(value ?? '')}
          />
        </View>
      )}
    </ChartContainer>
  );
}

interface PillFilterBarProps {
  items: readonly PillItem[];
  activeKey: string;
  onChange: (key: string) => void;
  ariaLabel: string;
  scrollable?: boolean;
}

function PillFilterBar({
  items,
  activeKey,
  onChange,
  ariaLabel,
  scrollable = true,
}: PillFilterBarProps) {
  const content = (
    <View
      accessibilityLabel={ariaLabel}
      accessibilityRole="tablist"
      style={styles.pillRow}>
      {items.map(item => {
        const selected = activeKey === item.key;
        const accent = item.accent ?? 'cyan';
        return (
          <Pressable
            key={item.key}
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            accessibilityState={{disabled: item.disabled, selected}}
            disabled={item.disabled}
            onPress={() => onChange(item.key)}
            style={({pressed}) => [
              styles.pill,
              selected && pillAccentStyles[accent],
              item.disabled && styles.disabled,
              pressed && !item.disabled && styles.pressed,
            ]}>
            {selected ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={[styles.pillDot, pillDotStyles[accent]]}
              />
            ) : null}
            <AppText
              numberOfLines={1}
              style={[styles.pillLabel, selected && pillTextStyles[accent]]}
              variant="caption"
              weight="semibold">
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );

  if (!scrollable) {
    return content;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {content}
    </ScrollView>
  );
}

function SeriesSample({
  chartType,
  color,
  domain,
  selected,
  value,
}: {
  chartType: MetricChartType;
  color: string;
  domain: Domain;
  selected: boolean;
  value: number;
}) {
  const height = valueHeight(value, domain);
  if (chartType === 'line') {
    return (
      <View style={styles.lineSample}>
        <View
          style={[
            styles.linePoint,
            {
              backgroundColor: color,
              bottom: height,
              shadowColor: color,
            },
            selected && styles.linePointSelected,
          ]}
        />
      </View>
    );
  }

  const fillOpacity = chartType === 'area' ? 0.24 : 0.65;
  return (
    <View
      style={[
        styles.valueColumn,
        {
          backgroundColor: withAlpha(color, fillOpacity),
          borderTopColor: color,
          height,
        },
        chartType === 'area' && styles.areaColumn,
        selected && styles.valueColumnSelected,
      ]}>
      {chartType === 'area' ? (
        <View style={[styles.areaPoint, {backgroundColor: color}]} />
      ) : null}
    </View>
  );
}

function buildDomain<P>(data: readonly ProjectedPoint<P>[]): Domain {
  if (data.length === 0) {
    return {min: 0, max: 1};
  }

  let min = 0;
  let max = 0;
  data.forEach(point => {
    const value = safeFiniteNumber(point[VALUE_KEY]);
    min = Math.min(min, value);
    max = Math.max(max, value);
  });

  if (min === max) {
    const padding = Math.max(Math.abs(max) * 0.05, 1);
    min -= padding;
    max += padding;
  }

  return {min, max};
}

function pickXTicks<P>(
  data: readonly ProjectedPoint<P>[],
): Array<IndexedPoint<P>> {
  if (data.length <= 3) {
    return data.map((point, index) => ({index, point}));
  }

  const last = data.length - 1;
  return [
    {index: 0, point: data[0]},
    {index: Math.round(last / 2), point: data[Math.round(last / 2)]},
    {index: last, point: data[last]},
  ];
}

function pickSelectedPoint<P>(
  data: readonly ProjectedPoint<P>[],
  selectedIndex: number | null,
): IndexedPoint<P> | null {
  if (data.length === 0) {
    return null;
  }

  const index =
    selectedIndex == null
      ? data.length - 1
      : Math.min(Math.max(selectedIndex, 0), data.length - 1);
  return {index, point: data[index]};
}

function valueHeight(value: number, domain: Domain): DimensionValue {
  const span = domain.max - domain.min || 1;
  const percent = ((safeFiniteNumber(value) - domain.min) / span) * 100;
  return `${Math.max(Math.min(percent, 100), 3)}%` as DimensionValue;
}

function safeFiniteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function formatDateLabel(
  date: string,
  formatter: ((value: string) => string) | undefined,
): string {
  return formatter ? formatter(date) : date;
}

function withAlpha(color: string, alpha: number): string {
  const clampedAlpha = Math.min(Math.max(alpha, 0), 1);
  const hex = color.replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = Number.parseInt(hex[0] + hex[0], 16);
    const g = Number.parseInt(hex[1] + hex[1], 16);
    const b = Number.parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
  }
  return color;
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  areaColumn: {
    borderTopWidth: 2,
  },
  areaPoint: {
    borderRadius: 3,
    height: 6,
    marginTop: -4,
    width: 6,
  },
  axisLabel: {
    color: colors.textMuted,
    textAlign: 'right',
  },
  chartFrame: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 116,
  },
  disabled: {
    opacity: 0.44,
  },
  gridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.55,
    position: 'absolute',
    right: 0,
  },
  linePoint: {
    borderColor: colors.background,
    borderRadius: 5,
    borderWidth: 1,
    height: 10,
    marginBottom: -5,
    position: 'absolute',
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.6,
    shadowRadius: 6,
    width: 10,
  },
  linePointSelected: {
    borderColor: colors.textPrimary,
    transform: [{scale: 1.24}],
  },
  lineSample: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  pill: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 30,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  pillDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  pillLabel: {
    color: colors.textMuted,
  },
  pillRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  plotArea: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
  },
  plotColumn: {
    flex: 1,
    minWidth: 0,
  },
  plotScroller: {
    flexGrow: 1,
  },
  plotStack: {
    flex: 1,
    gap: spacing.xs,
    minHeight: 0,
  },
  pressed: {
    opacity: 0.78,
  },
  root: {
    flex: 1,
    gap: spacing.sm,
  },
  sample: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: MIN_SAMPLE_WIDTH,
    paddingHorizontal: 2,
  },
  samplePressed: {
    opacity: 0.82,
  },
  seriesLayer: {
    bottom: spacing.sm,
    flexDirection: 'row',
    gap: 3,
    left: spacing.sm,
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
  },
  valueColumn: {
    alignItems: 'center',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    minHeight: 3,
    width: '100%',
  },
  valueColumnSelected: {
    borderColor: colors.textPrimary,
    borderWidth: 1,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 18,
  },
  xAxisLabel: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 60,
    textAlign: 'center',
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingBottom: 22,
    paddingTop: 2,
    width: 58,
  },
});

const pillAccentStyles = StyleSheet.create<Record<PillAccent, ViewStyle>>({
  amber: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  blue: {
    backgroundColor: 'rgba(79, 70, 229, 0.16)',
    borderColor: 'rgba(129, 140, 248, 0.4)',
  },
  cyan: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  green: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  purple: {
    backgroundColor: colors.violetSurface,
    borderColor: colors.violetBorder,
  },
  red: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
});

const pillDotStyles = StyleSheet.create<Record<PillAccent, ViewStyle>>({
  amber: {
    backgroundColor: colors.warning,
  },
  blue: {
    backgroundColor: '#818cf8',
  },
  cyan: {
    backgroundColor: colors.accent,
  },
  green: {
    backgroundColor: colors.success,
  },
  purple: {
    backgroundColor: colors.violet,
  },
  red: {
    backgroundColor: colors.danger,
  },
});

const pillTextStyles = StyleSheet.create<Record<PillAccent, TextStyle>>({
  amber: {
    color: colors.warning,
  },
  blue: {
    color: '#818cf8',
  },
  cyan: {
    color: colors.accent,
  },
  green: {
    color: colors.success,
  },
  purple: {
    color: colors.violet,
  },
  red: {
    color: colors.danger,
  },
});
