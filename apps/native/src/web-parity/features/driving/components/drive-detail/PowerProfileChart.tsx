// Native parity port of
// web/src/features/driving/components/drive-detail/PowerProfileChart.tsx.
//
// Renders the drive-detail "Power Profile" panel: a dense per-sample power trace
// (kW) with a zero baseline that separates positive power (consumption) from
// negative power (regen), plus a max-power / max-regen / average stats row below
// the chart. The web file leans on browser-only dependencies that are absent
// from the native parity manifest (contract rules 4, 5 & 7); each is replaced
// with a React Native-safe equivalent and documented in the sidecar:
//
//   - react-i18next `useTranslation` (web L1, L21) -> inline useNativeTranslation():
//     a stable (key, fallback) => fallback shim so every t('key', 'English') call
//     keeps its English default and translation-key intent. Keys preserved:
//     driveDetail.powerProfile[/.aria], driveDetail.power, driveDetail.noChartData,
//     driveDetail.maxPower, driveDetail.maxRegen, driveDetail.avgLabel.
//   - lucide-react Activity (web L2, L62) -> the empty state pairs the shared
//     SemanticIcon 'activity' glyph (opacity 0.2) with the message, matching the
//     web icon+message shape.
//   - @/components/charts Recharts AreaChart/Area/ReferenceLine/XAxis/YAxis/
//     CartesianGrid/Tooltip/ResponsiveContainer + AREA_DEFAULTS/areaGradient
//     (web L3-7, L34-59) -> the native ChartContainer parity component wraps a
//     custom plot built from View primitives. Recharts depends on browser DOM/SVG
//     and is unavailable on native, so the power series is drawn as translucent
//     area columns anchored to a zero baseline plus rounded line segments
//     (#f59e0b, strokeWidth 2 from AREA_DEFAULTS) — the shared ElevationChart
//     projection technique — with faint horizontal gridlines (CartesianGrid), a
//     single y-axis tick column (power kW), start/end x-axis time ticks
//     (interval="preserveStartEnd") and a zero ReferenceLine. The areaGradient
//     SVG linear gradient (#f59e0b, opacity 0.3 -> 0.02) has no plain-View
//     equivalent and is approximated by a flat translucent amber fill. The hover
//     Tooltip (`Tooltip`/ChartTooltip) requires a DOM pointer and is unavailable
//     on native — values are conveyed by the axis ticks, the stats row and the
//     per-plot accessibility label (which embeds the `driveDetail.power` series
//     name) instead.
//   - @/components/charts useSyncedCursor + useSyncedReferenceLineX (web L8, L22-23,
//     L37-39, L48-57) -> the ported native cursor-sync hooks (same barrel). The
//     reference line is drawn from the shared synced value exactly like the web
//     ReferenceLine; the web mouse-move producer (onMouseMove, no native pointer)
//     is driven instead by a tap on the plot (nativeEvent.locationX -> nearest
//     sample time -> onMouseMove), preserving the cross-chart cursor-sync contract.
//   - @/lib/tokens chartTokens.cursor (web L10, L51-53) -> CURSOR_COLOR
//     rgba(255,255,255,0.3) + width 1; the '4 2' strokeDasharray has no plain-View
//     equivalent so the cursor renders as a solid hairline (ElevationChart precedent).
//   - @/components/motion FadeIn (web L11, L26, L74) -> an Animated.View opacity
//     0->1 mount fade.
//   - @/lib/numberFormat fmtInt + fmtNumber (web L12, L69-71) -> useFormatPrefs():
//     prefs.fmt(v, 0) mirrors fmtInt (locale-aware, 0 decimals) and prefs.fmt(v)
//     mirrors fmtNumber at the settings-derived global precision.
//   - ./types ChartDataPoint/DriveStats (web L13) -> ported verbatim as local
//     interfaces (both are pure primitive/array shapes with no external deps; the
//     unrelated RoutePoint/SpeedSegment/SpeedHistogramBucket and their Leaflet
//     LatLngExpression import are not needed here and are intentionally omitted).
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, lucide-react, react-i18next
// or web UI components are imported — only react, react-native primitives, the
// ported web-parity ChartContainer + cursor-sync hooks + useFormatPrefs bridge, and
// the existing apps/native SemanticIcon / AppText / theme tokens.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {
  ChartContainer,
  useSyncedCursor,
  useSyncedReferenceLineX,
} from '../../../../components/charts';
import {useFormatPrefs} from '../../../../components/data-display/format/_formatPrimitives';

type NativeTFunction = (key: string, fallback: string) => string;

// ./types ChartDataPoint — ported verbatim (a subset of fields is consumed here,
// but the full shape is preserved for parity; all fields are pure primitives).
interface ChartDataPoint {
  time: string;
  speed: number;
  battery: number;
  elevation: number;
  power: number;
  outsideTemp: number | null;
  insideTemp: number | null;
  driverTemp: number | null;
  passengerTemp: number | null;
  idealRange: number | null;
  ratedRange: number | null;
  estRange: number | null;
  odometer: number | null;
  soc: number | null;
  usableSoc: number | null;
  tireFl: number | null;
  tireFr: number | null;
  tireRl: number | null;
  tireRr: number | null;
  climateOn: boolean | null;
  fanStatus: number | null;
}

// ./types DriveStats — ported verbatim.
interface DriveStats {
  maxSpd: number;
  avgSpd: number;
  minSpd: number;
  powerMax: number;
  powerMin: number;
  avgPower: number;
  energyWh: number;
  regenWh: number;
  consumptionWhKm: number;
  elevGain: number;
  elevLoss: number;
  avgOutsideTemp: number | null;
  avgInsideTemp: number | null;
  hasAnyTemp: boolean;
  insideTemps: number[];
  outsideTemps: number[];
  driverTemps: number[];
  passengerTemps: number[];
  climateStatus: string | null;
  avgFanSpeed: number | null;
  maxFanSpeed: number | null;
  startRange: number | null;
  endRange: number | null;
  odometerStart: number;
  odometerEnd: number;
  hasTirePressure: boolean;
  efficiencyPctPer100: number | null;
}

interface PowerProfileChartProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
}

// Web Area stroke/fill colour (#f59e0b) and the toned stat-row colours.
const POWER_COLOR = '#f59e0b';
// areaGradient(#f59e0b) translucent fill approximation (opacity ~0.3 top stop).
const POWER_AREA_FILL = 'rgba(245, 158, 11, 0.2)';
// text-amber-400 (max power) / text-cyan-400 (max regen) stat-value colours.
const MAX_POWER_COLOR = colors.warning;
const MAX_REGEN_COLOR = '#22d3ee';
// ReferenceLine y={0} stroke rgba(255,255,255,0.15).
const ZERO_LINE_COLOR = 'rgba(255, 255, 255, 0.15)';
// @/lib/tokens chartTokens.cursor: stroke rgba(255,255,255,0.3), strokeWidth 1.
const CURSOR_COLOR = 'rgba(255, 255, 255, 0.3)';
const CURSOR_WIDTH = 1;
const CHART_HEIGHT = 220;
const PLOT_HEIGHT = 150;
const PLOT_PADDING = 6;
// AREA_DEFAULTS.strokeWidth.
const POWER_STROKE = 2;
// Telemetry traces can be very dense; cap the rendered sample count so the
// segment overlay stays performant while preserving first/last samples.
const MAX_POINTS = 160;
const FADE_DURATION_MS = 300;
const EM_DASH = '\u2014';

// react-i18next useTranslation replacement: returns the English fallback so the
// translation-key intent is preserved at every call site.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

interface SampleProjection {
  /** Fraction along the x axis (0..1) from the original full-data index. */
  frac: number;
  power: number;
}

interface PlotPoint {
  x: number;
  y: number;
}

interface PlotSegment {
  key: string;
  left: number;
  top: number;
  width: number;
  angle: string;
}

interface PlotColumn {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface AxisDomain {
  min: number;
  max: number;
}

function safeFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

// Evenly downsample to at most `max` samples, always keeping endpoints, and carry
// each kept sample's original 0..1 fraction so x positions stay aligned with the
// full-data cursor mapping.
function downsample(data: ChartDataPoint[]): SampleProjection[] {
  const n = data.length;
  if (n === 0) {
    return [];
  }
  const toProjection = (point: ChartDataPoint, index: number): SampleProjection => ({
    frac: n === 1 ? 0 : index / (n - 1),
    power: safeFinite(point.power, 0),
  });
  if (n <= MAX_POINTS) {
    return data.map(toProjection);
  }
  const step = (n - 1) / (MAX_POINTS - 1);
  const out: SampleProjection[] = [];
  for (let j = 0; j < MAX_POINTS; j++) {
    const index = Math.min(n - 1, Math.round(j * step));
    out.push(toProjection(data[index], index));
  }
  return out;
}

// Build a domain that always spans zero so the area baseline + ReferenceLine y={0}
// render correctly and regen (negative power) is shown below the zero line — the
// recharts AreaChart baseValue-0 contract reproduced for a plain-View plot.
function buildPowerDomain(values: number[]): AxisDomain {
  let min = 0;
  let max = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }
  if (min === max) {
    return {max: max + 1, min: min - 1};
  }
  return {max, min};
}

function projectX(frac: number, plotWidth: number): number {
  return PLOT_PADDING + frac * (plotWidth - PLOT_PADDING * 2);
}

function projectY(value: number, domain: AxisDomain): number {
  const span = domain.max - domain.min || 1;
  const ratio = (value - domain.min) / span;
  return PLOT_HEIGHT - PLOT_PADDING - ratio * (PLOT_HEIGHT - PLOT_PADDING * 2);
}

function buildSegments(points: PlotPoint[], stroke: number, prefix: string): PlotSegment[] {
  if (points.length < 2) {
    return [];
  }
  return points.slice(1).map((point, index) => {
    const previous = points[index];
    const deltaX = point.x - previous.x;
    const deltaY = point.y - previous.y;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const midpointX = previous.x + deltaX / 2;
    const midpointY = previous.y + deltaY / 2;
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    return {
      angle: `${angle}deg`,
      key: `${prefix}-${index}`,
      left: midpointX - length / 2,
      top: midpointY - stroke / 2,
      width: length,
    };
  });
}

// Area fill anchored to the zero baseline: positive power fills down to zero,
// negative power (regen) fills up to zero — mirroring the Recharts Area baseline.
function buildAreaColumns(points: PlotPoint[], baselineY: number, plotWidth: number): PlotColumn[] {
  if (points.length === 0 || plotWidth <= 0) {
    return [];
  }
  const columnWidth = Math.max(plotWidth / Math.max(points.length, 1), 1);
  return points.map((point, index) => ({
    height: Math.abs(point.y - baselineY),
    key: `area-${index}`,
    left: point.x - columnWidth / 2,
    top: Math.min(point.y, baselineY),
    width: columnWidth,
  }));
}

// @/components/motion FadeIn -> Animated.View opacity 0->1 mount fade.
function FadeIn({children}: {children: ReactNode}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      duration: FADE_DURATION_MS,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <Animated.View style={{opacity}}>{children}</Animated.View>;
}

export function PowerProfileChart({chartData, stats}: PowerProfileChartProps) {
  const t = useNativeTranslation();
  const prefs = useFormatPrefs();
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();
  const [plotWidth, setPlotWidth] = useState(0);

  const samples = useMemo(
    () => (Array.isArray(chartData) ? chartData : []),
    [chartData],
  );
  const hasChart = samples.length > 1;

  const projected = useMemo(() => downsample(samples), [samples]);

  const powerDomain = useMemo(
    () => buildPowerDomain(samples.map(point => point.power)),
    [samples],
  );

  const powerPoints = useMemo<PlotPoint[]>(
    () =>
      projected.map(sample => ({
        x: projectX(sample.frac, plotWidth),
        y: projectY(sample.power, powerDomain),
      })),
    [projected, plotWidth, powerDomain],
  );

  const baselineY = useMemo(() => projectY(0, powerDomain), [powerDomain]);

  const areaColumns = useMemo(
    () => buildAreaColumns(powerPoints, baselineY, plotWidth),
    [powerPoints, baselineY, plotWidth],
  );
  const powerSegments = useMemo(
    () => buildSegments(powerPoints, POWER_STROKE, 'power'),
    [powerPoints],
  );

  // Mirror the web ReferenceLine: resolve the shared synced x (a `time` label)
  // to a plot x using the full-data fraction so it lines up with the trace.
  const cursorLeft = useMemo(() => {
    if (syncedX == null || plotWidth <= 0 || samples.length < 2) {
      return null;
    }
    const target = String(syncedX);
    const index = samples.findIndex(point => String(point.time) === target);
    if (index < 0) {
      return null;
    }
    return projectX(index / (samples.length - 1), plotWidth);
  }, [syncedX, plotWidth, samples]);

  const seriesLabel = `${t('driveDetail.power', 'Power')} kW`;
  const ariaLabel = t(
    'driveDetail.powerProfile.aria',
    'Drive power profile area chart over time',
  );

  const powerTicks = [powerDomain.max, (powerDomain.max + powerDomain.min) / 2, powerDomain.min];
  const startTime = samples[0]?.time ?? EM_DASH;
  const endTime = samples[samples.length - 1]?.time ?? EM_DASH;

  const handlePlotLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setPlotWidth(previous => (Math.abs(previous - width) > 1 ? width : previous));
  };

  // Native pointer-less analogue of the Recharts onMouseMove producer: a tap maps
  // its x to the nearest sample's `time` and publishes it to the synced cursor.
  const handlePlotPress = (event: GestureResponderEvent) => {
    if (!syncProps.onMouseMove || plotWidth <= 0 || samples.length < 2) {
      return;
    }
    const span = plotWidth - PLOT_PADDING * 2 || 1;
    const ratio = (event.nativeEvent.locationX - PLOT_PADDING) / span;
    const clamped = Math.min(1, Math.max(0, ratio));
    const index = Math.round(clamped * (samples.length - 1));
    const sample = samples[index];
    if (sample) {
      syncProps.onMouseMove({activeLabel: sample.time});
    }
  };

  return (
    <FadeIn>
      {/* chart-a11y:no-table dense per-sample power trace; max/regen/avg stats appear below the chart */}
      <ChartContainer
        ariaLabel={ariaLabel}
        height={CHART_HEIGHT}
        title={t('driveDetail.powerProfile', 'Power Profile')}>
        {hasChart ? (
          <View style={styles.fill}>
            <View style={styles.plotRow}>
              <View style={styles.yAxis}>
                {powerTicks.map((tick, index) => (
                  <AppText
                    key={`power-tick-${index}`}
                    numberOfLines={1}
                    style={styles.axisLabel}
                    variant="caption">
                    {prefs.fmt(tick, 0)}
                  </AppText>
                ))}
              </View>

              <Pressable
                accessibilityLabel={`${ariaLabel}. ${seriesLabel}`}
                accessibilityRole="image"
                accessible
                onLayout={handlePlotLayout}
                onPress={handlePlotPress}
                style={styles.plot}>
                <View pointerEvents="none" style={[styles.gridLine, styles.gridLineTop]} />
                <View pointerEvents="none" style={[styles.gridLine, styles.gridLineMid]} />
                <View pointerEvents="none" style={[styles.gridLine, styles.gridLineBottom]} />

                {areaColumns.map(column => (
                  <View
                    key={column.key}
                    pointerEvents="none"
                    style={[
                      styles.areaColumn,
                      {
                        height: column.height,
                        left: column.left,
                        top: column.top,
                        width: column.width,
                      },
                    ]}
                  />
                ))}

                {/* ReferenceLine y={0}: the consumption/regen divider. */}
                <View pointerEvents="none" style={[styles.zeroLine, {top: baselineY}]} />

                {powerSegments.map(segment => (
                  <View
                    key={segment.key}
                    pointerEvents="none"
                    style={[
                      styles.powerSegment,
                      {
                        left: segment.left,
                        top: segment.top,
                        transform: [{rotateZ: segment.angle}],
                        width: segment.width,
                      },
                    ]}
                  />
                ))}

                {cursorLeft != null ? (
                  <View pointerEvents="none" style={[styles.cursorLine, {left: cursorLeft}]} />
                ) : null}
              </Pressable>
            </View>

            <View style={styles.xAxisRow}>
              <AppText numberOfLines={1} style={styles.axisLabel} variant="caption">
                {startTime}
              </AppText>
              <AppText numberOfLines={1} style={styles.xAxisEnd} variant="caption">
                {endTime}
              </AppText>
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <SemanticIcon decorative name="activity" size="lg" style={styles.emptyIcon} />
            <AppText tone="muted" variant="caption">
              {t('driveDetail.noChartData', 'No telemetry data available')}
            </AppText>
          </View>
        )}
      </ChartContainer>

      {hasChart ? (
        <View style={styles.statsRow}>
          <AppText style={styles.statText} tone="secondary" variant="caption">
            {`${t('driveDetail.maxPower', 'Max Power')}: `}
            <AppText style={styles.maxPowerValue} variant="caption" weight="bold">
              {`${prefs.fmt(stats.powerMax, 0)} kW`}
            </AppText>
          </AppText>
          <AppText style={styles.statText} tone="secondary" variant="caption">
            {`${t('driveDetail.maxRegen', 'Max Regen')}: `}
            <AppText style={styles.maxRegenValue} variant="caption" weight="bold">
              {`${prefs.fmt(stats.powerMin, 0)} kW`}
            </AppText>
          </AppText>
          <AppText style={styles.statText} tone="secondary" variant="caption">
            {`${t('driveDetail.avgLabel', 'Avg')}: `}
            <AppText style={styles.avgValue} variant="caption" weight="bold">
              {`${prefs.fmt(stats.avgPower)} kW`}
            </AppText>
          </AppText>
        </View>
      ) : null}
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  areaColumn: {
    backgroundColor: POWER_AREA_FILL,
    position: 'absolute',
  },
  avgValue: {
    color: colors.textPrimary,
  },
  axisLabel: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'left',
  },
  cursorLine: {
    backgroundColor: CURSOR_COLOR,
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: CURSOR_WIDTH,
  },
  emptyIcon: {
    opacity: 0.2,
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  fill: {
    flex: 1,
  },
  gridLine: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  gridLineBottom: {
    bottom: PLOT_PADDING,
  },
  gridLineMid: {
    top: PLOT_HEIGHT / 2,
  },
  gridLineTop: {
    top: PLOT_PADDING,
  },
  maxPowerValue: {
    color: MAX_POWER_COLOR,
  },
  maxRegenValue: {
    color: MAX_REGEN_COLOR,
  },
  plot: {
    flex: 1,
    height: PLOT_HEIGHT,
    overflow: 'hidden',
    position: 'relative',
  },
  plotRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  powerSegment: {
    backgroundColor: POWER_COLOR,
    borderRadius: POWER_STROKE / 2,
    height: POWER_STROKE,
    position: 'absolute',
  },
  statText: {
    fontSize: 11,
  },
  statsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  xAxisEnd: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'right',
  },
  xAxisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingLeft: 44,
  },
  yAxis: {
    alignItems: 'flex-start',
    height: PLOT_HEIGHT,
    justifyContent: 'space-between',
    width: 38,
  },
  zeroLine: {
    backgroundColor: ZERO_LINE_COLOR,
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
    right: 0,
  },
});
