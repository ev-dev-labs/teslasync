// Native parity port of web/src/features/battery/pages/ProjectedRangePage.tsx.
//
// The web module is the "Projected Range" page: a PageContainer (title +
// subtitle + a VehicleSelect actions row) that, while the range-projection
// query loads, shows a centered spinner; otherwise renders eight stacked
// FadeIn/Stagger sections:
//   1. Hero — a 5-up MetricCard grid (Your Estimate / Tesla Estimate / Battery /
//      Usable Capacity / Health Factor).
//   2. AIRangePrediction — the opt-in learned per-vehicle range-model card
//      (renders only when the AI feature gate is on; the deterministic curve
//      below stays the canonical baseline).
//   3. Efficiency RadialGauge beside a Range Projection Curve chart.
//   4. Scenario Cards — per-condition range projections.
//   5. Personal Efficiency Matrix — a temp x speed Wh/km heatmap.
//   6. "What If" Calculator — speed/temperature sliders + an interpolated range.
//   7. Range Factors — impact-percentage breakdown cards.
//   8. Tips to Maximize Range — a static tip list.
// Backend distances/speeds/temps/energy are SI; the page converts at the display
// boundary to the user's unit prefs. The projection comes from GET
// /api/v1/analytics/range-projection?vehicle_id=.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (or the key), preserving
//     every translation key verbatim at the call site.
//   • usePageTitle(...) -> a native no-op hook (no document.title in RN).
//   • @/hooks/useUnits (formatEnergy/formatTemperature/formatSpeed/
//     formatDistance) -> derived from the native useSettings() query exactly like
//     the web hook: a UnitPref bag (distance/speed/temperature/energy/locale/
//     precision) fed to the inlined SI-floor formatters from @/lib/unitConversion.
//   • @/lib/numberFormat fmtNumber -> inlined verbatim (locale-aware fixed
//     decimals, non-finite -> 0); the web global precision default (2, set from
//     settings.decimal_precision) is reproduced via the settings-derived default.
//   • @/hooks/useSelectedVehicle -> a native hook over the ported useVehicles()
//     that keeps the "first vehicle is the default" precedence in local state
//     (RN has no router path/query precedence or persisted store). Called once in
//     the page so the VehicleSelect substitute and the query share one selection.
//   • @/lib/cn -> dropped; the DOM Tailwind class strings carry no native effect
//     and are replaced by StyleSheet styles.
//   • @/components/charts CHART_COLORS -> inlined verbatim (the static CB-safe
//     Okabe-Ito palette the bare constant resolves to).
//   • The shared web <PageContainer>/<VehicleSelect>/<MetricCard>/<Badge>/
//     <Slider> -> inlined native equivalents covering exactly the props these
//     call sites use (PageContainer keeps the spinner/error/children branch;
//     VehicleSelect = an option-chip row bound to the page selection; MetricCard =
//     label/value/tinted glyph; Badge = a tinted pill; Slider = a -/+ stepper with
//     a fill track preserving label/formatValue/min/max/step/value/onChange).
//   • The shared web <GlassPanel>/<FadeIn>/<RadialGauge>/<EmptyState>/<Skeleton>/
//     <AIRangePrediction> -> the already-ported native components. <StaggerContainer>/
//     <StaggerItem> collapse to the native grid View + Cell wrappers (the section
//     FadeIn already supplies the entrance animation).
//   • lucide-react glyphs (Gauge/TrendingUp/Thermometer/Wind/Mountain/Car/
//     Lightbulb/Zap/BatteryFull/Shield/Snowflake) -> the native SemanticIcon
//     registry glyphs.
//   • Recharts <AreaChart>/<Area>/<XAxis>/<YAxis>/<CartesianGrid>/<Tooltip>/
//     <Legend>/<ReferenceLine>/<ResponsiveContainer> (+ ChartTooltip/chartMargin/
//     axisTick/AREA_DEFAULTS/areaGradient) -> a native-safe ProjectionCurveChart:
//     the rated + projected range series are drawn as shared-scale line segments
//     with translucent area strips (so projected stays visually below rated, like
//     the Recharts shared Y axis), a "current" battery reference marker, axis
//     captions, and a legend. No recharts import.
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys); every API path / query key / state name is preserved. No DOM
// elements, react-i18next, lucide-react, framer-motion, Recharts, Leaflet,
// react-dom, or web UI-kit modules are imported into the native output.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {request} from '../../../api/client';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {FadeIn} from '../../../components/motion/FadeIn';
import {AIRangePrediction} from '../../../components/ai/AIRangePrediction';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {
  getSemanticIconDefinition,
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ──────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

/* ─── inlined @/components/charts CHART_COLORS (static CB-safe palette) ──── */

// `import { CHART_COLORS } from '@/components/charts'` resolves to the static
// Okabe-Ito CB-safe palette (@/lib/colors CHART_COLORS = CHART_COLORS_CB_SAFE).
const CHART_COLORS = [
  '#0072B2', // blue
  '#E69F00', // orange
  '#009E73', // bluish green
  '#F0E442', // yellow
  '#56B4E9', // sky blue
  '#D55E00', // vermillion
  '#CC79A7', // reddish purple
  '#4B4B4B', // neutral grey
] as const;

/* ─── inlined @/lib/numberFormat fmtNumber ──────────────────────────────── */

const DEFAULT_LOCALE = 'en-US';
// web numberFormat global precision default (set from settings.decimal_precision).
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber(value, decimals?, locale?): locale-aware fixed-decimal formatting
// with non-finite inputs coerced to 0; a bad locale tag falls back to en-US so a
// string is always produced.
function formatFixed(value: number, locale: string, digits: number): string {
  const d = Math.max(0, Math.min(20, Math.floor(digits)));
  try {
    return value.toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return value.toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

/* ─── inlined @/lib/unitConversion (SI-floor converters + formatters) ───── */

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const SECONDS_PER_HOUR = 3600;
const DEFAULT_EMPTY_DISPLAY = '—';
const DIST_DEFAULT_PRECISION = 1;
const SPEED_DEFAULT_PRECISION = 0;
const TEMP_DEFAULT_PRECISION = 1;
const ENERGY_DEFAULT_PRECISION = 2;

type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '°C' | '°F';
type EnergyUnitPref = 'Wh' | 'kWh';

interface UnitPref {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
  energy: EnergyUnitPref;
  locale?: string;
  precision?: number;
}

interface FormatOptions {
  precision?: number;
}

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  return to === 'mph'
    ? (mps * SECONDS_PER_HOUR) / METERS_PER_MILE
    : (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
}

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  return to === '°F' ? (celsius * 9) / 5 + 32 : celsius;
}

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  return to === 'kWh' ? wh / 1000 : wh;
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function resolvePrecision(
  pref: UnitPref,
  override: number | undefined,
  fallback: number,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  if (
    typeof pref.precision === 'number' &&
    Number.isFinite(pref.precision) &&
    pref.precision >= 0
  ) {
    return Math.floor(pref.precision);
  }
  return fallback;
}

// SI meters -> display distance with a trailing unit (web formatDistance).
function unitFormatDistance(
  meters: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(meters)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const d = resolvePrecision(pref, options?.precision, DIST_DEFAULT_PRECISION);
  return `${formatFixed(convertDistanceFromSI(meters, pref.distance), pref.locale ?? DEFAULT_LOCALE, d)} ${pref.distance}`;
}

// SI m/s -> display speed with a trailing unit (web formatSpeed).
function unitFormatSpeed(
  mps: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(mps)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const d = resolvePrecision(pref, options?.precision, SPEED_DEFAULT_PRECISION);
  return `${formatFixed(convertSpeedFromSI(mps, pref.speed), pref.locale ?? DEFAULT_LOCALE, d)} ${pref.speed}`;
}

// SI °C -> display temperature (web formatTemperature: no space before the °unit).
function unitFormatTemperature(
  celsius: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(celsius)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const d = resolvePrecision(pref, options?.precision, TEMP_DEFAULT_PRECISION);
  return `${formatFixed(convertTempFromSI(celsius, pref.temperature), pref.locale ?? DEFAULT_LOCALE, d)}${pref.temperature}`;
}

// SI Wh -> display energy with a trailing unit (web formatEnergy).
function unitFormatEnergy(
  wh: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(wh)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const d = resolvePrecision(pref, options?.precision, ENERGY_DEFAULT_PRECISION);
  return `${formatFixed(convertEnergyFromSI(wh, pref.energy), pref.locale ?? DEFAULT_LOCALE, d)} ${pref.energy}`;
}

// web useUnits' deriveDistance / deriveSpeed / deriveTemperature.
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}
function deriveSpeed(unitOfLength: string | undefined): SpeedUnitPref {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
}
function deriveTemperature(unitOfTemp: string | undefined): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '°F' : '°C';
}
function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}
// useUnits derivePrecision: undefined when unset (lib applies per-quantity default).
function deriveUnitPrecision(decimalPrecision: unknown): number | undefined {
  if (
    typeof decimalPrecision === 'number' &&
    Number.isFinite(decimalPrecision) &&
    decimalPrecision >= 0
  ) {
    return Math.floor(decimalPrecision);
  }
  return undefined;
}

/* ─── inlined @/hooks/useSelectedVehicle ────────────────────────────────── */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Native useSelectedVehicle: RN has no router path/query precedence or persisted
// store, so the selection lives in local state, defaulting to the first vehicle
// the moment the fleet loads (the web hook's final precedence tier).
function useSelectedVehicle(): SelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const [stored, setVehicleId] = useState<number | null>(null);

  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setVehicleId(firstVehicleId);
    }
  }, [stored, firstVehicleId]);

  const effectiveId = stored ?? firstVehicleId;
  return {vehicleId: effectiveId, vehicles, setVehicleId};
}

/* ─── neon tint tokens (web @/lib/tokens neonColorMap) ──────────────────── */

type NeonColor = 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'blue';

interface NeonTint {
  fg: string;
  bg: string;
  border: string;
}

const NEON_TINT: Record<NeonColor, NeonTint> = {
  cyan: {fg: colors.accent, bg: colors.accentSoft, border: colors.borderAccent},
  green: {
    fg: colors.success,
    bg: colors.successSurface,
    border: colors.successBorder,
  },
  amber: {
    fg: colors.warning,
    bg: colors.warningSurface,
    border: colors.warningBorder,
  },
  red: {fg: colors.danger, bg: colors.dangerSurface, border: colors.dangerBorder},
  purple: {
    fg: colors.violet,
    bg: colors.violetSurface,
    border: colors.violetBorder,
  },
  blue: {
    fg: '#a5b4fc',
    bg: 'rgba(99, 102, 241, 0.12)',
    border: 'rgba(99, 102, 241, 0.32)',
  },
};

/* ── Types (web verbatim) ── */

interface RangeFactor {
  name: string;
  impact_pct: number;
  description: string;
}
interface CurvePoint {
  battery_pct: number;
  rated_range: number;
  projected_range: number;
}
interface EfficiencyBucket {
  temp_bucket: string;
  speed_bucket: string;
  wh_km: number;
  samples: number;
}
interface RangeScenario {
  name: string;
  speed_kmh: number;
  temp_c: number;
  efficiency_wh_km: number;
  range_km: number;
  range_mi: number;
  sample_count: number;
  extras: string[];
  is_current?: boolean;
}
interface RangeProjection {
  current_range_km: number;
  projected_range_km: number;
  battery_level: number;
  efficiency_factor: number;
  factors: RangeFactor[];
  projection_curve: CurvePoint[];
  current_battery_pct: number;
  usable_capacity_wh: number;
  health_factor: number;
  scenarios: RangeScenario[];
  efficiency_matrix: EfficiencyBucket[];
  tesla_estimate_km: number;
  your_estimate_km: number;
  accuracy_note: string;
}

// web FACTOR_ICONS (lucide nodes) -> native SemanticIcon registry glyphs.
const FACTOR_ICONS: Record<string, SemanticIconName> = {
  temperature: 'climate', // Thermometer
  speed: 'vehicle', // Car
  hvac: 'wind', // Wind
  elevation: 'map', // Mountain
  driving_style: 'speedCircle', // Gauge
};

const TEMP_BUCKETS = ['freezing', 'cold', 'mild', 'hot'] as const;
const SPEED_BUCKETS = ['city', 'suburban', 'highway'] as const;

// web effColor returned bg-* classes; natively it returns a translucent cell
// background (Tailwind's `bg-opacity-20` baked in).
function effColor(whKm: number): string {
  if (whKm <= 155) {
    return 'rgba(52, 211, 153, 0.20)'; // neon green
  }
  if (whKm <= 180) {
    return 'rgba(16, 185, 129, 0.20)'; // emerald-500
  }
  if (whKm <= 210) {
    return 'rgba(251, 191, 36, 0.20)'; // neon amber
  }
  return 'rgba(248, 113, 113, 0.20)'; // red
}

// web scenarioIcon (lucide nodes) -> native SemanticIcon registry glyph names.
function scenarioIcon(scenario: RangeScenario): SemanticIconName {
  if ((scenario.extras ?? []).includes('sentry')) {
    return 'security'; // Shield
  }
  if (scenario.temp_c < 0) {
    return 'cooling'; // Snowflake
  }
  if (scenario.speed_kmh > 90) {
    return 'vehicle'; // Car
  }
  return 'bolt'; // Zap
}

/* ── "What if" interpolation (web verbatim) ── */

function interpolateRange(
  matrix: EfficiencyBucket[],
  speedKmh: number,
  tempC: number,
  batteryPct: number,
  capacityWh: number,
): {effWhKm: number; rangeKm: number} {
  const tempBucket =
    tempC < 0 ? 'freezing' : tempC < 10 ? 'cold' : tempC < 25 ? 'mild' : 'hot';
  const speedBucket = speedKmh < 50 ? 'city' : speedKmh < 90 ? 'suburban' : 'highway';

  const match = matrix.find(
    b => b.temp_bucket === tempBucket && b.speed_bucket === speedBucket,
  );
  let eff = match?.wh_km ?? 155 + (speedKmh - 35) * 0.5 + Math.max(0, 20 - tempC) * 1.5;
  if (eff <= 0) {
    eff = 170;
  }
  const rangeKm = (capacityWh * (batteryPct / 100)) / eff;
  return {
    effWhKm: Math.round(eff * 10) / 10,
    rangeKm: Math.round(rangeKm * 10) / 10,
  };
}

/* ─── inlined @/components/ui Badge (subset: success/danger/neutral, sm) ─── */

type BadgeVariant = 'success' | 'danger' | 'neutral';

function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ─── inlined @/components/data-display MetricCard (subset used here) ────── */

function MetricCard({
  label,
  value,
  icon,
  color = 'cyan',
}: {
  label: string;
  value: string | number;
  icon?: SemanticIconName;
  color?: NeonColor;
}) {
  const tint = NEON_TINT[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricRow}>
        <View style={styles.metricBody}>
          <AppText numberOfLines={1} style={styles.metricLabel} tone="muted">
            {label}
          </AppText>
          <AppText numberOfLines={1} style={styles.metricValue} weight="bold">
            {value}
          </AppText>
        </View>
        {icon ? (
          <View
            style={[
              styles.metricIconBox,
              {backgroundColor: tint.bg, borderColor: tint.border},
            ]}>
            <AppText style={[styles.metricIconGlyph, {color: tint.fg}]} weight="bold">
              {getSemanticIconDefinition(icon).glyph}
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// Grid cell wrapper mirroring the web responsive metric grids by wrapping to
// ~2-up on a phone.
function Cell({children}: {children: ReactNode}) {
  return <View style={styles.cell}>{children}</View>;
}

/* ─── inlined @/components/ui Slider (range input substitute) ────────────── */

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// web <Slider> wraps <input type="range">; RN has no range input, so the value
// is adjusted with -/+ steppers (the same `step` the APG arrow keys use) while a
// fill track preserves the visual position. label/formatValue/min/max/step/value/
// onChange are all preserved.
function Slider({
  label,
  formatValue,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  formatValue?: (n: number) => string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const display = formatValue ? formatValue(value) : String(value);
  const fraction = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{min, max, now: value, text: display}}
      style={styles.sliderBlock}>
      <View style={styles.sliderHeader}>
        <AppText style={styles.sliderLabel} tone="secondary" weight="semibold">
          {label}
        </AppText>
        <AppText style={styles.sliderValue} tone="muted">
          {display}
        </AppText>
      </View>
      <View style={styles.sliderRow}>
        <Pressable
          accessibilityLabel={`${label} decrease`}
          accessibilityRole="button"
          onPress={() => onChange(clamp(value - step, min, max))}
          style={({pressed}) => [styles.sliderBtn, pressed && styles.sliderBtnPressed]}>
          <AppText style={styles.sliderBtnText} weight="bold">
            −
          </AppText>
        </Pressable>
        <View style={styles.sliderTrack}>
          <View style={[styles.sliderFill, {width: `${fraction * 100}%`}]} />
        </View>
        <Pressable
          accessibilityLabel={`${label} increase`}
          accessibilityRole="button"
          onPress={() => onChange(clamp(value + step, min, max))}
          style={({pressed}) => [styles.sliderBtn, pressed && styles.sliderBtnPressed]}>
          <AppText style={styles.sliderBtnText} weight="bold">
            +
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

/* ─── inlined @/components/forms VehicleSelect (option-chip substitute) ──── */

interface SelectOption {
  value: string;
  label: string;
}

// web <VehicleSelect> renders a native <select> wired to the global selection and
// nothing when the fleet is empty; natively it is a row of pressable option chips
// driven by the page's useSelectedVehicle state (rule 5).
function VehicleSelect({
  options,
  value,
  onChange,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (options.length === 0) {
    return null;
  }
  return (
    <View style={styles.optionRow}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange(opt.value)}
            style={({pressed}) => [
              styles.option,
              active ? styles.optionActive : null,
              pressed ? styles.optionPressed : null,
            ]}>
            <AppText
              numberOfLines={1}
              style={active ? styles.optionTextActive : styles.optionText}
              weight={active ? 'semibold' : 'regular'}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── inlined @/components/layout PageContainer ─────────────────────────── */

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  children: ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>

      {loading ? (
        <View style={styles.pageLoading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.pageErrorBox}>
          <AppText style={styles.pageErrorText}>{error.message}</AppText>
        </View>
      ) : (
        <View style={styles.sections}>{children}</View>
      )}
    </ScrollView>
  );
}

/* ─── native-safe Range Projection Curve (Recharts AreaChart substitute) ── */

const CURVE_HEIGHT = 200;
const CURVE_DEFAULT_WIDTH = 280;
const CURVE_STROKE = 2;

interface CurveSegment {
  key: string;
  left: number;
  top: number;
  width: number;
  angle: string;
}

interface CurveAreaStrip {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CurveGeometry {
  segments: CurveSegment[];
  areaStrips: CurveAreaStrip[];
}

// Build line segments + faint area strips for one series on a SHARED [min,max]
// scale (so rated vs projected keep their relative heights, like a Recharts
// shared Y axis).
function buildCurveGeometry(
  values: number[],
  width: number,
  height: number,
  min: number,
  max: number,
  prefix: string,
): CurveGeometry {
  if (values.length === 0) {
    return {segments: [], areaStrips: []};
  }
  const range = max - min || 1;
  const points = values.map((v, i) => ({
    x: values.length === 1 ? width / 2 : (i / (values.length - 1)) * width,
    y: height - (clamp(safeNumber(v), min, max) - min) / range * height,
  }));

  const segments: CurveSegment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len <= 0) {
      continue;
    }
    const midX = a.x + dx / 2;
    const midY = a.y + dy / 2;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    segments.push({
      key: `${prefix}-s${i}`,
      left: midX - len / 2,
      top: midY - CURVE_STROKE / 2,
      width: len,
      angle: `${angle}deg`,
    });
  }

  const stripWidth =
    points.length === 1 ? Math.max(width, 1) : Math.max(width / points.length, 1);
  const areaStrips: CurveAreaStrip[] = points.map((p, i) => ({
    key: `${prefix}-a${i}`,
    left: clamp(p.x - stripWidth / 2, 0, Math.max(width - stripWidth, 0)),
    top: p.y,
    width: stripWidth,
    height: Math.max(height - p.y, 0),
  }));

  return {segments, areaStrips};
}

function CurveSeries({
  geometry,
  color,
}: {
  geometry: CurveGeometry;
  color: string;
}) {
  return (
    <>
      {geometry.areaStrips.map(strip => (
        <View
          key={strip.key}
          pointerEvents="none"
          style={[
            styles.curveAreaStrip,
            {
              backgroundColor: color,
              left: strip.left,
              top: strip.top,
              width: strip.width,
              height: strip.height,
            },
          ]}
        />
      ))}
      {geometry.segments.map(segment => (
        <View
          key={segment.key}
          pointerEvents="none"
          style={[
            styles.curveSegment,
            {
              backgroundColor: color,
              left: segment.left,
              top: segment.top,
              width: segment.width,
              transform: [{rotateZ: segment.angle}],
            },
          ]}
        />
      ))}
    </>
  );
}

function LegendItem({color, label}: {color: string; label: string}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, {backgroundColor: color}]} />
      <AppText numberOfLines={1} style={styles.legendText} tone="secondary">
        {label}
      </AppText>
    </View>
  );
}

function ProjectionCurveChart({
  curve,
  batteryLevel,
  ratedLabel,
  projectedLabel,
  currentLabel,
  fmt,
}: {
  curve: CurvePoint[];
  batteryLevel: number;
  ratedLabel: string;
  projectedLabel: string;
  currentLabel: string;
  fmt: (v: unknown, decimals?: number) => string;
}) {
  const [plotWidth, setPlotWidth] = useState(CURVE_DEFAULT_WIDTH);

  const rated = curve.map(p => safeNumber(p.rated_range));
  const projected = curve.map(p => safeNumber(p.projected_range));
  const maxVal = Math.max(...rated, ...projected, 1);

  const ratedGeo = useMemo(
    () => buildCurveGeometry(rated, plotWidth, CURVE_HEIGHT, 0, maxVal, 'rated'),
    [rated, plotWidth, maxVal],
  );
  const projectedGeo = useMemo(
    () =>
      buildCurveGeometry(projected, plotWidth, CURVE_HEIGHT, 0, maxVal, 'projected'),
    [projected, plotWidth, maxVal],
  );

  // Recharts plots a category axis by index, so anchor the "current" marker to
  // the curve point whose battery_pct is nearest the live battery level.
  const nearestIdx = useMemo(() => {
    let bestIdx = 0;
    let bestDelta = Infinity;
    curve.forEach((p, i) => {
      const delta = Math.abs(safeNumber(p.battery_pct) - batteryLevel);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    });
    return bestIdx;
  }, [curve, batteryLevel]);

  const markerX =
    curve.length > 1 ? (nearestIdx / (curve.length - 1)) * plotWidth : plotWidth / 2;

  const firstPct = curve.length > 0 ? safeNumber(curve[0].battery_pct) : 0;
  const lastPct =
    curve.length > 0 ? safeNumber(curve[curve.length - 1].battery_pct) : 0;

  return (
    <View>
      <View
        accessibilityRole="summary"
        accessibilityLabel={`Range projection curve with ${curve.length} points`}
        onLayout={e => {
          const w = e.nativeEvent.layout.width;
          if (w > 0 && Math.abs(w - plotWidth) > 1) {
            setPlotWidth(w);
          }
        }}
        style={[styles.curvePlot, {height: CURVE_HEIGHT}]}>
        <CurveSeries color={CHART_COLORS[0]} geometry={ratedGeo} />
        <CurveSeries color={CHART_COLORS[1]} geometry={projectedGeo} />
        <View
          pointerEvents="none"
          style={[styles.curveMarker, {left: clamp(markerX, 0, plotWidth), backgroundColor: CHART_COLORS[3]}]}
        />
        <AppText style={styles.curveYTop} tone="muted">
          {`${fmt(maxVal, 0)} km`}
        </AppText>
        <AppText style={styles.curveYBottom} tone="muted">
          0
        </AppText>
      </View>

      <View style={styles.curveXRow}>
        <AppText style={styles.curveXLabel} tone="muted">
          {`${fmt(firstPct, 0)}%`}
        </AppText>
        <AppText style={styles.curveXLabel} tone="muted">
          {`${fmt(lastPct, 0)}%`}
        </AppText>
      </View>

      <View style={styles.legendRow}>
        <LegendItem color={CHART_COLORS[0]} label={ratedLabel} />
        <LegendItem color={CHART_COLORS[1]} label={projectedLabel} />
        <LegendItem color={CHART_COLORS[3]} label={currentLabel} />
      </View>
    </View>
  );
}

/* ── Component ── */

export default function ProjectedRangePage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('range.title', 'Projected Range'));

  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);
  // web numberFormat global precision = settings.decimal_precision (default 2).
  const numberPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : DEFAULT_PRECISION;

  // web fmtNumber relies on module globals; here it closes over the settings-
  // derived precision + locale so `fmtNumber(x)` keeps the user's default.
  const fmtNumber = useCallback(
    (v: unknown, decimals?: number): string =>
      formatFixed(safeNumber(v), locale, decimals ?? numberPrecision),
    [locale, numberPrecision],
  );

  // web useUnits: a UnitPref bag fed to the SI-floor formatters.
  const pref = useMemo<UnitPref>(
    () => ({
      distance: deriveDistance(settings?.unit_of_length),
      speed: deriveSpeed(settings?.unit_of_length),
      temperature: deriveTemperature(settings?.unit_of_temp),
      energy: 'kWh',
      locale,
      precision: deriveUnitPrecision(settings?.decimal_precision),
    }),
    [settings?.unit_of_length, settings?.unit_of_temp, locale, settings?.decimal_precision],
  );
  const formatEnergy = useCallback(
    (v: number | null | undefined, o?: FormatOptions) => unitFormatEnergy(v, pref, o),
    [pref],
  );
  const formatTemperature = useCallback(
    (v: number | null | undefined, o?: FormatOptions) =>
      unitFormatTemperature(v, pref, o),
    [pref],
  );
  const formatSpeed = useCallback(
    (v: number | null | undefined, o?: FormatOptions) => unitFormatSpeed(v, pref, o),
    [pref],
  );
  const formatDistance = useCallback(
    (v: number | null | undefined, o?: FormatOptions) => unitFormatDistance(v, pref, o),
    [pref],
  );

  // Header VehiclePicker is the source of truth.
  const {vehicleId: globalVehicleId, vehicles, setVehicleId} = useSelectedVehicle();
  const activeId = globalVehicleId != null ? String(globalVehicleId) : '';

  const {data, isLoading, error} = useQuery<RangeProjection>({
    queryKey: ['range-projection', activeId],
    queryFn: ({signal}) =>
      request<RangeProjection>(`/analytics/range-projection?vehicle_id=${activeId}`, {
        signal,
      }),
    enabled: activeId !== '',
  });

  // What-if sliders
  const [whatIfSpeed, setWhatIfSpeed] = useState(80);
  const [whatIfTemp, setWhatIfTemp] = useState(20);

  const whatIfResult = useMemo(() => {
    if (!data) {
      return null;
    }
    return interpolateRange(
      data.efficiency_matrix ?? [],
      whatIfSpeed,
      whatIfTemp,
      data.current_battery_pct ?? data.battery_level ?? 80,
      data.usable_capacity_wh ?? 75000,
    );
  }, [data, whatIfSpeed, whatIfTemp]);

  const efficiencyColor =
    (data?.efficiency_factor ?? 0) >= 0.9
      ? CHART_COLORS[1]
      : (data?.efficiency_factor ?? 0) >= 0.7
        ? CHART_COLORS[3]
        : CHART_COLORS[5];

  // Build efficiency heatmap lookup
  const matrixLookup = useMemo(() => {
    const map: Record<string, EfficiencyBucket> = {};
    for (const b of data?.efficiency_matrix ?? []) {
      map[`${b.temp_bucket}|${b.speed_bucket}`] = b;
    }
    return map;
  }, [data]);

  const tips = useMemo<{icon: SemanticIconName; text: string}[]>(
    () => [
      {icon: 'bolt', text: t('range.tip.speed', 'Keep speed under 110 km/h for optimal efficiency.')},
      {icon: 'climate', text: t('range.tip.precondition', 'Pre-condition the cabin while still plugged in.')},
      {icon: 'wind', text: t('range.tip.seatHeaters', 'Use seat heaters instead of cabin heat in cold weather.')},
      {icon: 'trendUp', text: t('range.tip.elevation', 'Plan routes to minimize elevation changes.')},
    ],
    [t],
  );

  const vehicleOptions = vehicles.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));

  return (
    <PageContainer
      title={t('range.title', 'Projected Range')}
      subtitle={t(
        'range.subtitle',
        'Personalized range estimates based on your driving patterns, weather, and conditions',
      )}
      loading={isLoading}
      error={error instanceof Error ? error : null}
      actions={
        <VehicleSelect
          options={vehicleOptions}
          value={activeId}
          onChange={id => {
            const next = Number(id);
            setVehicleId(Number.isFinite(next) && next > 0 ? next : null);
          }}
        />
      }>
      {/* ── Hero: Current range vs Tesla estimate ───── */}
      <FadeIn>
        <View style={styles.grid}>
          <Cell>
            <MetricCard
              label={t('range.yourEstimate', 'Your Estimate')}
              value={`${fmtNumber(data?.your_estimate_km, 0)} km`}
              icon="trendUp"
              color="green"
            />
          </Cell>
          <Cell>
            <MetricCard
              label={t('range.teslaEstimate', 'Tesla Estimate')}
              value={`${fmtNumber(data?.tesla_estimate_km, 0)} km`}
              icon="vehicle"
              color="cyan"
            />
          </Cell>
          <Cell>
            <MetricCard
              label={t('range.battery', 'Battery')}
              value={`${fmtNumber(data?.current_battery_pct ?? data?.battery_level, 0)}%`}
              icon="batteryFull"
              color="purple"
            />
          </Cell>
          <Cell>
            <MetricCard
              label={t('range.usableCapacity', 'Usable Capacity')}
              value={formatEnergy(data?.usable_capacity_wh)}
              icon="bolt"
              color="amber"
            />
          </Cell>
          <Cell>
            <MetricCard
              label={t('range.healthFactor', 'Health Factor')}
              value={`${fmtNumber((data?.health_factor ?? 1) * 100, 1)}%`}
              icon="security"
              color="green"
            />
          </Cell>
        </View>
      </FadeIn>

      {/* Opt-in learned per-vehicle range model. Renders only when       */}
      {/* ai_mode != 'off' AND the range-prediction-model toggle is on.  */}
      {/* withAiFeature inside AIRangePrediction enforces the gate; the   */}
      {/* deterministic heuristic Wh/km curve + linear projection below  */}
      {/* remains the canonical baseline in off mode AND is the fallback  */}
      {/* for the learned trainer when fewer than 5 qualifying drives     */}
      {/* exist for a (temp × speed) bucket in the lookback window.       */}
      {/* The fallback keeps predictions available when model data is     */}
      {/* sparse for a bucket.                                           */}
      {/* Users can compare learned and deterministic ranges side by side. */}
      <FadeIn delay={0.045}>
        <AIRangePrediction vehicleId={globalVehicleId ?? undefined} />
      </FadeIn>

      {/* ── Gauge + Projection Curve ───────────────── */}
      <FadeIn delay={0.05}>
        <View style={styles.gaugeCurveRow}>
          <GlassPanel style={styles.gaugePanel}>
            {data ? (
              <RadialGauge
                value={Math.round(data.efficiency_factor * 100)}
                max={100}
                label={t('range.efficiency', 'Efficiency')}
                unit="%"
                color={efficiencyColor}
                size={160}
              />
            ) : (
              <Skeleton width={160} height={160} rounded />
            )}
            {data?.accuracy_note ? (
              <AppText style={styles.accuracyNote} tone="muted">
                {data.accuracy_note}
              </AppText>
            ) : null}
          </GlassPanel>

          <GlassPanel style={styles.curvePanel}>
            <AppText style={styles.curveTitle} tone="secondary" weight="semibold">
              {t('range.projectionCurve', 'Range Projection Curve')}
            </AppText>
            {data?.projection_curve && data.projection_curve.length > 0 ? (
              <ProjectionCurveChart
                curve={data.projection_curve}
                batteryLevel={data.battery_level}
                ratedLabel={t('range.rated', 'Rated Range')}
                projectedLabel={t('range.projected', 'Projected Range')}
                currentLabel={t('range.current', 'Current')}
                fmt={fmtNumber}
              />
            ) : (
              <Skeleton height={260} />
            )}
          </GlassPanel>
        </View>
      </FadeIn>

      {/* ── Scenario Cards ─────────────────────────── */}
      <FadeIn delay={0.1}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.sectionTitle} weight="semibold">
            {t('range.scenarios', 'Range Scenarios')}
          </AppText>
          {(data?.scenarios ?? []).length > 0 ? (
            <View style={styles.scenarioGrid}>
              {(data?.scenarios ?? []).map(s => (
                <View
                  key={s.name}
                  style={[styles.scenarioCard, s.is_current && styles.scenarioCardCurrent]}>
                  <View style={styles.scenarioHeader}>
                    <View style={styles.scenarioHeaderLeft}>
                      <SemanticIcon decorative name={scenarioIcon(s)} size="sm" />
                      <AppText numberOfLines={1} style={styles.scenarioName} weight="semibold">
                        {s.name}
                      </AppText>
                    </View>
                    {s.is_current ? (
                      <Badge variant="success">{t('range.current', 'Current')}</Badge>
                    ) : null}
                  </View>
                  <AppText style={styles.scenarioValue} weight="bold">
                    {formatDistance(s.range_km * 1000, {precision: 0})}
                  </AppText>
                  <View style={styles.scenarioMetaRow}>
                    <AppText style={styles.scenarioMeta} tone="muted">
                      {formatSpeed(s.speed_kmh / 3.6, {precision: 0})}
                    </AppText>
                    <AppText style={styles.scenarioMeta} tone="muted">
                      {formatTemperature(s.temp_c, {precision: 0})}
                    </AppText>
                    <AppText style={styles.scenarioMeta} tone="muted">
                      {`${fmtNumber(s.efficiency_wh_km)} Wh/km`}
                    </AppText>
                    {s.sample_count > 0 ? (
                      <AppText style={styles.scenarioMeta} tone="muted">
                        {`(${s.sample_count} drives)`}
                      </AppText>
                    ) : null}
                  </View>
                  {s.extras.length > 0 ? (
                    <View style={styles.scenarioExtras}>
                      {s.extras.map(x => (
                        <Badge key={x} variant="neutral">
                          {x}
                        </Badge>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available.
            <EmptyState
              message={t(
                'range.noScenarios',
                'Drive more to see personalized scenario projections.',
              )}
              style={styles.panelEmpty}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Efficiency Matrix Heatmap ──────────────── */}
      <FadeIn delay={0.15}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.sectionTitle} weight="semibold">
            {t('range.efficiencyMatrix', 'Personal Efficiency Matrix (Wh/km)')}
          </AppText>
          {(data?.efficiency_matrix ?? []).length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.matrixWrap}>
                {/* Header row */}
                <View style={styles.matrixRow}>
                  <View style={styles.matrixHeadSpacer} />
                  {SPEED_BUCKETS.map(s => (
                    <View key={s} style={styles.matrixHeadCell}>
                      <AppText style={styles.matrixHeadText} tone="muted">
                        {s}
                      </AppText>
                    </View>
                  ))}
                </View>
                {/* Data rows */}
                {TEMP_BUCKETS.map(temp => (
                  <View key={temp} style={styles.matrixRow}>
                    <View style={styles.matrixRowLabelCell}>
                      <AppText style={styles.matrixRowLabel} tone="muted" weight="semibold">
                        {temp}
                      </AppText>
                    </View>
                    {SPEED_BUCKETS.map(speed => {
                      const bucket = matrixLookup[`${temp}|${speed}`];
                      return (
                        <View key={speed} style={styles.matrixCellWrap}>
                          {bucket ? (
                            <View
                              style={[
                                styles.matrixCell,
                                {backgroundColor: effColor(bucket.wh_km)},
                              ]}>
                              <AppText style={styles.matrixCellValue} weight="bold">
                                {fmtNumber(bucket.wh_km, 0)}
                              </AppText>
                              <AppText style={styles.matrixCellSamples} tone="muted">
                                {`(${bucket.samples})`}
                              </AppText>
                            </View>
                          ) : (
                            <View style={[styles.matrixCell, styles.matrixCellEmpty]}>
                              <AppText style={styles.matrixCellDash} tone="muted">
                                —
                              </AppText>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available.
            <EmptyState
              message={t(
                'range.noMatrix',
                'Efficiency data requires drives in different conditions.',
              )}
              style={styles.panelEmpty}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── "What If" Sliders ─────────────────────── */}
      <FadeIn delay={0.2}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.sectionTitle} weight="semibold">
            {t('range.whatIf', 'What If Calculator')}
          </AppText>
          <View style={styles.whatIfGrid}>
            <View style={styles.whatIfControls}>
              <View>
                <Slider
                  label={t('range.speed', 'Speed')}
                  formatValue={n => `${n} km/h`}
                  min={30}
                  max={150}
                  step={5}
                  value={whatIfSpeed}
                  onChange={setWhatIfSpeed}
                />
                <View style={styles.sliderTicks}>
                  <AppText style={styles.sliderTick} tone="muted">
                    30
                  </AppText>
                  <AppText style={styles.sliderTick} tone="muted">
                    90
                  </AppText>
                  <AppText style={styles.sliderTick} tone="muted">
                    150
                  </AppText>
                </View>
              </View>
              <View>
                <Slider
                  label={t('range.temperature', 'Temperature')}
                  formatValue={n => `${n}°C`}
                  min={-20}
                  max={40}
                  step={1}
                  value={whatIfTemp}
                  onChange={setWhatIfTemp}
                />
                <View style={styles.sliderTicks}>
                  <AppText style={styles.sliderTick} tone="muted">
                    -20°C
                  </AppText>
                  <AppText style={styles.sliderTick} tone="muted">
                    10°C
                  </AppText>
                  <AppText style={styles.sliderTick} tone="muted">
                    40°C
                  </AppText>
                </View>
              </View>
            </View>
            <View style={styles.whatIfResultCell}>
              {whatIfResult ? (
                <View style={styles.whatIfResult}>
                  <AppText style={styles.whatIfRange} weight="bold">
                    {formatDistance(whatIfResult.rangeKm * 1000, {precision: 0})}
                  </AppText>
                  <AppText style={styles.whatIfEff} tone="muted">
                    {`${fmtNumber(whatIfResult.effWhKm)} Wh/km`}
                  </AppText>
                  <AppText style={styles.whatIfCond} tone="muted">
                    {t('range.whatIfConditions', 'at {{speed}}, {{temp}}')
                      .replace('{{speed}}', formatSpeed(whatIfSpeed / 3.6, {precision: 0}))
                      .replace('{{temp}}', formatTemperature(whatIfTemp, {precision: 0}))}
                  </AppText>
                </View>
              ) : (
                // no-action: transient empty state — surfaces when source data is
                // missing; no specific recovery action available.
                <EmptyState
                  message={t('range.noWhatIf', 'Adjust sliders to calculate projected range.')}
                  style={styles.panelEmpty}
                />
              )}
            </View>
          </View>
        </GlassPanel>
      </FadeIn>

      {/* ── Range Factors ──────────────────────────── */}
      <FadeIn delay={0.25}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.sectionTitle} weight="semibold">
            {t('range.factors', 'Range Factors')}
          </AppText>
          <View style={styles.factorGrid}>
            {(data?.factors ?? []).map(f => (
              <View key={f.name} style={styles.factorCard}>
                <SemanticIcon
                  decorative
                  name={FACTOR_ICONS[(f.name ?? '').toLowerCase().replace(/\s+/g, '_')] ?? 'speedCircle'}
                  size="sm"
                />
                <View style={styles.factorBody}>
                  <View style={styles.factorHeader}>
                    <AppText style={styles.factorName} weight="semibold">
                      {t(`range.factor.${f.name}`, f.name)}
                    </AppText>
                    <Badge variant={f.impact_pct >= 0 ? 'success' : 'danger'}>
                      {`${f.impact_pct >= 0 ? '+' : ''}${fmtNumber(f.impact_pct, 1)}%`}
                    </Badge>
                  </View>
                  <AppText style={styles.factorDesc} tone="muted">
                    {t(`range.factorDesc.${f.name}`, f.description)}
                  </AppText>
                </View>
              </View>
            ))}
          </View>
        </GlassPanel>
      </FadeIn>

      {/* ── Tips ───────────────────────────────────── */}
      <FadeIn delay={0.3}>
        <GlassPanel style={styles.panel}>
          <View style={styles.tipsHeader}>
            <SemanticIcon decorative name="lightbulb" size="sm" />
            <AppText style={styles.sectionTitle} weight="semibold">
              {t('range.tips', 'Tips to Maximize Range')}
            </AppText>
          </View>
          <View style={styles.tipsList}>
            {tips.map((tip, i) => (
              <View key={i} style={styles.tipRow}>
                <SemanticIcon decorative name={tip.icon} size="sm" />
                <AppText style={styles.tipText} tone="secondary">
                  {tip.text}
                </AppText>
              </View>
            ))}
          </View>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  pageHeaderText: {
    flexShrink: 1,
    minWidth: 0,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
  },
  pageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  pageLoading: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageErrorBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    padding: spacing.md,
  },
  pageErrorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  sections: {
    gap: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  cell: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 140,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelEmpty: {
    paddingVertical: spacing.xl,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  /* metric card */
  metricCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metricBody: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
  },
  metricIconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
  },
  metricIconGlyph: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  /* badge */
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
  },
  /* gauge + curve */
  gaugeCurveRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gaugePanel: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 150,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  accuracyNote: {
    marginTop: spacing.xs,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
  curvePanel: {
    flexGrow: 1,
    flexBasis: '60%',
    minWidth: 260,
    padding: spacing.md,
    gap: spacing.sm,
  },
  curveTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  curvePlot: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
  },
  curveAreaStrip: {
    position: 'absolute',
    opacity: 0.16,
  },
  curveSegment: {
    position: 'absolute',
    height: CURVE_STROKE,
    borderRadius: CURVE_STROKE / 2,
  },
  curveMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    opacity: 0.7,
  },
  curveYTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    fontSize: 10,
    lineHeight: 14,
  },
  curveYBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    fontSize: 10,
    lineHeight: 14,
  },
  curveXRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  curveXLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    lineHeight: 14,
  },
  /* scenarios */
  scenarioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  scenarioCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 150,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    gap: spacing.xs,
  },
  scenarioCardCurrent: {
    borderColor: colors.successBorder,
  },
  scenarioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  scenarioHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  scenarioName: {
    flexShrink: 1,
    color: colors.textPrimary,
    fontSize: 13,
  },
  scenarioValue: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
  },
  scenarioMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  scenarioMeta: {
    fontSize: 10,
    lineHeight: 14,
  },
  scenarioExtras: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  /* efficiency matrix */
  matrixWrap: {
    minWidth: 400,
    gap: spacing.xs,
  },
  matrixRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  matrixHeadSpacer: {
    width: 84,
  },
  matrixHeadCell: {
    width: 96,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  matrixHeadText: {
    fontSize: 12,
    lineHeight: 16,
    textTransform: 'capitalize',
  },
  matrixRowLabelCell: {
    width: 84,
    justifyContent: 'center',
  },
  matrixRowLabel: {
    fontSize: 12,
    lineHeight: 16,
    textTransform: 'capitalize',
  },
  matrixCellWrap: {
    width: 96,
  },
  matrixCell: {
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matrixCellEmpty: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  matrixCellValue: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
  matrixCellSamples: {
    fontSize: 9,
    lineHeight: 12,
  },
  matrixCellDash: {
    fontSize: 12,
    lineHeight: 16,
  },
  /* what if */
  whatIfGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  whatIfControls: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 220,
    gap: spacing.md,
  },
  whatIfResultCell: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatIfResult: {
    alignItems: 'center',
  },
  whatIfRange: {
    color: colors.accent,
    fontSize: 34,
    lineHeight: 40,
  },
  whatIfEff: {
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
  },
  whatIfCond: {
    marginTop: spacing.xs,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  /* slider */
  sliderBlock: {
    gap: spacing.xs,
  },
  sliderHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sliderLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
  sliderValue: {
    fontSize: 12,
    lineHeight: 16,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sliderBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderBtnPressed: {
    backgroundColor: colors.surfaceHover,
  },
  sliderBtnText: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 22,
  },
  sliderTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  sliderTicks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  sliderTick: {
    fontSize: 9,
    lineHeight: 12,
  },
  /* factors */
  factorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  factorCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 200,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
  },
  factorBody: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  factorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  factorName: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  factorDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  /* tips */
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tipsList: {
    gap: spacing.sm,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  /* vehicle select */
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  option: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  optionActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  optionTextActive: {
    color: colors.accent,
    fontSize: 13,
  },
});

const badgeVariantStyles = StyleSheet.create({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
});
