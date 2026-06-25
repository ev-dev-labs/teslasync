// Native parity port of web/src/components/charts/index.ts.
// This barrel preserves the web chart public API while replacing Recharts and
// DOM/SVG-only helpers with React Native-safe primitives.

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
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {AreaChartWrapper} from './AreaChartWrapper';
import {ChartContainer} from './ChartContainer';
import {CHART_COLORS as NATIVE_CHART_COLORS} from './chartUtils';

export {AreaChartWrapper} from './AreaChartWrapper';
export {ChartContainer} from './ChartContainer';
export {ChartExportMenu, type ChartExportMenuProps} from './ChartExportMenu';
export {ChartTooltip, ChartTooltipBase, type ChartTooltipProps} from './ChartTooltip';
export {ChartGradient, ChartGradientBase} from './ChartGradient';
export {
  AREA_DEFAULTS,
  areaGradient,
  createAreaGradientDescriptor,
  type NativeAreaGradientDescriptor,
  type NativeAreaGradientStop,
} from './chartDefaults';
export {
  axisTick,
  axisTickSm,
  chartAnimation,
  chartGrid,
  chartGridDescriptor,
  chartMargin,
  chartMarginLabeled,
  CHART_COLORS,
  fmt,
  NEON_COLORS,
  safe,
  type NativeChartGridDescriptor,
} from './chartUtils';
export {ElevationProfile, type ElevationDataPoint} from './ElevationProfile';
export {renderAnnotationLines} from './ChartAnnotationLayer';
export {AddAnnotationPopover} from './AddAnnotationPopover';
export {AnnotationList} from './AnnotationList';

// Shared brush, sync, legend, and tooltip primitives.
// Persistent cursor sync builds on the native in-memory sync store.
export {
  ChartTimeRangeProvider,
  useChartSync,
  useSyncedCursor,
  useSyncedReferenceLineX,
  type ChartSyncContextValue,
  type ChartTimeRangeProviderProps,
  type SyncedCursorProps,
} from './ChartTimeRangeContext';
export {
  clearCursorSync,
  getCursorSyncPosition,
  setCursorSyncPosition,
  useCursorSyncPosition,
  type CursorSyncValue,
} from './cursorSync';
export {ChartBrush, type ChartBrushProps} from './ChartBrush';
export {
  ChartLegend,
  type ChartLegendProps,
  type ChartLegendToggleSource,
} from './ChartLegend';
export {
  ChartHiddenSeriesContext,
  ChartHiddenSeriesProvider,
  useChartHiddenSeries,
} from './ChartHiddenSeriesContext';

export const NATIVE_RECHARTS_UNAVAILABLE_REASON =
  'Recharts depends on browser DOM/SVG layout and is unavailable in React Native parity components.' as const;

export const nativeChartsBarrelCapabilities = {
  recharts: {
    available: false,
    reason: NATIVE_RECHARTS_UNAVAILABLE_REASON,
  },
  themeProvider: {
    available: false,
    reason:
      'The web ThemeProvider is not present in the native parity tree; useThemeChartPalette returns a deterministic native token palette.',
  },
  legendPersistence: {
    available: true,
    reason:
      'Legend visibility persists for the current native process with an in-memory store instead of browser localStorage.',
  },
} as const;

export interface RadialGaugeProps {
  value: number;
  max: number;
  label: string;
  unit?: string;
  color?: string;
  size?: number;
  decimals?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

export const RadialGauge = React.forwardRef<View, RadialGaugeProps>(
  function RadialGauge(
    {
      value,
      max,
      label,
      unit,
      color = colors.accent,
      size = 120,
      decimals,
      className: _className,
      style,
      testID,
      'data-testid': dataTestID,
    },
    ref,
  ) {
    const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
    const clamped = Math.max(0, Math.min(safeNumber(value), safeMax));
    const progress = clamped / safeMax;
    const precision =
      decimals ?? (Number.isInteger(clamped) ? 0 : DEFAULT_NUMBER_PRECISION);

    return React.createElement(
      View,
      {
        ref,
        accessible: true,
        accessibilityLabel: `${label}: ${formatNumber(clamped, precision)}${
          unit ?? ''
        } of ${formatNumber(safeMax, precision)}${unit ?? ''}`,
        accessibilityRole: 'summary',
        style: [styles.radialRoot, style],
        testID: testID ?? dataTestID,
      },
      React.createElement(
        View,
        {
          style: [
            styles.radialGauge,
            {
              borderColor: withAlpha(color, 0.36),
              borderRadius: size / 2,
              height: size,
              width: size,
            },
          ],
        },
        React.createElement(View, {
          pointerEvents: 'none',
          style: [
            styles.radialFill,
            {
              backgroundColor: withAlpha(color, 0.18),
              width: `${Math.max(progress * 100, 4)}%`,
            },
          ],
        }),
        React.createElement(
          View,
          {pointerEvents: 'none', style: styles.radialValue},
          React.createElement(
            AppText,
            {variant: 'title', weight: 'bold'},
            formatNumber(clamped, precision),
            unit
              ? React.createElement(
                  AppText,
                  {variant: 'caption', tone: 'muted'},
                  unit,
                )
              : null,
          ),
        ),
      ),
      React.createElement(
        AppText,
        {numberOfLines: 2, style: styles.centerText, variant: 'caption', tone: 'muted'},
        label,
      ),
    );
  },
);

export interface MiniChartProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

export const MiniChart = React.forwardRef<View, MiniChartProps>(
  function MiniChart(
    {
      data,
      color = colors.accent,
      height = 32,
      width = 100,
      className: _className,
      style,
      testID,
      'data-testid': dataTestID,
    },
    ref,
  ) {
    if (data.length < 2) {
      return null;
    }

    return React.createElement(NativeSparkBars, {
      ref,
      accessibilityLabel: `Mini chart with ${data.length} points`,
      color,
      data,
      height,
      style,
      testID: testID ?? dataTestID,
      width,
    });
  },
);

export interface SparklineProps {
  data: number[];
  accessibilityLabel?: string;
  color?: string;
  height?: number;
  width?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

export function Sparkline({
  data,
  color = colors.accent,
  height = 30,
  width = 100,
  style,
  testID,
  'data-testid': dataTestID,
}: SparklineProps) {
  if (!data.length) {
    return null;
  }

  return React.createElement(NativeSparkBars, {
    accessibilityLabel: `Sparkline with ${data.length} points`,
    color,
    data,
    height,
    style,
    testID: testID ?? dataTestID,
    width,
  });
}

export interface SmallMultiplesChartProps<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  data: T[];
  series: string[];
  seriesLabel?: (series: string) => string;
  xKey?: string;
  cellHeight?: number;
  cellMinWidth?: number;
  columns?: number;
  syncId?: string;
  colorIndex?: Record<string, number>;
  onCellClick?: (series: string) => void;
  emptyCellLabel?: string;
  maxPointsPerCell?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

export function SmallMultiplesChart<
  T extends Record<string, unknown> = Record<string, unknown>,
>({
  data,
  series,
  seriesLabel,
  xKey = 'timestamp',
  cellHeight = 120,
  cellMinWidth = 280,
  columns,
  syncId,
  colorIndex,
  onCellClick,
  emptyCellLabel = 'No data',
  maxPointsPerCell = 400,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
}: SmallMultiplesChartProps<T>) {
  const safeData = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const safeSeries = useMemo(
    () => (Array.isArray(series) ? series : []),
    [series],
  );
  const projections = useMemo(
    () =>
      safeSeries.map(key => {
        const values = strideSample(
          safeData
            .map(row => safeNumberOrNull(row[key]))
            .filter((value): value is number => value != null),
          maxPointsPerCell,
        );
        const firstRow = safeData.find(row => safeNumberOrNull(row[key]) != null);
        const lastRow = [...safeData]
          .reverse()
          .find(row => safeNumberOrNull(row[key]) != null);

        return {
          color:
            NATIVE_CHART_COLORS[
              colorIndex?.[key] == null
                ? safeSeries.indexOf(key) % NATIVE_CHART_COLORS.length
                : colorIndex[key] % NATIVE_CHART_COLORS.length
            ],
          key,
          label: seriesLabel?.(key) ?? key,
          rangeLabel: formatRange(firstRow?.[xKey], lastRow?.[xKey]),
          values,
        };
      }),
    [colorIndex, maxPointsPerCell, safeData, safeSeries, seriesLabel, xKey],
  );
  const cellBasis = columns
    ? (`${100 / Math.max(columns, 1)}%` as DimensionValue)
    : undefined;

  return React.createElement(
    View,
    {
      accessibilityLabel: `Small multiples chart${
        syncId ? ` synced as ${syncId}` : ''
      } with ${safeSeries.length} series`,
      accessibilityRole: 'summary',
      style: [styles.smallMultiplesRoot, style],
      testID: testID ?? dataTestID,
    },
    projections.map(item =>
      React.createElement(
        Pressable,
        {
          key: item.key,
          accessibilityLabel: `${item.label}. ${item.values.length} points. ${item.rangeLabel}`,
          accessibilityRole: onCellClick ? 'button' : 'summary',
          disabled: !onCellClick,
          onPress: onCellClick ? () => onCellClick(item.key) : undefined,
          style: ({pressed}) => [
            styles.smallMultipleCell,
            {
              flexBasis: cellBasis,
              minHeight: cellHeight,
              minWidth: Math.min(cellMinWidth, 360),
            },
            pressed && styles.pressed,
          ],
        },
        React.createElement(
          View,
          {pointerEvents: 'none', style: styles.smallMultipleHeader},
          React.createElement(
            AppText,
            {numberOfLines: 1, variant: 'caption', weight: 'semibold'},
            item.label,
          ),
          React.createElement(
            AppText,
            {numberOfLines: 1, variant: 'caption', tone: 'muted'},
            item.rangeLabel,
          ),
        ),
        item.values.length > 0
          ? React.createElement(NativeSparkBars, {
              color: item.color,
              data: item.values,
              height: Math.max(cellHeight - 52, 36),
              width: Math.max(cellMinWidth - spacing.lg, 120),
            })
          : React.createElement(
              AppText,
              {style: styles.emptyCell, tone: 'muted', variant: 'caption'},
              emptyCellLabel,
            ),
      ),
    ),
  );
}

export interface TimeMarkerProps {
  x: string | number | null | undefined;
  severity?: Severity | string | null;
  label?: string;
  strokeDasharray?: string;
  strokeWidth?: number;
  ifOverflow?: 'discard' | 'hidden' | 'visible' | 'extendDomain';
  yAxisId?: string | number;
}

export type Severity = 'info' | 'warn' | 'critical' | 'success';

export const severityTokens: Record<Severity, {color: string; surface: string}> = {
  critical: {color: colors.danger, surface: colors.dangerSurface},
  info: {color: colors.accent, surface: colors.accentSoft},
  success: {color: colors.success, surface: colors.successSurface},
  warn: {color: colors.warning, surface: colors.warningSurface},
};

export function TimeMarker({
  x,
  severity,
  label = 'Alert',
  strokeDasharray: _strokeDasharray,
  strokeWidth = 2,
  ifOverflow: _ifOverflow = 'extendDomain',
  yAxisId: _yAxisId,
}: TimeMarkerProps) {
  if (x == null || x === '') {
    return null;
  }

  const normalized = normalizeSeverity(severity ?? 'warn');
  const token = severityTokens[normalized];

  return React.createElement(
    View,
    {
      accessibilityLabel: `${label} marker at ${String(x)}`,
      accessibilityRole: 'summary',
      style: [styles.timeMarker, {backgroundColor: token.surface}],
      testID: 'time-marker',
    },
    React.createElement(View, {
      pointerEvents: 'none',
      style: [
        styles.timeMarkerStroke,
        {backgroundColor: token.color, width: Math.max(strokeWidth, 1)},
      ],
    }),
    React.createElement(
      AppText,
      {numberOfLines: 1, style: {color: token.color}, variant: 'caption'},
      label,
    ),
  );
}

export interface MetricSwitcherMetric<P> {
  key: string;
  label: string;
  chart?: 'bar' | 'area' | 'line';
  color?: string;
  accent?: string;
  unit?: string;
  getValue?: (point: P) => number;
  formatValue?: (value: number) => string;
  formatTick?: (value: number) => string;
}

export interface MetricSwitcherChartProps<P> {
  title: string;
  ariaLabel: string;
  series: Record<string, P[]>;
  metrics: readonly MetricSwitcherMetric<P>[];
  activeMetric: string;
  onMetricChange: (key: string) => void;
  height?: number;
  formatXTick?: (date: string) => string;
  emptyMessage: string;
  action?: ReactNode;
  testId?: string;
}

const DEFAULT_X_KEY = 'date';

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
  const active = metrics.find(metric => metric.key === activeMetric) ?? metrics[0];
  const data = useMemo(() => (active ? series[active.key] ?? [] : []), [
    active,
    series,
  ]);
  const valueKey = '__value';
  const projected = useMemo<Record<string, unknown>[]>(() => {
    if (!active) {
      return [];
    }

    const getValue =
      active.getValue ??
      ((point: P) => {
        const fallback = (point as {value?: unknown}).value;
        return typeof fallback === 'number' ? fallback : 0;
      });

    return data.map(point => ({
      ...point,
      [valueKey]: getValue(point),
    }));
  }, [active, data]);
  const activeColor = active?.color ?? NATIVE_CHART_COLORS[0];
  const chartSeries = useMemo(
    () =>
      active
        ? [
            {
              color: activeColor,
              key: valueKey,
              label: active.label,
            },
          ]
        : [],
    [active, activeColor],
  );
  const metricContent = React.createElement(
    View,
    {style: styles.metricSwitcherRoot},
    React.createElement(
      ScrollView,
      {
        accessibilityLabel: `${title} metric selector`,
        horizontal: true,
        showsHorizontalScrollIndicator: false,
        style: styles.metricScroller,
      },
      metrics.map(metric =>
        React.createElement(
          Pressable,
          {
            key: metric.key,
            accessibilityLabel: metric.label,
            accessibilityRole: 'button',
            accessibilityState: {selected: metric.key === active?.key},
            onPress: () => onMetricChange(metric.key),
            style: ({pressed}) => [
              styles.metricPill,
              metric.key === active?.key && styles.metricPillActive,
              pressed && styles.pressed,
            ],
          },
          React.createElement(
            AppText,
            {
              numberOfLines: 1,
              tone: metric.key === active?.key ? 'accent' : 'secondary',
              variant: 'caption',
              weight: 'semibold',
            },
            metric.label,
          ),
        ),
      ),
    ),
    projected.length > 0 && active
      ? React.createElement(AreaChartWrapper, {
          data: projected,
          height: Math.max(height - 52, 120),
          series: chartSeries,
          xFormatter: formatXTick,
          xKey: DEFAULT_X_KEY,
          yFormatter: value =>
            active.formatTick?.(value) ??
            active.formatValue?.(value) ??
            `${value}${active.unit ?? ''}`,
        })
      : React.createElement(
          View,
          {style: styles.centeredNotice},
          React.createElement(
            AppText,
            {tone: 'muted', variant: 'caption'},
            emptyMessage,
          ),
        ),
  );

  return React.createElement(
    ChartContainer,
    {
      action,
      ariaLabel,
      children: metricContent,
      data: projected.map(row => ({
        date: typeof row.date === 'string' ? row.date : String(row.date ?? ''),
        value:
          typeof row[valueKey] === 'number'
            ? active?.formatValue?.(row[valueKey]) ?? String(row[valueKey])
            : '',
      })),
      dataColumns: [
        {key: 'date', label: 'Date'},
        {key: 'value', label: active?.label ?? 'Value'},
      ],
      height,
      title,
      testID: testId,
    },
  );
}

export interface ChartLegendState {
  hidden: Set<string>;
  isHidden: (dataKey: string) => boolean;
  toggle: (dataKey: string) => void;
  setHidden: (dataKey: string, hidden: boolean) => void;
  reset: () => void;
}

const nativeLegendStore = new Map<string, Set<string>>();

export function useChartLegendState(chartId: string): ChartLegendState {
  const [hidden, setHiddenState] = useState<Set<string>>(
    () => new Set(nativeLegendStore.get(chartId) ?? []),
  );

  useEffect(() => {
    setHiddenState(new Set(nativeLegendStore.get(chartId) ?? []));
  }, [chartId]);

  const persist = useCallback(
    (next: Set<string>) => {
      const copy = new Set(next);
      if (copy.size > 0) {
        nativeLegendStore.set(chartId, copy);
      } else {
        nativeLegendStore.delete(chartId);
      }
      setHiddenState(copy);
    },
    [chartId],
  );

  const isHidden = useCallback(
    (dataKey: string) => hidden.has(dataKey),
    [hidden],
  );

  const toggle = useCallback(
    (dataKey: string) => {
      const next = new Set(hidden);
      if (next.has(dataKey)) {
        next.delete(dataKey);
      } else {
        next.add(dataKey);
      }
      persist(next);
    },
    [hidden, persist],
  );

  const setHidden = useCallback(
    (dataKey: string, shouldHide: boolean) => {
      const next = new Set(hidden);
      if (shouldHide) {
        next.add(dataKey);
      } else {
        next.delete(dataKey);
      }
      persist(next);
    },
    [hidden, persist],
  );

  const reset = useCallback(() => {
    persist(new Set());
  }, [persist]);

  return {hidden, isHidden, reset, setHidden, toggle};
}

export interface ChartPalette {
  primary: string;
  accent: string;
  series: string[];
  positive: string;
  negative: string;
  warning: string;
  neutral: string;
}

interface ColorTheme {
  primary: string;
  accent: string;
}

interface ModeTheme {
  colorScheme?: 'dark' | 'light' | string;
}

const DEFAULT_NATIVE_CHART_THEME: ColorTheme = {
  accent: colors.violet,
  primary: colors.accent,
};

const DEFAULT_NATIVE_CHART_MODE: ModeTheme = {
  colorScheme: 'dark',
};

export function buildChartPalette(
  theme: ColorTheme,
  mode: ModeTheme,
): ChartPalette {
  const [hPrimary, sPrimary, lPrimary] = hexToHsl(theme.primary);
  const [hAccent, sAccent, lAccent] = hexToHsl(theme.accent);
  const isLight = mode.colorScheme === 'light';
  const targetLightness = isLight ? 0.42 : 0.58;

  let delta = hAccent - hPrimary;
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }

  const series: string[] = [];
  for (let index = 0; index < CHART_SERIES_LENGTH; index += 1) {
    const ratio = index / (CHART_SERIES_LENGTH - 1);
    const hue = hPrimary + delta * ratio;
    const saturation = clamp(
      sPrimary + (sAccent - sPrimary) * ratio,
      0.5,
      0.95,
    );
    const lightness = clamp(
      targetLightness +
        (lPrimary + (lAccent - lPrimary) * ratio - targetLightness) * 0.4,
      0.35,
      0.7,
    );
    series.push(hslToHex(hue, saturation, lightness));
  }

  return {
    accent: theme.accent,
    negative: colors.danger,
    neutral: colors.textMuted,
    positive: colors.success,
    primary: theme.primary,
    series,
    warning: colors.warning,
  };
}

export function useThemeChartPalette(): ChartPalette {
  return useMemo(
    () => buildChartPalette(DEFAULT_NATIVE_CHART_THEME, DEFAULT_NATIVE_CHART_MODE),
    [],
  );
}

export interface NativeChartPrimitiveProps {
  children?: ReactNode;
  className?: string;
  data?: readonly unknown[];
  height?: number | string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  width?: number | string;
  'aria-label'?: string;
  'data-testid'?: string;
  [key: string]: unknown;
}

export const ResponsiveContainer = createNativeChartPrimitive(
  'ResponsiveContainer',
  'container',
);
export const AreaChart = createNativeChartPrimitive('AreaChart', 'chart');
export const LineChart = createNativeChartPrimitive('LineChart', 'chart');
export const BarChart = createNativeChartPrimitive('BarChart', 'chart');
export const PieChart = createNativeChartPrimitive('PieChart', 'chart');
export const ComposedChart = createNativeChartPrimitive('ComposedChart', 'chart');
export const ScatterChart = createNativeChartPrimitive('ScatterChart', 'chart');
export const RadarChart = createNativeChartPrimitive('RadarChart', 'chart');
export const Area = createNativeChartPrimitive('Area', 'leaf');
export const XAxis = createNativeChartPrimitive('XAxis', 'leaf');
export const YAxis = createNativeChartPrimitive('YAxis', 'leaf');
export const CartesianGrid = createNativeChartPrimitive('CartesianGrid', 'leaf');
export const Tooltip = createNativeChartPrimitive('Tooltip', 'leaf');
export const Line = createNativeChartPrimitive('Line', 'leaf');
export const Bar = createNativeChartPrimitive('Bar', 'leaf');
export const Pie = createNativeChartPrimitive('Pie', 'leaf');
export const Cell = createNativeChartPrimitive('Cell', 'leaf');
export const Brush = createNativeChartPrimitive('Brush', 'leaf');
export const Scatter = createNativeChartPrimitive('Scatter', 'leaf');
export const ReferenceLine = createNativeChartPrimitive('ReferenceLine', 'leaf');
export const ReferenceArea = createNativeChartPrimitive('ReferenceArea', 'leaf');
export const Legend = createNativeChartPrimitive('Legend', 'leaf');
export const Radar = createNativeChartPrimitive('Radar', 'leaf');
export const PolarGrid = createNativeChartPrimitive('PolarGrid', 'leaf');
export const PolarAngleAxis = createNativeChartPrimitive('PolarAngleAxis', 'leaf');
export const ZAxis = createNativeChartPrimitive('ZAxis', 'leaf');
export const Label = createNativeChartPrimitive('Label', 'leaf');

type NativeChartPrimitiveKind = 'chart' | 'container' | 'leaf';

const DEFAULT_NUMBER_PRECISION = 1;
const CHART_SERIES_LENGTH = 8;

const NativeSparkBars = React.forwardRef<View, SparklineProps>(
  function NativeSparkBars(
    {
      accessibilityLabel,
      data,
      color = colors.accent,
      height = 30,
      width = 100,
      style,
      testID,
    },
    ref,
  ) {
    const values = data.filter(Number.isFinite);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return React.createElement(
      View,
      {
        ref,
        accessible: true,
        accessibilityLabel:
          accessibilityLabel ??
          `Native sparkline with ${values.length} finite points`,
        accessibilityRole: 'image',
        style: [styles.sparkRoot, {height, width}, style],
        testID,
      },
      values.map((value, index) =>
        React.createElement(View, {
          key: `${index}-${value}`,
          pointerEvents: 'none',
          style: [
            styles.sparkBar,
            {
              backgroundColor: color,
              height: `${Math.max(((value - min) / range) * 100, 8)}%`,
            },
          ],
        }),
      ),
    );
  },
);

function createNativeChartPrimitive(
  name: string,
  kind: NativeChartPrimitiveKind,
) {
  function NativeChartPrimitive({
    children,
    height,
    style,
    testID,
    width,
    'aria-label': ariaLabel,
    'data-testid': dataTestID,
  }: NativeChartPrimitiveProps) {
    const dimensions = resolveDimensions(width, height);

    if (kind === 'leaf') {
      return React.createElement(View, {
        accessibilityLabel: `${name} is unavailable in native charts. ${NATIVE_RECHARTS_UNAVAILABLE_REASON}`,
        accessibilityRole: 'summary',
        style: styles.unavailableLeaf,
        testID: testID ?? dataTestID,
      });
    }

    if (kind === 'container') {
      return React.createElement(
        View,
        {
          accessibilityLabel:
            ariaLabel ??
            `${name} native layout wrapper. ${NATIVE_RECHARTS_UNAVAILABLE_REASON}`,
          accessibilityRole: 'summary',
          style: [styles.responsiveContainer, dimensions, style],
          testID: testID ?? dataTestID,
        },
        children,
      );
    }

    return React.createElement(
      View,
      {
        accessibilityLabel:
          ariaLabel ??
          `${name} unavailable. ${NATIVE_RECHARTS_UNAVAILABLE_REASON}`,
        accessibilityRole: 'image',
        style: [styles.unavailableChart, dimensions, style],
        testID: testID ?? dataTestID,
      },
      React.createElement(
        AppText,
        {style: styles.unavailableTitle, variant: 'caption', weight: 'semibold'},
        name,
      ),
      React.createElement(
        AppText,
        {tone: 'muted', variant: 'caption'},
        'Native chart renderer unavailable; use a web-parity native chart wrapper for visual output.',
      ),
      children,
    );
  }

  NativeChartPrimitive.displayName = name;
  return NativeChartPrimitive;
}

function resolveDimensions(
  width: number | string | undefined,
  height: number | string | undefined,
): StyleProp<ViewStyle> {
  return {
    height: normalizeDimension(height),
    width: normalizeDimension(width),
  };
}

function normalizeDimension(
  value: number | string | undefined,
): DimensionValue | undefined {
  if (value == null) {
    return undefined;
  }

  return typeof value === 'number' ? value : (value as DimensionValue);
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatNumber(value: number, decimals = DEFAULT_NUMBER_PRECISION): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function strideSample<T>(rows: T[], cap: number): T[] {
  if (cap <= 0 || rows.length <= cap) {
    return rows;
  }

  const stride = Math.ceil(rows.length / cap);
  const sampled: T[] = [];
  for (let index = 0; index < rows.length; index += stride) {
    sampled.push(rows[index]);
  }
  const last = rows[rows.length - 1];
  if (sampled[sampled.length - 1] !== last) {
    sampled.push(last);
  }
  return sampled;
}

function formatRange(first: unknown, last: unknown): string {
  if (first == null && last == null) {
    return 'No range';
  }
  if (first === last || last == null) {
    return String(first);
  }
  if (first == null) {
    return String(last);
  }
  return `${String(first)} - ${String(last)}`;
}

function normalizeSeverity(severity: string | null | undefined): Severity {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical':
    case 'error':
    case 'danger':
      return 'critical';
    case 'success':
    case 'ok':
    case 'good':
      return 'success';
    case 'info':
      return 'info';
    default:
      return 'warn';
  }
}

function withAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = hexToRgb(hex);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map(char => char + char)
          .join('')
      : cleaned.padEnd(6, '0').slice(0, 6);
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  return [
    Number.isFinite(red) ? red : 0,
    Number.isFinite(green) ? green : 0,
    Number.isFinite(blue) ? blue : 0,
  ];
}

function rgbToHex(red: number, green: number, blue: number): string {
  const toHex = (value: number) =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function rgbToHsl(
  red: number,
  green: number,
  blue: number,
): [number, number, number] {
  const rn = red / 255;
  const gn = green / 255;
  const bn = blue / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) {
    return [0, 0, lightness];
  }

  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;

  switch (max) {
    case rn:
      hue = (gn - bn) / delta + (gn < bn ? 6 : 0);
      break;
    case gn:
      hue = (bn - rn) / delta + 2;
      break;
    default:
      hue = (rn - gn) / delta + 4;
  }

  return [hue * 60, saturation, lightness];
}

function hslToRgb(
  hue: number,
  saturation: number,
  lightness: number,
): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = (((hue % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime < 1) {
    [red, green, blue] = [chroma, x, 0];
  } else if (huePrime < 2) {
    [red, green, blue] = [x, chroma, 0];
  } else if (huePrime < 3) {
    [red, green, blue] = [0, chroma, x];
  } else if (huePrime < 4) {
    [red, green, blue] = [0, x, chroma];
  } else if (huePrime < 5) {
    [red, green, blue] = [x, 0, chroma];
  } else {
    [red, green, blue] = [chroma, 0, x];
  }

  const match = lightness - chroma / 2;
  return [(red + match) * 255, (green + match) * 255, (blue + match) * 255];
}

function hexToHsl(hex: string): [number, number, number] {
  return rgbToHsl(...hexToRgb(hex));
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  return rgbToHex(...hslToRgb(hue, saturation, lightness));
}

const styles = StyleSheet.create({
  centerText: {
    textAlign: 'center',
  },
  centeredNotice: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 80,
  },
  emptyCell: {
    marginTop: spacing.md,
  },
  metricPill: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  metricPillActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  metricScroller: {
    flexGrow: 0,
  },
  metricSwitcherRoot: {
    flex: 1,
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.72,
  },
  radialFill: {
    bottom: 0,
    left: 0,
    opacity: 1,
    position: 'absolute',
    top: 0,
  },
  radialGauge: {
    alignItems: 'center',
    borderWidth: 8,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  radialRoot: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  radialValue: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  responsiveContainer: {
    minHeight: 120,
    minWidth: 0,
    width: '100%',
  },
  smallMultipleCell: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexGrow: 1,
    gap: spacing.sm,
    margin: spacing.xs,
    overflow: 'hidden',
    padding: spacing.md,
  },
  smallMultipleHeader: {
    gap: spacing.xs,
  },
  smallMultiplesRoot: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sparkBar: {
    borderRadius: 999,
    flex: 1,
    minHeight: 2,
  },
  sparkRoot: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 2,
  },
  timeMarker: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  timeMarkerStroke: {
    borderRadius: 999,
    height: 18,
  },
  unavailableChart: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.warningBorder,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 96,
    padding: spacing.md,
    width: '100%',
  },
  unavailableLeaf: {
    height: 0,
    overflow: 'hidden',
    width: 0,
  },
  unavailableTitle: {
    color: colors.warning,
  },
});
