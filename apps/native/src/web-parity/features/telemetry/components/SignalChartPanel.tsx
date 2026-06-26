// Native parity port of
// web/src/features/telemetry/components/SignalChartPanel.tsx.
//
// The web component is a multi-line signal chart panel with a dual-axis +
// "live" visual treatment. It owns no data fetching: consumers pass `data`
// (ascending by timestamp) + `selectedSignals` and pick a `chartMode`
// ('overlay' | 'grid' | 'auto'). Overlay = one Recharts LineChart with all
// series stacked; grid = a SmallMultiplesChart with one cell per series;
// auto = overlay until `gridAutoThreshold` is exceeded, then grid. Live mode
// adds a red pulse + event/point counters and disables series animation, but
// the chart structure is identical.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-i18next `useTranslation()` -> a local useNativeTranslation() shim
//     whose t(key) returns the key verbatim (the web keys ARE the English copy,
//     e.g. t('events') -> "events"), preserving every i18n key + rendered text.
//   - `@/hooks/useDateFormat` formatTime -> an inlined locale-aware
//     formatClockTime (toLocaleTimeString {hour:'2-digit',minute:'2-digit'},
//     '—' for null/invalid) mirroring web `lib/dateFormat.formatTime`'s default
//     branch (the user timezone/locale overrides from useSettings are not ported
//     here; the display-boundary intent — a short HH:MM tick — is preserved).
//   - `@/lib/numberFormat` fmtInt -> inlined fmtInt (fmtNumber(v, 0): finite ->
//     en-US grouped integer, else '—'), verbatim behaviour.
//   - `@/lib/cn` cn() (clsx + tailwind-merge) -> dropped; the web `className`
//     channel becomes a native `style` prop merged last on the GlassPanel.
//   - lucide-react `Radio`/`BarChart3`/`Activity` (DOM SVG) -> decorative
//     Unicode glyphs in AppText (ICON_RADIO '\u25C9' dot-in-ring, ICON_BAR_CHART
//     '\u2583\u2585\u2587' rising bars, ICON_ACTIVITY '\u223F' sine wave) — the
//     established MQTTStatusWidget/APIUsageWidget/VehicleHero glyph precedent —
//     tinted to the web colours (red-500 #ef4444, neon-cyan -> accent, muted).
//   - Tailwind `animate-pulse` -> a reduce-motion-aware PulseView (Animated.loop
//     opacity 1<->0.4, stopped on unmount) reused by the live icon, the counter
//     dot and the waiting-state icon (the ChargingHeatmapPage pulse precedent).
//   - `@/components/feedback` Skeleton -> an inlined skeleton block (rounded
//     muted fill at the requested height); there is no native shimmer dependency.
//   - `@/components/motion` FadeIn -> a reduce-motion-aware FadeIn (Animated
//     opacity + translateY), matching the TrueCostPage port.
//   - `@/components/ui` GlassPanel -> the ported native GlassPanel (padding="md"
//     == web p-4; the caller `className` -> native `style`).
//   - `@/components/charts` SmallMultiplesChart -> the ported native
//     SmallMultiplesChart (same data/series/cellHeight/syncId contract) for grid
//     mode; CHART_COLORS -> the native parity colour ramp (CHART_COLORS[i % len]
//     per series, exactly as web). The Recharts LineChart/Line/XAxis/YAxis/
//     CartesianGrid/Tooltip/Legend/ResponsiveContainer + ChartTooltip have no
//     native SVG backend (the barrel exposes only "unavailable" placeholders),
//     so the overlay is reimplemented with React Native <View> primitives: a
//     bordered plot box with 0/50/100% grid lines, one rotated-segment polyline
//     per series (connectNulls — only finite points, consecutive points joined),
//     a left y-axis (max/mid/min), an opt-in right y-axis when the web
//     `useRightAxis` dual-axis heuristic fires (series index 1 on the right), an
//     x-axis of first/mid/last HH:MM ticks, and a colour legend carrying each
//     series name + latest value (the Recharts hover Tooltip + clickable Legend
//     toggle have no touch analog, so the latest values stand in for the lost
//     hover read, mirroring the SmallMultiplesChart per-cell latest summary).
//     `isAnimationActive={!isLive}` has no per-line native analog (the polylines
//     are static) and is documented.
//   - `SignalStat` (web imports it from ../hooks/useLiveSignalStream, not yet
//     ported) -> inlined + exported here with the identical shape.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {CHART_COLORS, SmallMultiplesChart} from '../../../components/charts';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── inline shims / types ─────────────────────────────────────────────────── */

// react-i18next is unavailable in native parity; the web keys ARE the English
// copy (e.g. t('events')), so the shim returns the key verbatim — same rendered
// text, every i18n key preserved.
function useNativeTranslation(): (key: string) => string {
  return (key) => key;
}

// Inlined native port of web `../hooks/useLiveSignalStream` SignalStat (the hook
// itself is not yet ported); identical shape. Drives the dual-axis decision.
export interface SignalStat {
  signal: string;
  min: number;
  max: number;
  avg: number;
  count: number;
}

export type SignalChartMode = 'overlay' | 'grid' | 'auto';

export interface SignalChartPanelProps {
  selectedSignals: string[];
  data: Record<string, unknown>[];
  /** Per-signal stats — drives auto dual-axis decision. */
  stats: SignalStat[];
  isLive?: boolean;
  loading?: boolean;
  /** Total points loaded (historical) or live event count. Header annotation. */
  pointsLoaded?: number;
  liveEventCount?: number;
  /** Override panel title. */
  title?: string;
  /** Height in px (default 350). */
  height?: number;
  /**
   * Display mode. `'auto'` switches to small-multiples grid once
   * `selectedSignals.length > gridAutoThreshold`. Default `'auto'`.
   */
  chartMode?: SignalChartMode;
  /** Threshold for `chartMode='auto'` to flip overlay → grid. Default 8. */
  gridAutoThreshold?: number;
  /**
   * Cell height for grid mode. Defaults to 140px so a 3-row stack
   * roughly matches the overlay mode's 350px footprint.
   */
  gridCellHeight?: number;
  /** Web Tailwind override; retained for source compatibility, ignored on native. */
  className?: string;
  /** Native replacement for the web `className`; merged last on the GlassPanel. */
  style?: StyleProp<ViewStyle>;
}

/* ─── constants ────────────────────────────────────────────────────────────── */

// Web colours preserved as literals (red-500/red-400/bg-red-500).
const RED_500 = '#ef4444';
const RED_400 = '#f87171';

// lucide-react decorative glyph stand-ins (MQTTStatusWidget/APIUsageWidget).
const ICON_RADIO = '\u25C9'; // lucide Radio (dot-in-ring)
const ICON_BAR_CHART = '\u2583\u2585\u2587'; // lucide BarChart3 (rising bars)
const ICON_ACTIVITY = '\u223F'; // lucide Activity (sine wave)

const DEFAULT_HEIGHT = 350;
const DEFAULT_GRID_AUTO_THRESHOLD = 8;
const DEFAULT_GRID_CELL_HEIGHT = 140;

const OVERLAY_PADDING = 8;
const OVERLAY_STROKE_WIDTH = 1.5;
const OVERLAY_GRID_LINES = [0, 50, 100] as const;
const OVERLAY_Y_AXIS_WIDTH = 44;
const OVERLAY_MIN_PLOT_WIDTH = 200;
const OVERLAY_X_AXIS_HEIGHT = 18;
const OVERLAY_MAX_POINTS = 300;

/* ─── number / time helpers (web lib ports) ────────────────────────────────── */

// Native port of web `@/lib/numberFormat` fmtInt (= fmtNumber(v, 0)).
function fmtInt(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return '—';
  }
  return v.toLocaleString('en-US', {maximumFractionDigits: 0});
}

// Native port of web `@/lib/dateFormat` formatTime (default branch): short HH:MM
// tick, '—' for null/invalid.
function formatClockTime(value: unknown): string {
  if (value == null || value === '') {
    return '—';
  }
  const raw = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(raw.getTime())) {
    return '—';
  }
  return raw.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function formatAxisNumber(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }
  const abs = Math.abs(value);
  const precision = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toLocaleString('en-US', {
    maximumFractionDigits: precision,
    minimumFractionDigits: 0,
  });
}

function isFinitePoint(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Stride-downsample to `cap` points, always preserving first + last. */
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

interface ChartDomain {
  min: number;
  max: number;
}

interface PlotPoint {
  key: string;
  value: number;
  x: number;
  y: number;
}

interface PlotSegment {
  angle: string;
  key: string;
  left: number;
  top: number;
  width: number;
}

function buildMultiDomain(
  rows: Array<Record<string, unknown>>,
  sigs: string[],
): ChartDomain {
  let min = 0;
  let max = 0;
  let hasValue = false;

  for (const row of rows) {
    for (const sig of sigs) {
      const value = row[sig];
      if (!isFinitePoint(value)) {
        continue;
      }
      min = hasValue ? Math.min(min, value) : value;
      max = hasValue ? Math.max(max, value) : value;
      hasValue = true;
    }
  }

  if (!hasValue) {
    return {max: 1, min: 0};
  }
  if (min === max) {
    const padding = Math.max(Math.abs(max) * 0.1, 1);
    return {max: max + padding, min: min - padding};
  }
  return {max, min};
}

function buildYTicks(domain: ChartDomain): number[] {
  return [domain.max, (domain.max + domain.min) / 2, domain.min];
}

function buildSeriesPoints(
  rows: Array<Record<string, unknown>>,
  sig: string,
  domain: ChartDomain,
  width: number,
  height: number,
): PlotPoint[] {
  const drawableWidth = Math.max(1, width - OVERLAY_PADDING * 2);
  const drawableHeight = Math.max(1, height - OVERLAY_PADDING * 2);
  const span = domain.max - domain.min || 1;

  return rows
    .map((row, index) => {
      const value = row[sig];
      if (!isFinitePoint(value)) {
        return null;
      }
      const ratio = rows.length <= 1 ? 0.5 : index / (rows.length - 1);
      const scaled = (value - domain.min) / span;
      return {
        key: `${index}`,
        value,
        x: OVERLAY_PADDING + ratio * drawableWidth,
        y: OVERLAY_PADDING + (1 - scaled) * drawableHeight,
      };
    })
    .filter((point): point is PlotPoint => point != null);
}

// connectNulls === true: consecutive finite points are joined, gaps bridged.
function buildSegments(points: PlotPoint[]): PlotSegment[] {
  return points.slice(1).map((point, index) => {
    const previous = points[index];
    const deltaX = point.x - previous.x;
    const deltaY = point.y - previous.y;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    return {
      angle: `${angle}deg`,
      key: `${previous.key}-${point.key}`,
      left: previous.x + deltaX / 2 - length / 2,
      top: previous.y + deltaY / 2 - OVERLAY_STROKE_WIDTH / 2,
      width: length,
    };
  });
}

function latestFiniteValue(
  rows: Array<Record<string, unknown>>,
  sig: string,
): number | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = rows[index][sig];
    if (isFinitePoint(value)) {
      return value;
    }
  }
  return undefined;
}

/* ─── reduce-motion + animation primitives ─────────────────────────────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

// Tailwind `animate-pulse` -> a looping opacity pulse, reduce-motion aware,
// stopped on unmount (ChargingHeatmapPage precedent).
function PulseView({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 0.4,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View style={[{opacity: pulse}, style]}>{children}</Animated.View>
  );
}

// `@/components/motion` FadeIn -> reduce-motion-aware opacity + translateY fade
// (TrueCostPage precedent).
function FadeIn({children}: {children: ReactNode}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      duration: 320,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

/* ─── overlay multi-line chart (native render of the Recharts LineChart) ───── */

interface OverlayLineChartProps {
  data: Record<string, unknown>[];
  series: string[];
  useRightAxis: boolean;
  height: number;
}

function OverlayLineChart({
  data,
  series,
  useRightAxis,
  height,
}: OverlayLineChartProps) {
  const [plotWidth, setPlotWidth] = useState(0);

  const rows = useMemo(
    () => strideSample(Array.isArray(data) ? data : [], OVERLAY_MAX_POINTS),
    [data],
  );

  const rightSig = useRightAxis ? series[1] : undefined;
  const leftSigs = useMemo(
    () => series.filter((_, index) => !(useRightAxis && index === 1)),
    [series, useRightAxis],
  );

  const leftDomain = useMemo(
    () => buildMultiDomain(rows, leftSigs),
    [rows, leftSigs],
  );
  const rightDomain = useMemo(
    () => buildMultiDomain(rows, rightSig ? [rightSig] : []),
    [rows, rightSig],
  );

  const plotHeight = Math.max(120, height - OVERLAY_X_AXIS_HEIGHT - spacing.sm);
  const resolvedPlotWidth =
    plotWidth > 0 ? plotWidth : OVERLAY_MIN_PLOT_WIDTH;

  const lines = useMemo(
    () =>
      series.map((sig, index) => {
        const onRight = Boolean(useRightAxis && index === 1 && rightSig);
        const domain = onRight ? rightDomain : leftDomain;
        const color = CHART_COLORS[index % CHART_COLORS.length];
        const points = buildSeriesPoints(
          rows,
          sig,
          domain,
          resolvedPlotWidth,
          plotHeight,
        );
        return {
          color,
          points,
          segments: buildSegments(points),
          sig,
        };
      }),
    [series, useRightAxis, rightSig, rightDomain, leftDomain, rows, resolvedPlotWidth, plotHeight],
  );

  const leftTicks = useMemo(() => buildYTicks(leftDomain), [leftDomain]);
  const rightTicks = useMemo(() => buildYTicks(rightDomain), [rightDomain]);
  const xTicks = useMemo(() => {
    if (rows.length === 0) {
      return [] as string[];
    }
    if (rows.length <= 2) {
      return rows.map((row) => formatClockTime(row.timestamp));
    }
    const last = rows.length - 1;
    return [rows[0], rows[Math.round(last / 2)], rows[last]].map((row) =>
      formatClockTime(row.timestamp),
    );
  }, [rows]);

  const handlePlotLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (Number.isFinite(width) && width > 0) {
      setPlotWidth(width);
    }
  }, []);

  return (
    <View>
      <View style={[styles.overlayFrame, {height: plotHeight}]}>
        <View style={[styles.overlayYAxis, {width: OVERLAY_Y_AXIS_WIDTH}]}>
          {leftTicks.map((tick, index) => (
            <AppText
              key={`left-${index}`}
              numberOfLines={1}
              style={styles.overlayAxisLabel}
              variant="caption">
              {formatAxisNumber(tick)}
            </AppText>
          ))}
        </View>

        <View
          accessibilityRole="image"
          accessible
          accessibilityLabel={`Signal line chart with ${series.length} series`}
          onLayout={handlePlotLayout}
          style={styles.overlayPlot}>
          {OVERLAY_GRID_LINES.map((line) => (
            <View
              key={`grid-${line}`}
              pointerEvents="none"
              style={[styles.overlayGridLine, {top: `${line}%` as DimensionValue}]}
            />
          ))}
          {lines.map((line) => (
            <React.Fragment key={line.sig}>
              {line.segments.map((segment) => (
                <View
                  key={segment.key}
                  pointerEvents="none"
                  style={[
                    styles.overlaySegment,
                    {
                      backgroundColor: line.color,
                      left: segment.left,
                      top: segment.top,
                      transform: [{rotateZ: segment.angle}],
                      width: segment.width,
                    },
                  ]}
                />
              ))}
              {line.points.length === 1 ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.overlayDot,
                    {
                      backgroundColor: line.color,
                      left: line.points[0].x - 3,
                      top: line.points[0].y - 3,
                    },
                  ]}
                />
              ) : null}
            </React.Fragment>
          ))}
        </View>

        {useRightAxis && rightSig ? (
          <View
            style={[
              styles.overlayYAxis,
              styles.overlayYAxisRight,
              {width: OVERLAY_Y_AXIS_WIDTH},
            ]}>
            {rightTicks.map((tick, index) => (
              <AppText
                key={`right-${index}`}
                numberOfLines={1}
                style={styles.overlayAxisLabelRight}
                variant="caption">
                {formatAxisNumber(tick)}
              </AppText>
            ))}
          </View>
        ) : null}
      </View>

      <View style={[styles.overlayXAxis, {marginLeft: OVERLAY_Y_AXIS_WIDTH}]}>
        {xTicks.map((tick, index) => (
          <AppText
            key={`x-${index}`}
            numberOfLines={1}
            style={styles.overlayXAxisLabel}
            variant="caption">
            {tick}
          </AppText>
        ))}
      </View>

      <View style={styles.legend}>
        {series.map((sig, index) => {
          const color = CHART_COLORS[index % CHART_COLORS.length];
          const latest = latestFiniteValue(data, sig);
          return (
            <View key={sig} style={styles.legendItem}>
              <View style={[styles.legendDot, {backgroundColor: color}]} />
              <AppText
                numberOfLines={1}
                style={styles.legendLabel}
                tone="secondary"
                variant="caption">
                {sig}
              </AppText>
              <AppText numberOfLines={1} variant="caption" weight="semibold">
                {formatAxisNumber(latest)}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/* ─── component ────────────────────────────────────────────────────────────── */

export function SignalChartPanel({
  selectedSignals,
  data,
  stats,
  isLive = false,
  loading = false,
  pointsLoaded,
  liveEventCount,
  title,
  height = DEFAULT_HEIGHT,
  chartMode = 'auto',
  gridAutoThreshold = DEFAULT_GRID_AUTO_THRESHOLD,
  gridCellHeight = DEFAULT_GRID_CELL_HEIGHT,
  className: _className,
  style,
}: SignalChartPanelProps) {
  const t = useNativeTranslation();

  const useRightAxis = useMemo(() => {
    if (!stats || stats.length < 2) {
      return false;
    }
    const ranges = stats.map((s) => Math.abs(s.max - s.min) || 1);
    return ranges[0] / ranges[1] > 10 || ranges[1] / ranges[0] > 10;
  }, [stats]);

  // Resolve auto → overlay/grid. Grid requires at least 2 signals to be
  // meaningful; for a single signal we always render the larger overlay chart.
  const effectiveMode: 'overlay' | 'grid' = useMemo(() => {
    if (chartMode === 'overlay') {
      return 'overlay';
    }
    if (chartMode === 'grid') {
      return selectedSignals.length >= 2 ? 'grid' : 'overlay';
    }
    return selectedSignals.length > gridAutoThreshold ? 'grid' : 'overlay';
  }, [chartMode, selectedSignals.length, gridAutoThreshold]);

  const resolvedTitle =
    title ?? (isLive ? t('Live Signal Stream') : t('Signal Chart'));

  let annotation: ReactNode = null;
  if (isLive) {
    annotation = (
      <View style={styles.annotationRow}>
        <PulseView>
          <View style={styles.annotationDot} />
        </PulseView>
        <AppText numberOfLines={1} style={styles.annotationLive} variant="caption">
          {`${fmtInt(liveEventCount ?? 0)} ${t('events')} · ${fmtInt(
            data.length,
          )} ${t('points')}`}
        </AppText>
      </View>
    );
  } else if (data.length > 0 && pointsLoaded != null) {
    annotation = (
      <AppText numberOfLines={1} style={styles.annotationMuted} variant="caption">
        {`${fmtInt(pointsLoaded)} ${t('points loaded')}`}
      </AppText>
    );
  }

  let body: ReactNode;
  if (loading && !isLive) {
    body = (
      <View style={{height}}>
        <View style={[styles.skeleton, {height}]} />
      </View>
    );
  } else if (data.length > 0) {
    body =
      effectiveMode === 'grid' ? (
        <SmallMultiplesChart
          cellHeight={gridCellHeight}
          data={data}
          series={selectedSignals}
          syncId={`signal-chart-${isLive ? 'live' : 'historical'}`}
        />
      ) : (
        <OverlayLineChart
          data={data}
          height={height}
          series={selectedSignals}
          useRightAxis={useRightAxis}
        />
      );
  } else if (isLive) {
    body = (
      <View style={[styles.emptyState, {height}]}>
        <PulseView>
          <AppText style={styles.emptyIconLive}>{ICON_RADIO}</AppText>
        </PulseView>
        <AppText tone="muted">{t('Waiting for signal data…')}</AppText>
      </View>
    );
  } else {
    body = (
      <View style={[styles.emptyState, {height}]}>
        <AppText style={styles.emptyIcon} tone="muted">
          {ICON_ACTIVITY}
        </AppText>
        <AppText tone="muted">{t('No data for this time range')}</AppText>
      </View>
    );
  }

  return (
    <FadeIn>
      <GlassPanel padding="md" style={style}>
        <View style={styles.header}>
          {isLive ? (
            <PulseView>
              <AppText style={styles.headerIconLive}>{ICON_RADIO}</AppText>
            </PulseView>
          ) : (
            <AppText style={styles.headerIcon}>{ICON_BAR_CHART}</AppText>
          )}
          <AppText style={styles.title} weight="semibold">
            {resolvedTitle}
          </AppText>
          <View style={styles.headerSpacer} />
          {annotation}
        </View>

        {body}
      </GlassPanel>
    </FadeIn>
  );
}

SignalChartPanel.displayName = 'SignalChartPanel';

const styles = StyleSheet.create({
  annotationDot: {
    backgroundColor: RED_500,
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  annotationLive: {
    color: RED_400,
    fontSize: 10,
  },
  annotationMuted: {
    color: colors.textMuted,
    fontSize: 10,
  },
  annotationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  emptyIcon: {
    fontSize: 18,
  },
  emptyIconLive: {
    color: RED_500,
    fontSize: 18,
  },
  emptyState: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerIcon: {
    color: colors.accent,
    fontSize: 14,
  },
  headerIconLive: {
    color: RED_500,
    fontSize: 14,
  },
  headerSpacer: {
    flex: 1,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  legendDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendLabel: {
    fontFamily: 'monospace',
    maxWidth: 160,
  },
  overlayAxisLabel: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'right',
  },
  overlayAxisLabelRight: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'left',
  },
  overlayDot: {
    borderColor: colors.background,
    borderRadius: 3,
    borderWidth: 1,
    height: 6,
    position: 'absolute',
    width: 6,
  },
  overlayFrame: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  overlayGridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.4,
    position: 'absolute',
    right: 0,
  },
  overlayPlot: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  overlaySegment: {
    borderRadius: OVERLAY_STROKE_WIDTH / 2,
    height: OVERLAY_STROKE_WIDTH,
    position: 'absolute',
  },
  overlayXAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    minHeight: 14,
  },
  overlayXAxisLabel: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 10,
    minWidth: 0,
    textAlign: 'center',
  },
  overlayYAxis: {
    justifyContent: 'space-between',
  },
  overlayYAxisRight: {
    alignItems: 'flex-start',
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    width: '100%',
  },
  title: {
    fontSize: 18,
    letterSpacing: -0.2,
  },
});
