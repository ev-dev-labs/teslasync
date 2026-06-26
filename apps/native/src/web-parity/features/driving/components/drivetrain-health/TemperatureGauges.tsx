// Native parity port of
// web/src/features/driving/components/drivetrain-health/TemperatureGauges.tsx.
//
// The web component renders a single glass panel (inside a `FadeIn`) with an
// uppercase muted "Temperature Gauges" heading (a small Thermometer icon inline)
// followed by a responsive 2-up / md:4-up grid of `RadialGauge`s — one per
// temperature sensor — each showing the SI->display converted value, max, label,
// unit and a severity colour, with a "Max: <value><unit>" caption underneath.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-i18next useTranslation -> useNativeTranslation() shim returning the
//     fallback copy verbatim; every web t() key + default string is preserved
//     (drivetrain.tempGauges, sensor.labelKey/defaultLabel, drivetrain.maxLabel).
//   - lucide-react Thermometer -> a decorative Unicode thermometer glyph
//     ('\u{1F321}') rendered in an AppText with importantForAccessibility="no"
//     (same conversion the ClimateStatusWidget port uses for this exact icon);
//     lucide is a DOM/SVG icon lib. The web h-4 w-4 (16px) muted glyph becomes a
//     16px decorative glyph. The web `<h3>` becomes an AppText with
//     accessibilityRole="header" so the heading semantic survives.
//   - `@/components/ui` GlassPanel -> the native parity `components/ui/GlassPanel`
//     (the same translucent bordered surface every parity feature uses); the web
//     `className="p-6"` padding becomes RN `style` padding 24.
//   - `@/components/layout` Grid (CSS `grid-cols-2 md:grid-cols-4 gap-6`) -> an
//     inline native Grid: it measures its width via onLayout, resolves the column
//     count from the same Tailwind breakpoints (default 2, md>=768 -> 4) and lays
//     the children out in a flex-wrap row with computed cell widths + a 24px gap
//     (gap-6 -> 6 * 4px). On a phone the default 2-column layout applies.
//   - `@/components/motion` FadeIn (framer-motion, browser-only) -> an inline
//     native Animated FadeIn (opacity 0->1 + slide-up 12->0, reduce-motion-aware
//     via AccessibilityInfo) honouring the web `delay={0.15}` (seconds -> ms).
//   - `@/components/charts/RadialGauge` -> the native parity RadialGauge
//     (identical value/max/label/unit/color API).
//   - `@/hooks/useUnits` -> native useUnits() shim mirroring the web out-of-box
//     default (temperature '°C'); the API already returns SI Celsius and
//     conversion happens here at the display boundary.
//   - `@/lib/unitConversion` convertTempFromSI -> inlined native port (same SI
//     Celsius -> °C/°F formula).
//   - `@/lib/numberFormat` fmtNumber -> inlined native-safe formatter
//     (locale toLocaleString, precision-2 / en-US defaults).
//   - `./constants` TempSensor -> inlined local type (same shape).
//   - `./helpers` tempSeverityColor + its HEALTH_COLOR dependency -> inlined
//     native ports (same null/ratio thresholds and hex colours; the severity
//     ratio is still computed on the raw SI Celsius values, not the display ones).

import {
  Children,
  isValidElement,
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
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {spacing} from '../../../../../theme/tokens';
import {RadialGauge} from '../../../../components/charts/RadialGauge';

/* ─── inline shims ─────────────────────────────────────────────────────────── */

// react-i18next useTranslation(): t(key, fallback) returns the fallback copy.
function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

// lucide-react Thermometer has no native icon dependency; per the
// ClimateStatusWidget precedent it becomes a decorative Unicode glyph.
const ICON_THERMOMETER = '\u{1F321}';

// Web `FadeIn` default entrance duration (useMotionPreference(400)).
const FADE_DURATION_MS = 400;

// Mirrors the StatCard / HealthGaugeGrid reduce-motion source-of-truth.
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

// Decorative glyph stand-in for a lucide icon (hidden from screen readers like
// the web SVG, which carries no aria-label).
function Glyph({glyph, style}: {glyph: string; style?: StyleProp<TextStyle>}) {
  return (
    <AppText allowFontScaling={false} importantForAccessibility="no" style={style}>
      {glyph}
    </AppText>
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
// Tailwind spacing scale: gap-N -> N * 4px (gap-6 -> 24).
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

type TemperatureUnitPref = '°C' | '°F';

// Mirrors web `convertTempFromSI` (SI Celsius -> display unit).
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°F':
      return (celsius * 9) / 5 + 32;
    case '°C':
    default:
      return celsius;
  }
}

interface UseUnitsResult {
  unitPrefs: {temperature: TemperatureUnitPref};
}

// The native parity layer has no settings store wired in here, so the hook
// mirrors the web out-of-box default: temperature '°C'. The API already returns
// SI Celsius; conversion happens at the display boundary.
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(() => ({unitPrefs: {temperature: '°C'}}), []);
}

/* ─── native number formatter (web `@/lib/numberFormat`) ────────────────────── */

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

/* ─── inlined type + helper (web `./constants` + `./helpers`) ───────────────── */

interface TempSensor {
  key: string;
  labelKey: string;
  defaultLabel: string;
  value: number | null;
  maxTemp: number;
  color: string;
  icon: ReactNode;
}

// Web `./constants` HEALTH_COLOR, inlined for tempSeverityColor below.
const HEALTH_COLOR = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
} as const;

// Mirrors web `./helpers` tempSeverityColor: severity is computed on the raw SI
// Celsius value/max (null -> neutral grey), not on the display-converted values.
function tempSeverityColor(celsius: number | null, max: number): string {
  if (celsius === null) {
    return '#6b7280';
  }
  const ratio = celsius / max;
  if (ratio >= 0.85) {
    return HEALTH_COLOR.critical;
  }
  if (ratio >= 0.65) {
    return HEALTH_COLOR.warning;
  }
  return HEALTH_COLOR.good;
}

/* ─── component ─────────────────────────────────────────────────────────────── */

interface TemperatureGaugesProps {
  sensors: TempSensor[];
}

export function TemperatureGauges({sensors}: TemperatureGaugesProps) {
  const t = useNativeTranslation();
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;

  return (
    <FadeIn delay={0.15}>
      <GlassPanel style={styles.panel}>
        <View style={styles.headingRow}>
          <Glyph glyph={ICON_THERMOMETER} style={styles.headingIcon} />
          <AppText accessibilityRole="header" style={styles.heading} tone="muted">
            {t('drivetrain.tempGauges', 'Temperature Gauges')}
          </AppText>
        </View>
        <Grid cols={{default: 2, md: 4}} gap={6}>
          {sensors.map(sensor => (
            <View key={sensor.key} style={styles.sensorCell}>
              <RadialGauge
                color={tempSeverityColor(sensor.value, sensor.maxTemp)}
                label={t(sensor.labelKey, sensor.defaultLabel)}
                max={toTemperatureDisplay(sensor.maxTemp)}
                unit={tempUnit}
                value={
                  sensor.value !== null ? toTemperatureDisplay(sensor.value) : 0
                }
              />
              <AppText style={styles.maxText} tone="muted" variant="caption">
                {`${t('drivetrain.maxLabel', 'Max')}: ${fmtNumber(
                  toTemperatureDisplay(sensor.maxTemp),
                  0,
                )}${tempUnit}`}
              </AppText>
            </View>
          ))}
        </Grid>
      </GlassPanel>
    </FadeIn>
  );
}

TemperatureGauges.displayName = 'TemperatureGauges';

const styles = StyleSheet.create({
  cellFull: {
    width: '100%',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  heading: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  headingIcon: {
    fontSize: 16,
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: 16,
  },
  maxText: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  panel: {
    padding: 24,
  },
  sensorCell: {
    alignItems: 'center',
  },
});
