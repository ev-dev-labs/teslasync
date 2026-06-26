// Native parity port of
// web/src/features/driving/components/drive-detail/ElevationChart.tsx.
//
// Renders the drive-detail "Elevation Profile" panel: a dense per-sample
// elevation+speed trace with a gain/loss/net stats row above the chart. The web
// file leans on browser-only dependencies that are absent from the native
// parity manifest (contract rules 4, 5 & 7); each is replaced with a React
// Native-safe equivalent and documented in the sidecar:
//
//   - react-i18next `useTranslation` (web L1, L22) -> inline useNativeTranslation():
//     a stable (key, fallback) => fallback shim so every t('key', 'English') call
//     keeps its English default and translation-key intent. Keys preserved:
//     driveDetail.elevProfile[/.aria], driveDetail.gain, driveDetail.loss,
//     driveDetail.net, driveDetail.elevation, driveDetail.speed,
//     driveDetail.noChartData.
//   - lucide-react Activity/ArrowUpRight/ArrowDownRight (web L2, L40-41, L75) ->
//     the empty state pairs the shared SemanticIcon 'activity' glyph with the
//     message (matching the web icon+message shape); the inline gain/loss arrows
//     become decorative ↗/↘ glyphs hidden from assistive tech, the same tiny-arrow
//     intent at a native-friendly size.
//   - @/components/charts Recharts ComposedChart/Area/Line/XAxis/YAxis/
//     CartesianGrid/Tooltip/Legend/ResponsiveContainer/ReferenceLine (web L3-8,
//     L44-71) -> the native ChartContainer parity component wraps a custom plot
//     built from View primitives. Recharts depends on browser DOM/SVG and is
//     unavailable on native, so the elevation series is drawn as translucent area
//     columns plus rounded line segments (#10b981, strokeWidth 2) and the speed
//     series as overlaid rounded line segments (#a855f7, strokeWidth 1.5, opacity
//     0.6) — the shared SessionComparisonChart projection technique — with faint
//     horizontal gridlines (CartesianGrid), dual y-axis ticks (elevation m /
//     speed unit), start/end x-axis time ticks (interval="preserveStartEnd") and
//     a colour-swatch legend mirroring the Recharts series names. The hover
//     Tooltip (`Tooltip`/ChartTooltip) requires a DOM pointer and is unavailable
//     on native — values are conveyed by the axis ticks, the legend and the
//     per-plot accessibility label instead.
//   - @/components/charts useSyncedCursor + useSyncedReferenceLineX (web L7, L25-26,
//     L47-49, L59-69) -> the ported native cursor-sync hooks (same barrel). The
//     reference line is drawn from the shared synced value exactly like the web
//     ReferenceLine; the web mouse-move producer (onMouseMove, no native pointer)
//     is driven instead by a tap on the plot (nativeEvent.locationX -> nearest
//     sample time -> onMouseMove), preserving the cross-chart cursor-sync contract.
//   - @/lib/tokens chartTokens.cursor (web L9, L63-65) -> CURSOR_COLOR
//     rgba(255,255,255,0.3) + width 1; the '4 2' strokeDasharray has no plain-View
//     equivalent so the cursor renders as a solid hairline (ElevationProfile
//     precedent).
//   - @/components/motion FadeIn (web L10, L29, L80) -> an Animated.View opacity
//     0->1 mount fade; the web `h-full` maps to flex:1.
//   - @/hooks/useUnits unitPrefs.speed + @/lib/numberFormat fmtNumber (web L11-12,
//     L23-24, L40-42, L58) -> useFormatPrefs(): speedUnit mirrors deriveSpeed and
//     fmt() mirrors the locale/precision-aware fmtNumber (settings-derived).
//   - ./helpers LEGEND_STYLE (web L13, L56) -> the native legend uses caption
//     typography + textMuted, the same 10px/#9ca3af-muted intent.
//   - ./types ChartDataPoint/DriveStats (web L14) -> ported verbatim as local
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

// ./types ChartDataPoint — ported verbatim (subset of fields is consumed here, but
// the full shape is preserved for parity; all fields are pure primitives).
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

interface ElevationChartProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
}

const ELEVATION_COLOR = '#10b981';
const SPEED_COLOR = '#a855f7';
const SPEED_OPACITY = 0.6;
// @/lib/tokens chartTokens.cursor: stroke rgba(255,255,255,0.3), strokeWidth 1.
const CURSOR_COLOR = 'rgba(255, 255, 255, 0.3)';
const CURSOR_WIDTH = 1;
const CHART_HEIGHT = 220;
const PLOT_HEIGHT = 140;
const PLOT_PADDING = 6;
const ELEV_STROKE = 2;
const SPEED_STROKE = 1.5;
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
  elevation: number;
  speed: number;
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
    elevation: safeFinite(point.elevation, 0),
    frac: n === 1 ? 0 : index / (n - 1),
    speed: safeFinite(point.speed, 0),
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

function buildDomain(values: number[]): AxisDomain {
  let min = Infinity;
  let max = -Infinity;
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
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return {max: 1, min: 0};
  }
  if (min === max) {
    const padding = Math.max(Math.abs(max) * 0.05, 1);
    return {max: max + padding, min: min - padding};
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

function buildAreaColumns(points: PlotPoint[], plotWidth: number): PlotColumn[] {
  if (points.length === 0 || plotWidth <= 0) {
    return [];
  }
  const baseline = PLOT_HEIGHT - PLOT_PADDING;
  const columnWidth = Math.max(plotWidth / Math.max(points.length, 1), 1);
  return points.map((point, index) => ({
    height: Math.max(baseline - point.y, 0),
    key: `area-${index}`,
    left: point.x - columnWidth / 2,
    top: point.y,
    width: columnWidth,
  }));
}

function LegendItem({color, label, opacity}: {color: string; label: string; opacity?: number}) {
  return (
    <View accessibilityLabel={label} accessible style={styles.legendItem}>
      <View style={[styles.legendSwatch, {backgroundColor: color, opacity: opacity ?? 1}]} />
      <AppText style={styles.legendText} tone="muted" variant="caption">
        {label}
      </AppText>
    </View>
  );
}

// @/components/motion FadeIn -> Animated.View opacity 0->1 mount fade (h-full -> flex:1).
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

  return <Animated.View style={[styles.fill, {opacity}]}>{children}</Animated.View>;
}

export function ElevationChart({chartData, stats}: ElevationChartProps) {
  const t = useNativeTranslation();
  const prefs = useFormatPrefs();
  const speedUnit = prefs.speedUnit;
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();
  const [plotWidth, setPlotWidth] = useState(0);

  const samples = useMemo(
    () => (Array.isArray(chartData) ? chartData : []),
    [chartData],
  );
  const hasChart = samples.length > 1;

  const projected = useMemo(() => downsample(samples), [samples]);

  const elevDomain = useMemo(
    () => buildDomain(samples.map(point => point.elevation)),
    [samples],
  );
  const speedDomain = useMemo(
    () => buildDomain(samples.map(point => point.speed)),
    [samples],
  );

  const elevPoints = useMemo<PlotPoint[]>(
    () =>
      projected.map(sample => ({
        x: projectX(sample.frac, plotWidth),
        y: projectY(sample.elevation, elevDomain),
      })),
    [projected, plotWidth, elevDomain],
  );
  const speedPoints = useMemo<PlotPoint[]>(
    () =>
      projected.map(sample => ({
        x: projectX(sample.frac, plotWidth),
        y: projectY(sample.speed, speedDomain),
      })),
    [projected, plotWidth, speedDomain],
  );

  const areaColumns = useMemo(
    () => buildAreaColumns(elevPoints, plotWidth),
    [elevPoints, plotWidth],
  );
  const elevSegments = useMemo(
    () => buildSegments(elevPoints, ELEV_STROKE, 'elev'),
    [elevPoints],
  );
  const speedSegments = useMemo(
    () => buildSegments(speedPoints, SPEED_STROKE, 'speed'),
    [speedPoints],
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

  const elevLabel = `${t('driveDetail.elevation', 'Elevation')} (m)`;
  const speedLabel = `${t('driveDetail.speed', 'Speed')} (${speedUnit})`;
  const ariaLabel = t(
    'driveDetail.elevProfile.aria',
    'Elevation and speed area+line chart over the drive timeline',
  );

  const elevTicks = [elevDomain.max, (elevDomain.max + elevDomain.min) / 2, elevDomain.min];
  const speedTicks = [speedDomain.max, (speedDomain.max + speedDomain.min) / 2, speedDomain.min];
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
      {/* chart-a11y:no-table dense per-sample elevation+speed trace; gain/loss/net stats appear above the chart */}
      <ChartContainer
        ariaLabel={ariaLabel}
        height={CHART_HEIGHT}
        title={t('driveDetail.elevProfile', 'Elevation Profile')}>
        {hasChart ? (
          <View style={styles.fill}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <AppText
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={[styles.statGlyph, styles.gainGlyph]}
                  variant="caption">
                  {'\u2197'}
                </AppText>
                <AppText style={styles.gainText} variant="caption">
                  {`${prefs.fmt(stats.elevGain)} m ${t('driveDetail.gain', 'gain')}`}
                </AppText>
              </View>
              <View style={styles.statItem}>
                <AppText
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={[styles.statGlyph, styles.lossGlyph]}
                  variant="caption">
                  {'\u2198'}
                </AppText>
                <AppText style={styles.lossText} variant="caption">
                  {`${prefs.fmt(stats.elevLoss)} m ${t('driveDetail.loss', 'loss')}`}
                </AppText>
              </View>
              <AppText style={styles.netText} tone="muted" variant="caption">
                {`${t('driveDetail.net', 'Net')}: ${prefs.fmt(stats.elevGain - stats.elevLoss)} m`}
              </AppText>
            </View>

            <View style={styles.plotRow}>
              <View style={styles.yAxis}>
                {elevTicks.map((tick, index) => (
                  <AppText
                    key={`elev-tick-${index}`}
                    numberOfLines={1}
                    style={styles.axisLabel}
                    variant="caption">
                    {prefs.fmt(tick, 0)}
                  </AppText>
                ))}
              </View>

              <Pressable
                accessibilityLabel={ariaLabel}
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

                {elevSegments.map(segment => (
                  <View
                    key={segment.key}
                    pointerEvents="none"
                    style={[
                      styles.elevSegment,
                      {
                        left: segment.left,
                        top: segment.top,
                        transform: [{rotateZ: segment.angle}],
                        width: segment.width,
                      },
                    ]}
                  />
                ))}

                {speedSegments.map(segment => (
                  <View
                    key={segment.key}
                    pointerEvents="none"
                    style={[
                      styles.speedSegment,
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

              <View style={styles.yAxisRight}>
                {speedTicks.map((tick, index) => (
                  <AppText
                    key={`speed-tick-${index}`}
                    numberOfLines={1}
                    style={styles.axisLabelRight}
                    variant="caption">
                    {prefs.fmt(tick, 0)}
                  </AppText>
                ))}
              </View>
            </View>

            <View style={styles.xAxisRow}>
              <AppText numberOfLines={1} style={styles.axisLabel} variant="caption">
                {startTime}
              </AppText>
              <AppText numberOfLines={1} style={styles.xAxisEnd} variant="caption">
                {endTime}
              </AppText>
            </View>

            <View style={styles.legend}>
              <LegendItem color={ELEVATION_COLOR} label={elevLabel} />
              <LegendItem color={SPEED_COLOR} label={speedLabel} opacity={SPEED_OPACITY} />
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
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  areaColumn: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    position: 'absolute',
  },
  axisLabel: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'left',
  },
  axisLabelRight: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'right',
  },
  cursorLine: {
    backgroundColor: CURSOR_COLOR,
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: CURSOR_WIDTH,
  },
  elevSegment: {
    backgroundColor: ELEVATION_COLOR,
    borderRadius: ELEV_STROKE / 2,
    height: ELEV_STROKE,
    position: 'absolute',
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
  gainGlyph: {
    color: colors.success,
  },
  gainText: {
    color: colors.success,
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
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendSwatch: {
    borderRadius: 2,
    height: 8,
    width: 12,
  },
  legendText: {
    fontSize: 10,
  },
  lossGlyph: {
    color: colors.danger,
  },
  lossText: {
    color: colors.danger,
  },
  netText: {
    fontSize: 11,
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
  speedSegment: {
    backgroundColor: SPEED_COLOR,
    borderRadius: SPEED_STROKE / 2,
    height: SPEED_STROKE,
    opacity: SPEED_OPACITY,
    position: 'absolute',
  },
  statGlyph: {
    fontSize: 11,
  },
  statItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.sm,
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
  yAxisRight: {
    alignItems: 'flex-end',
    height: PLOT_HEIGHT,
    justifyContent: 'space-between',
    width: 38,
  },
});
