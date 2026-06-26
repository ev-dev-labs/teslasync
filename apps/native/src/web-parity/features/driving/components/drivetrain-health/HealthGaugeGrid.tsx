// Native parity port of
// web/src/features/driving/components/drivetrain-health/HealthGaugeGrid.tsx.
//
// The web component renders a responsive 1-up / md:3-up grid of three glass
// panels inside a `FadeIn`:
//   1. a RadialGauge health-score gauge + a caption,
//   2. a "Motor Details" KVList (status, overall health, score, active sensor
//      count) followed by an Activity-icon "real-time telemetry active" row,
//   3. a "Drive Statistics" KVList (total drives / distance / avg speed / top
//      speed) that falls back to a 4-line Skeleton while `stats` is undefined.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - `@/components/ui` GlassPanel -> the native parity `components/ui/GlassPanel`
//     (the same translucent bordered surface every parity feature uses); the web
//     `className` paddings/centering become RN `style` (p-6 -> 24, the gauge
//     panel's flex/items/justify-center -> alignItems/justifyContent center).
//   - `@/components/layout` Grid (CSS `grid-cols-1 md:grid-cols-3 gap-4`) -> an
//     inline native Grid: it measures its width via onLayout, resolves the column
//     count from the same Tailwind breakpoints (default 1, md>=768 -> 3) and lays
//     the children out in a flex-wrap row with computed cell widths + a 16px gap
//     (gap-4). On a phone the default 1-column layout applies (panels stack).
//   - `@/components/data-display` KVList -> an inline native KVList (label/value
//     rows, top-border dividers between rows, label muted, value primary
//     semibold) matching the web `<dl>`/`flex justify-between py-2` structure.
//   - `@/components/feedback` Skeleton (`lines={4}`) -> an inline native Skeleton:
//     4 pulsing placeholder bars (opacity loop, reduce-motion-aware), the last at
//     60% width like the web `animate-pulse` bars.
//   - `@/components/motion` FadeIn (framer-motion, browser-only) -> an inline
//     native Animated FadeIn (opacity 0->1 + slide-up 12->0, reduce-motion-aware
//     via AccessibilityInfo) honouring the web `delay={0.1}` (seconds -> ms).
//   - `@/components/charts/RadialGauge` -> the native parity RadialGauge
//     (identical value/max/label/unit/color/size API).
//   - `lucide-react` Activity -> native SemanticIcon name="activity" (decorative);
//     lucide is a DOM/SVG icon lib. The web 16px muted glyph becomes the smallest
//     SemanticIcon chip.
//   - react-i18next useTranslation -> useNativeTranslation() shim returning the
//     fallback copy verbatim; every web t() key + default string is preserved.
//   - `@/hooks/useUnits` -> native useUnits() shim mirroring the web out-of-box
//     defaults (distance 'km', speed 'km/h'); the API already returns SI and
//     conversion happens here at the display boundary.
//   - `@/lib/unitConversion` convertDistanceFromSI / convertSpeedFromSI -> inlined
//     native ports (same SI meters/m-per-s -> display formulas + constants).
//   - `@/lib/numberFormat` fmtNumber / fmtInt -> inlined native-safe formatters.
//   - `./constants` HEALTH_COLOR / HealthStatus / TempSensor and `@/types/driving`
//     DrivingStats -> inlined local types/constants (same shapes).

import {
  Children,
  isValidElement,
  useEffect,
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
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {RadialGauge} from '../../../../components/charts/RadialGauge';

/* ─── inline shims ─────────────────────────────────────────────────────────── */

// react-i18next useTranslation(): t(key, fallback) returns the fallback copy.
function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

// Web `FadeIn` default entrance duration (useMotionPreference(400)).
const FADE_DURATION_MS = 400;
// Skeleton `animate-pulse` half-cycle.
const PULSE_DURATION_MS = 700;

// Mirrors the StatCard / SpeedHistogramChart reduce-motion source-of-truth.
function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
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

// Native parity for `@/components/motion` FadeIn: fades + slides children up on
// mount after `delay` seconds. Reduce-motion renders the final state immediately.
function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: delay * 1000,
      duration: FADE_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();

    return () => {
      animation.stop();
    };
  }, [delay, progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      },
    ],
  };

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

// Native parity for `@/components/feedback` Skeleton with `lines`: pulsing
// placeholder bars (last line 60% wide), reduce-motion shows a static dim state.
function Skeleton({lines = 1}: {lines?: number}) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.7);
      return;
    }

    pulse.setValue(0.4);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          toValue: 0.4,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    return () => {
      loop.stop();
    };
  }, [pulse, reduceMotion]);

  return (
    <View accessibilityRole="progressbar" style={styles.skeleton}>
      {Array.from({length: lines}).map((_, index) => (
        <Animated.View
          key={`skeleton-line-${index}`}
          style={[
            styles.skeletonLine,
            {opacity: pulse, width: index === lines - 1 ? '60%' : '100%'},
          ]}
        />
      ))}
    </View>
  );
}

/* ─── native KVList (web `@/components/data-display` KVList) ─────────────────── */

interface KVItem {
  label: string;
  value: ReactNode;
}

function KVList({items}: {items: KVItem[]}) {
  return (
    <View>
      {items.map((item, index) => (
        <View
          key={item.label}
          style={[styles.kvRow, index > 0 ? styles.kvRowDivider : null]}>
          <AppText style={styles.kvLabel} tone="muted" variant="caption">
            {item.label}
          </AppText>
          <AppText style={styles.kvValue} variant="caption" weight="semibold">
            {item.value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/* ─── native Grid (web `@/components/layout` Grid) ──────────────────────────── */

interface GridCols {
  default?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

// Tailwind responsive breakpoints (px) used to resolve the active column count.
const SM_BREAKPOINT = 640;
const MD_BREAKPOINT = 768;
const LG_BREAKPOINT = 1024;
const XL_BREAKPOINT = 1280;
// Tailwind spacing scale: gap-N -> N * 4px (gap-4 -> 16).
const TAILWIND_GAP_PX = 4;

function resolveColumns(cols: GridCols, width: number): number {
  let columns = cols.default ?? 1;
  if (cols.sm != null && width >= SM_BREAKPOINT) {
    columns = cols.sm;
  }
  if (cols.md != null && width >= MD_BREAKPOINT) {
    columns = cols.md;
  }
  if (cols.lg != null && width >= LG_BREAKPOINT) {
    columns = cols.lg;
  }
  if (cols.xl != null && width >= XL_BREAKPOINT) {
    columns = cols.xl;
  }
  return Math.max(1, columns);
}

function Grid({
  cols = {default: 1},
  gap = 4,
  children,
}: {
  cols?: GridCols;
  gap?: number;
  children: ReactNode;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const gapPx = gap * TAILWIND_GAP_PX;
  const columns = resolveColumns(cols, containerWidth);
  const cells = Children.toArray(children);
  const cellWidth =
    containerWidth > 0
      ? Math.floor((containerWidth - gapPx * (columns - 1)) / columns)
      : null;

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setContainerWidth(prev => (Math.abs(prev - next) > 0.5 ? next : prev));
  };

  return (
    <View onLayout={onLayout} style={[styles.grid, {gap: gapPx}]}>
      {cells.map((child, index) => {
        const key =
          isValidElement(child) && child.key != null
            ? child.key
            : `grid-cell-${index}`;
        return (
          <View
            key={key}
            style={cellWidth != null ? {width: cellWidth} : styles.cellFull}>
            {child}
          </View>
        );
      })}
    </View>
  );
}

/* ─── native unit shim (web `@/hooks/useUnits` + `@/lib/unitConversion`) ────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type SpeedUnitPref = 'km/h' | 'mph';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;
const SECONDS_PER_HOUR = 3600;

// Mirrors web `convertDistanceFromSI` (SI meters -> display unit).
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
    case 'km':
    default:
      return meters / METERS_PER_KM;
  }
}

// Mirrors web `convertSpeedFromSI` (SI m/s -> display unit).
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
    case 'km/h':
    default:
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
  }
}

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref; speed: SpeedUnitPref};
}

// The native parity layer has no settings store wired in, so the hook mirrors
// the web out-of-box defaults (distance 'km', speed 'km/h').
function useUnits(): UseUnitsResult {
  return {unitPrefs: {distance: 'km', speed: 'km/h'}};
}

/* ─── native number formatters (web `@/lib/numberFormat`) ───────────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── inlined types + constants (web `./constants` + `@/types/driving`) ─────── */

type HealthStatus = 'good' | 'warning' | 'critical';

const HEALTH_COLOR: Record<HealthStatus, string> = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
};

interface TempSensor {
  key: string;
  labelKey: string;
  defaultLabel: string;
  value: number | null;
  maxTemp: number;
  color: string;
  icon: ReactNode;
}

interface DrivingStats {
  totalDrives: number;
  totalDistanceKm: number;
  totalDurationS: number;
  avgEfficiencyWhKm: number;
  avgSpeedKmh: number;
  topSpeedKmh: number;
  regenRatio: number;
  regenEnergyWh: number;
  co2SavedKg: number;
}

/* ─── component ─────────────────────────────────────────────────────────────── */

interface HealthGaugeGridProps {
  overallHealth: HealthStatus;
  healthScore: number;
  motorStatus: string;
  sensors: TempSensor[];
  stats: DrivingStats | undefined;
}

export function HealthGaugeGrid({
  overallHealth,
  healthScore,
  motorStatus,
  sensors,
  stats,
}: HealthGaugeGridProps) {
  const t = useNativeTranslation();
  const {unitPrefs} = useUnits();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const toSpeedDisplay = (value: number) =>
    convertSpeedFromSI(value, unitPrefs.speed);
  const healthColor = HEALTH_COLOR[overallHealth];

  return (
    <FadeIn delay={0.1}>
      <Grid cols={{default: 1, md: 3}} gap={4}>
        {/* Health score gauge */}
        <GlassPanel style={styles.gaugePanel}>
          <RadialGauge
            color={healthColor}
            label={t('drivetrain.healthScore', 'Health Score')}
            max={100}
            size={140}
            unit="%"
            value={healthScore}
          />
          <AppText style={styles.gaugeCaption} tone="muted" variant="caption">
            {t(
              'drivetrain.healthScoreDesc',
              'Overall drivetrain condition rating',
            )}
          </AppText>
        </GlassPanel>

        {/* Motor status card */}
        <GlassPanel style={styles.panel}>
          <AppText
            style={styles.sectionTitle}
            tone="muted"
            variant="caption"
            weight="semibold">
            {t('drivetrain.motorDetails', 'Motor Details')}
          </AppText>
          <KVList
            items={[
              {
                label: t('drivetrain.motorStatus', 'Motor Status'),
                value: motorStatus,
              },
              {
                label: t('drivetrain.overallHealth', 'Overall Health'),
                value:
                  overallHealth.charAt(0).toUpperCase() +
                  overallHealth.slice(1),
              },
              {
                label: t('drivetrain.healthScoreLabel', 'Health Score'),
                value: `${healthScore}%`,
              },
              {
                label: t('drivetrain.sensorCount', 'Active Sensors'),
                value: String(
                  sensors.filter(sensor => sensor.value !== null).length,
                ),
              },
            ]}
          />
          <View style={styles.realtimeRow}>
            <SemanticIcon decorative name="activity" size="sm" />
            <AppText tone="muted" variant="caption">
              {t('drivetrain.realTime', 'Real-time telemetry active')}
            </AppText>
          </View>
        </GlassPanel>

        {/* Drive statistics summary */}
        <GlassPanel style={styles.panel}>
          <AppText
            style={styles.sectionTitle}
            tone="muted"
            variant="caption"
            weight="semibold">
            {t('drivetrain.driveStats', 'Drive Statistics')}
          </AppText>
          {stats ? (
            <KVList
              items={[
                {
                  label: t('drivetrain.totalDrives', 'Total Drives'),
                  value: fmtInt(stats.totalDrives),
                },
                {
                  label: t('drivetrain.totalDistance', 'Total Distance'),
                  value: `${fmtInt(
                    toDistanceDisplay(stats.totalDistanceKm),
                  )} ${distanceUnit}`,
                },
                {
                  label: t('drivetrain.avgSpeed', 'Avg Speed'),
                  value: `${fmtNumber(
                    toSpeedDisplay(stats.avgSpeedKmh),
                    1,
                  )} ${speedUnit}`,
                },
                {
                  label: t('drivetrain.topSpeed', 'Top Speed'),
                  value: `${fmtNumber(
                    toSpeedDisplay(stats.topSpeedKmh),
                    1,
                  )} ${speedUnit}`,
                },
              ]}
            />
          ) : (
            <Skeleton lines={4} />
          )}
        </GlassPanel>
      </Grid>
    </FadeIn>
  );
}

HealthGaugeGrid.displayName = 'HealthGaugeGrid';

const styles = StyleSheet.create({
  cellFull: {
    width: '100%',
  },
  gaugeCaption: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  gaugePanel: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  kvLabel: {
    flexShrink: 1,
  },
  kvRow: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  kvRowDivider: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  kvValue: {
    textAlign: 'right',
  },
  panel: {
    padding: 24,
  },
  realtimeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 16,
  },
  sectionTitle: {
    letterSpacing: 1,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
  },
  skeleton: {
    gap: spacing.sm,
  },
  skeletonLine: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    height: 16,
  },
});
