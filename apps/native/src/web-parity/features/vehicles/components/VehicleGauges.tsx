// Native parity port of web/src/features/vehicles/components/VehicleGauges.tsx.
//
// The web component is the vehicle-detail hero: a FadeIn (delay 0.05) wrapping a
// GlassPanel whose lg layout is a 2-column [auto,1fr] grid — a TeslaCarViz on the
// left and, on the right, three stacked blocks:
//   1. a 2-up (sm:4-up) row of four RadialGauges — Battery (%), Range, Speed,
//      Power (kW) — coloured by batteryColor / cyan / purple-or-dark / charging.
//   2. a stack of MetricBars — Battery Level, Estimated Range, and (only while
//      charging) Charge Rate.
//   3. a flex-wrap row of four quick-info chips — Lock/Unlock, Sentry, Climate,
//      and the software-version chip.
// Gauge upper bounds are expressed in SI (metres / m·s⁻¹ / metres-per-hour) and
// converted to the user's display unit so the percent fill and the value/max
// pair share the same unit regardless of km/mi or km·h⁻¹/mph preference.
//
// Native adaptations (each documented in the .parity.json sidecar):
//   - react-i18next `useTranslation` (web L1) -> local native-safe
//     `useNativeTranslation()` returning t(key, fallback) = fallback ?? key (the
//     established FleetSummary / LiveMotorStatus convention); every i18n key +
//     English default is preserved verbatim.
//   - lucide-react Lock / Unlock / Shield / Wind / Cpu (web L2) -> dynamically
//     tinted emoji glyph stand-ins (🔒/🔓/🛡/💨/🖥), coloured with the same
//     computed chip.color the web passes to the lucide icon's `style.color`.
//   - `@/components/ui/GlassPanel` (web L3) -> native GlassPanel.
//   - `@/components/motion/FadeIn` (web L4) -> a native Animated fade/translate
//     entry honouring AccessibilityInfo reduce-motion (the established
//     LiveMotorStatus convention); the same `delay` prop is preserved.
//   - `@/components/data-display/TeslaCarViz` + parseModelKey (web L5) -> an
//     inline native-safe car visualisation (react-native-svg is not a native
//     dependency, so the elaborate SVG car body / wheels / charging cable can't
//     be reproduced). It keeps the meaningful, data-bearing intent: a state-tinted
//     ambient glow (sentry→red / charging→green / driving→cyan / idle→subtle), a
//     model-aware car glyph + model caption, the animated battery bar with the
//     batteryColor fill + "{level}%" readout, and the StatusDot row (Charging /
//     Locked-Unlocked / Climate / Sentry) — all consuming the identical props
//     (batteryLevel/isCharging/isLocked/isClimateOn/sentryMode/speed/size/model).
//     parseModelKey is ported verbatim. The web StatusDot labels are hard-coded
//     English in the source (no i18n) and are kept literal here too.
//   - `@/components/charts/RadialGauge` (web L6) -> the native charts-barrel
//     RadialGauge parity export (same value/max/label/unit/color/size props).
//   - `@/components/data-display/MetricBar` (web L7) -> an inline native MetricBar
//     (the established EfficiencyPage convention): the framer-motion 0→pct width
//     entry is reduced to a static final-state fill; the `sublabel ?? fmtNumber`
//     policy (empty string rendered verbatim) is preserved.
//   - `@/hooks/useUnits` (web L8) -> a scoped native useUnits() deriving
//     unitPrefs.distance / unitPrefs.speed / locale / precision from the
//     web-parity useSettings(), plus a formatDistance bound to the SI lib port.
//   - `@/lib/unitConversion` convertDistanceFromSI / convertSpeedFromSI (web L9)
//     + the formatDistance bridge -> inlined verbatim from
//     web/src/lib/unitConversion.ts (metres→km/mi/ft, m·s⁻¹→km·h⁻¹/mph, the
//     locale-aware SI distance formatter with the '—' empty fallback).
//   - `@/lib/numberFormat` fmtNumber (web L10) -> a local locale-aware fmtNumber
//     ported from web/src/lib/numberFormat.ts.
//   - `@/lib/colors` batteryColor (web L11) -> inlined verbatim (>60 green /
//     >25 amber / else red); boolColor / boolColorMuted / COLOR are likewise
//     inlined from the web file + colors lib.
//   - `@/api/types` Vehicle / VehicleState (web L12) -> imported from the
//     already-ported native web-parity api/types so the prop contract is identical.
//   - the decorative `bg-gradient-to-br` overlay (web L89) has no native gradient
//     primitive available and is omitted (purely cosmetic); the lg 2-column grid
//     collapses to the mobile-first single column (the web base breakpoint).
//
// No DOM module, browser HTML element, Recharts, Leaflet, lucide DOM SVG,
// framer-motion, or old web @/components import appears in the native output.

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
} from 'react-native';

import {RadialGauge} from '../../../components/charts';
import {useSettings} from '../../../api/hooks/useSettings';
import type {Vehicle, VehicleState} from '../../../api/types';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ── i18n: react-i18next useTranslation -> native-safe fallback shim ───────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ── colour constants (web L15-21 + @/lib/colors) ──────────────────────────── */

const COLOR = {
  BAD: '#ef4444',
  CYAN: '#00f0ff',
  DARK: '#374151',
  MUTED: '#6b7280',
  PURPLE: '#a855f7',
};

const GOOD_GREEN = '#10b981';

/**
 * Gauge upper bounds expressed in SI so the RadialGauge percent fill reflects
 * the same physical quantity regardless of the user's display preference.
 *   600 mi  ≈ 965_606 m         — practical upper bound for rated range
 *   250 mph ≈ 111.76 m/s        — practical upper bound for vehicle speed
 *   100 mph ≈ 160_934.4 m/h     — supercharger-class charge-rate ceiling
 */
const MAX_RANGE_METERS = 600 * 1609.344;
const MAX_SPEED_MPS = 250 * 0.44704;
const MAX_CHARGE_RATE_METERS_PER_HOUR = 100 * 1609.344;

function boolColor(flag: boolean): string {
  return flag ? GOOD_GREEN : '#ef4444';
}

function boolColorMuted(flag: boolean): string {
  return flag ? GOOD_GREEN : COLOR.MUTED;
}

/** Color for battery level (0-100) — ported from web/src/lib/colors.ts. */
function batteryColor(level: number): string {
  if (level > 60) return GOOD_GREEN;
  if (level > 25) return '#f59e0b';
  return '#ef4444';
}

/* ── number formatter (web @/lib/numberFormat fmtNumber) ───────────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

/* ── unit conversion (web @/lib/unitConversion SI converters + formatter) ──── */

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;
const SECONDS_PER_HOUR = 3600;
const DEFAULT_EMPTY_DISPLAY = '\u2014'; // '—'
const DEFAULT_DISTANCE_PRECISION = 1;

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type SpeedUnitPref = 'km/h' | 'mph';

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

function formatNumber(
  value: number,
  locale: string | undefined,
  fractionDigits: number,
): string {
  try {
    return value.toLocaleString(locale ?? 'en-US', {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    });
  } catch {
    return value.toLocaleString('en-US', {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    });
  }
}

function resolvePrecision(
  precision: number | undefined,
  fallback: number,
): number {
  if (typeof precision === 'number' && Number.isFinite(precision) && precision >= 0) {
    return Math.floor(precision);
  }
  return fallback;
}

/** Format an SI-metres distance for display in the user's unit (web formatDistance). */
function formatDistanceSI(
  meters: number | null | undefined,
  pref: NativeUnitPref,
): string {
  if (!(typeof meters === 'number' && Number.isFinite(meters))) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const digits = resolvePrecision(pref.precision, DEFAULT_DISTANCE_PRECISION);
  const value = convertDistanceFromSI(meters, pref.distance);
  return `${formatNumber(value, pref.locale, digits)} ${pref.distance}`;
}

/* ── native-safe useUnits (web @/hooks/useUnits, useSettings-derived) ──────── */

interface NativeUnitPref {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  locale: string;
  precision?: number;
}

function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') return undefined;
  if (!Number.isFinite(decimalPrecision)) return undefined;
  if (decimalPrecision < 0) return undefined;
  return Math.floor(decimalPrecision);
}

function useUnits(): {
  unitPrefs: NativeUnitPref;
  formatDistance: (value: number | null | undefined) => string;
} {
  const {data: settings} = useSettings();
  const unitOfLength = settings?.unit_of_length;
  const settingsLocale = settings?.locale;
  const decimalPrecision = settings?.decimal_precision;

  const unitPrefs = useMemo<NativeUnitPref>(
    () => ({
      distance: (unitOfLength === 'mi' ? 'mi' : 'km') as DistanceUnitPref,
      locale:
        typeof settingsLocale === 'string' && settingsLocale.trim().length > 0
          ? settingsLocale
          : 'en-US',
      precision: derivePrecision(decimalPrecision),
      speed: (unitOfLength === 'mi' ? 'mph' : 'km/h') as SpeedUnitPref,
    }),
    [unitOfLength, settingsLocale, decimalPrecision],
  );

  const formatDistance = useCallback(
    (value: number | null | undefined) => formatDistanceSI(value, unitPrefs),
    [unitPrefs],
  );

  return useMemo(() => ({formatDistance, unitPrefs}), [formatDistance, unitPrefs]);
}

/* ── reduce-motion preference (drives the FadeIn entry animation) ──────────── */

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

/* ── FadeIn (native-safe port of @/components/motion framer-motion entry) ──── */

function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
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
      duration: 400,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion, delay]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

/* ── MetricBar (native port of @/components/data-display MetricBar) ─────────── */

function MetricBar({
  value,
  max,
  color,
  label,
  sublabel,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  sublabel?: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  const width = `${Number.isFinite(pct) ? Math.max(pct, 0) : 0}%` as DimensionValue;
  return (
    <View>
      <View style={styles.metricBarHeader}>
        <AppText style={styles.metricBarLabel} variant="caption">
          {label}
        </AppText>
        <AppText style={[styles.metricBarValue, {color}]} variant="caption">
          {sublabel ?? fmtNumber(value)}
        </AppText>
      </View>
      <View style={styles.metricBarTrack}>
        <View style={[styles.metricBarFill, {backgroundColor: color, width}]} />
      </View>
    </View>
  );
}

/* ── TeslaCarViz + parseModelKey (native-safe port of data-display/TeslaCarViz) */

type TeslaModel = 'model3' | 'models' | 'modely' | 'modelx' | 'cybertruck';

/** Parse a vehicle.model string into a TeslaModel key (ported verbatim). */
function parseModelKey(modelStr?: string): TeslaModel {
  if (!modelStr) return 'model3';
  const s = modelStr.toLowerCase().replace(/\s+/g, '');
  if (s.includes('cybertruck') || s.includes('ct')) return 'cybertruck';
  if (s.includes('modelx') || s.includes('mx')) return 'modelx';
  if (s.includes('modely') || s.includes('my')) return 'modely';
  if (s.includes('models') || s.includes('ms')) return 'models';
  return 'model3';
}

const MODEL_LABELS: Record<TeslaModel, string> = {
  cybertruck: 'Cybertruck',
  model3: 'Model 3',
  models: 'Model S',
  modelx: 'Model X',
  modely: 'Model Y',
};

const CAR_SIZE_MAP: Record<'sm' | 'md' | 'lg', number> = {
  lg: 380,
  md: 280,
  sm: 180,
};

// Status-dot inactive tints (web palette.statusInactive / statusTextInactive, dark).
const INACTIVE_DOT = 'rgba(255,255,255,0.2)';
const INACTIVE_TEXT = 'rgba(255,255,255,0.3)';

// Ambient glow tints (web palette.ambient, dark scheme).
const AMBIENT_SENTRY = 'rgba(239,68,68,0.22)';
const AMBIENT_CHARGING = 'rgba(16,185,129,0.22)';
const AMBIENT_DRIVING = 'rgba(0,240,255,0.18)';
const AMBIENT_IDLE = 'rgba(255,255,255,0.05)';

function StatusDot({
  active,
  color,
  label,
}: {
  active: boolean;
  color: string;
  label: string;
}) {
  return (
    <View style={styles.statusDot}>
      <View
        style={[
          styles.statusDotMark,
          {backgroundColor: active ? color : INACTIVE_DOT},
        ]}
      />
      <AppText
        style={[styles.statusDotLabel, {color: active ? color : INACTIVE_TEXT}]}
        variant="caption">
        {label}
      </AppText>
    </View>
  );
}

interface TeslaCarVizProps {
  batteryLevel: number;
  isCharging: boolean;
  isLocked: boolean;
  isClimateOn: boolean;
  sentryMode: boolean;
  speed: number;
  size?: 'sm' | 'md' | 'lg';
  model?: TeslaModel;
}

function TeslaCarViz({
  batteryLevel,
  isCharging,
  isLocked,
  isClimateOn,
  sentryMode,
  speed,
  size = 'md',
  model = 'model3',
}: TeslaCarVizProps) {
  const batClr = batteryColor(batteryLevel);
  const driving = speed > 0;
  const w = CAR_SIZE_MAP[size];
  const glow = sentryMode
    ? AMBIENT_SENTRY
    : isCharging
    ? AMBIENT_CHARGING
    : driving
    ? AMBIENT_DRIVING
    : AMBIENT_IDLE;
  const batWidth = `${Math.max(0, Math.min(batteryLevel, 100))}%` as DimensionValue;

  return (
    <View style={styles.carViz}>
      <View
        pointerEvents="none"
        style={[styles.carGlow, {backgroundColor: glow, maxWidth: '100%', width: w}]}
      />
      <View style={[styles.carBody, {maxWidth: '100%', width: w}]}>
        <AppText style={styles.carGlyph}>{'\uD83D\uDE97'}</AppText>
        <AppText style={styles.carModel} tone="muted" variant="caption" weight="semibold">
          {MODEL_LABELS[model]}
        </AppText>
        <View style={styles.carBatteryTrack}>
          <View
            style={[styles.carBatteryFill, {backgroundColor: batClr, width: batWidth}]}
          />
        </View>
        <AppText style={styles.carBatteryText} variant="caption">
          {`${batteryLevel}%`}
        </AppText>
      </View>
      <View style={styles.statusRow}>
        <StatusDot
          active={isCharging}
          color={GOOD_GREEN}
          label={isCharging ? 'Charging' : 'Not Charging'}
        />
        <StatusDot
          active={isLocked}
          color={boolColor(isLocked)}
          label={isLocked ? 'Locked' : 'Unlocked'}
        />
        {isClimateOn ? (
          <StatusDot active color={COLOR.CYAN} label="Climate" />
        ) : null}
        {sentryMode ? (
          <StatusDot active color={COLOR.BAD} label="Sentry" />
        ) : null}
      </View>
    </View>
  );
}

/* ── quick-info chip glyphs (web L2 lucide icons) ──────────────────────────── */

const GLYPH_LOCK = '\uD83D\uDD12'; // 🔒 (Lock)
const GLYPH_UNLOCK = '\uD83D\uDD13'; // 🔓 (Unlock)
const GLYPH_SHIELD = '\uD83D\uDEE1\uFE0F'; // 🛡 (Shield → Sentry)
const GLYPH_WIND = '\uD83D\uDCA8'; // 💨 (Wind → Climate)
const GLYPH_CPU = '\uD83D\uDDA5\uFE0F'; // 🖥 (Cpu → software version)

const GAUGE_SIZE = 110;

/* ── ported: VehicleGauges (web L43-187) ───────────────────────────────────── */

interface VehicleGaugesProps {
  vehicle: Vehicle;
  state: VehicleState;
}

export function VehicleGauges({vehicle, state}: VehicleGaugesProps) {
  const t = useNativeTranslation();
  const {unitPrefs, formatDistance} = useUnits();

  const chips = [
    {
      color: boolColor(state.is_locked),
      glyph: state.is_locked ? GLYPH_LOCK : GLYPH_UNLOCK,
      label: state.is_locked
        ? t('common.locked', 'Locked')
        : t('common.unlocked', 'Unlocked'),
    },
    {
      color: state.sentry_mode ? COLOR.BAD : COLOR.MUTED,
      glyph: GLYPH_SHIELD,
      label: state.sentry_mode
        ? t('common.sentryOn', 'Sentry ON')
        : t('common.sentryOff', 'Sentry OFF'),
    },
    {
      color: state.is_climate_on ? COLOR.CYAN : COLOR.MUTED,
      glyph: GLYPH_WIND,
      label: state.is_climate_on
        ? t('common.climateOn', 'Climate ON')
        : t('common.climateOff', 'Climate OFF'),
    },
    {
      color: COLOR.PURPLE,
      glyph: GLYPH_CPU,
      label: state.software_version || 'N/A',
    },
  ];

  // Pre-convert SI values to user-pref numerics so RadialGauge / MetricBar
  // receive matching value/max pairs in the SAME unit.
  const rangeDisplay = convertDistanceFromSI(state.rated_range, unitPrefs.distance);
  const rangeMax = convertDistanceFromSI(MAX_RANGE_METERS, unitPrefs.distance);
  const speedDisplay = convertSpeedFromSI(state.speed, unitPrefs.speed);
  const speedMax = convertSpeedFromSI(MAX_SPEED_MPS, unitPrefs.speed);
  // ChargeRate is delivered as distance-per-hour (m/h) — convert through the
  // distance pref, then label as `<unit>/h` to match the Tesla UX.
  const chargeRateDisplay = convertDistanceFromSI(state.charge_rate, unitPrefs.distance);
  const chargeRateMax = convertDistanceFromSI(
    MAX_CHARGE_RATE_METERS_PER_HOUR,
    unitPrefs.distance,
  );

  return (
    <FadeIn delay={0.05}>
      <GlassPanel style={styles.panel}>
        <View style={styles.layout}>
          {/* Car visualization */}
          <View style={styles.carWrap}>
            <TeslaCarViz
              batteryLevel={state.battery_level}
              isCharging={state.is_charging}
              isLocked={state.is_locked}
              isClimateOn={state.is_climate_on}
              sentryMode={state.sentry_mode}
              speed={state.speed}
              size="lg"
              model={parseModelKey(vehicle?.model)}
            />
          </View>

          {/* Gauges + metrics */}
          <View style={styles.gaugesCol}>
            {/* Radial gauge row */}
            <View style={styles.gaugeRow}>
              <View style={styles.gaugeCell}>
                <RadialGauge
                  value={state.battery_level}
                  max={100}
                  label={t('common.battery', 'Battery')}
                  unit="%"
                  color={batteryColor(state.battery_level)}
                  size={GAUGE_SIZE}
                />
              </View>
              <View style={styles.gaugeCell}>
                <RadialGauge
                  value={Math.round(rangeDisplay)}
                  max={Math.round(rangeMax)}
                  label={t('common.range', 'Range')}
                  unit={unitPrefs.distance}
                  color={COLOR.CYAN}
                  size={GAUGE_SIZE}
                />
              </View>
              <View style={styles.gaugeCell}>
                <RadialGauge
                  value={Math.round(speedDisplay)}
                  max={Math.round(speedMax)}
                  label={t('common.speed', 'Speed')}
                  unit={unitPrefs.speed}
                  color={state.speed > 0 ? COLOR.PURPLE : COLOR.DARK}
                  size={GAUGE_SIZE}
                />
              </View>
              <View style={styles.gaugeCell}>
                <RadialGauge
                  value={state.charger_power}
                  max={250}
                  label={t('common.power', 'Power')}
                  unit="kW"
                  color={boolColorMuted(state.is_charging)}
                  size={GAUGE_SIZE}
                />
              </View>
            </View>

            {/* Metric bars */}
            <View style={styles.metricBars}>
              <MetricBar
                value={state.battery_level}
                max={100}
                color={batteryColor(state.battery_level)}
                label={t('common.batteryLevel', 'Battery Level')}
                sublabel={`${fmtNumber(state.battery_level, 0)}%`}
              />
              <MetricBar
                value={rangeDisplay}
                max={rangeMax}
                color={COLOR.CYAN}
                label={t('common.estimatedRange', 'Estimated Range')}
                sublabel={formatDistance(state.rated_range)}
              />
              {state.is_charging ? (
                <MetricBar
                  value={chargeRateDisplay}
                  max={chargeRateMax}
                  color={GOOD_GREEN}
                  label={t('common.chargeRate', 'Charge Rate')}
                  sublabel={`${formatDistance(state.charge_rate)}/h`}
                />
              ) : null}
            </View>

            {/* Quick info chips */}
            <View style={styles.chips}>
              {chips.map(chip => (
                <View key={chip.label} style={styles.chip}>
                  <AppText style={[styles.chipGlyph, {color: chip.color}]}>
                    {chip.glyph}
                  </AppText>
                  <AppText style={styles.chipLabel} variant="caption">
                    {chip.label}
                  </AppText>
                </View>
              ))}
            </View>
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

VehicleGauges.displayName = 'VehicleGauges';

const styles = StyleSheet.create({
  carBatteryFill: {
    borderRadius: 4,
    height: '100%',
  },
  carBatteryText: {
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.xs,
  },
  carBatteryTrack: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 4,
    height: 8,
    marginTop: spacing.md,
    overflow: 'hidden',
    width: '88%',
  },
  carBody: {
    alignItems: 'center',
    backgroundColor: '#2d3748',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  carGlow: {
    borderRadius: 999,
    height: 90,
    opacity: 0.6,
    position: 'absolute',
    top: 12,
  },
  carGlyph: {
    fontSize: 56,
    lineHeight: 64,
  },
  carModel: {
    letterSpacing: 0.6,
    marginTop: spacing.xs,
    textTransform: 'uppercase',
  },
  carViz: {
    alignItems: 'center',
    width: '100%',
  },
  carWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipGlyph: {
    fontSize: 12,
    lineHeight: 16,
  },
  chipLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gaugeCell: {
    alignItems: 'center',
    flexBasis: '47%',
    flexGrow: 1,
    marginBottom: spacing.md,
  },
  gaugeRow: {
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: spacing.md,
  },
  gaugesCol: {
    gap: spacing.lg + 4,
  },
  layout: {
    gap: spacing.xl,
  },
  metricBarFill: {
    borderRadius: 8,
    height: '100%',
  },
  metricBarHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  metricBarLabel: {
    color: colors.textSecondary,
    fontWeight: '500',
  },
  metricBarTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 8,
    overflow: 'hidden',
  },
  metricBarValue: {
    fontVariant: ['tabular-nums'],
  },
  metricBars: {
    gap: spacing.md,
  },
  panel: {
    overflow: 'hidden',
    padding: spacing.lg + 4,
  },
  statusDot: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statusDotLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  statusDotMark: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  statusRow: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: spacing.md,
    rowGap: spacing.xs,
  },
});
