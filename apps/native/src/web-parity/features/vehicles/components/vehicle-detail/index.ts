// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/index.ts.
//
// The web file is the `vehicle-detail` barrel: 14 `export { X } from './X'` lines
// re-exporting the vehicle-detail page's presentational section components
// (VehicleHeader, BatteryRangePanel, LiveStateIndicators, QuickStatsGrid,
// MotorSection, ClimateSection, SecuritySection, TirePressureSection,
// ChargingTelemetrySection, BatteryRangeCharts, RecentDrivesSection,
// RecentChargesSection, VehicleConfigSection, QuickLinksSection).
//
// None of those 14 sibling components have been converted to native yet, so —
// matching the established precedent for a barrel whose siblings are not yet
// ported (the components/a11y and components/motion barrels were likewise
// self-contained .ts modules at creation time) — this file is a SELF-CONTAINED
// native-safe implementation. Later per-component conversions are expected to
// extract these into sibling .tsx files and slim this barrel down to re-exports.
//
// The conversion contract requires the output to be `index.ts` (not .tsx), and a
// `.ts` file cannot contain JSX, so every element is built with
// `React.createElement` (aliased `h`) — the same approach used by the a11y /
// motion barrel ports.
//
// Web modules -> native-safe mappings (contract rules 4-7):
//   - react-i18next `useTranslation` -> a local key-preserving fallback shim that
//     returns the inline English copy and interpolates `{{token}}` placeholders
//     (SecuritySection's `{{count}}`), so every i18n key + intent survives.
//   - `@/hooks/useUnits` -> a local shim reading the native `useSettings`
//     web-parity hook and exposing formatDistance / formatSpeed /
//     formatTemperature / formatPressure (+ settings-bound fmtNumber / fmtInt and
//     a `unitPrefs` bag). The SI converters and formatters are inlined verbatim
//     from `@/lib/unitConversion` (same NIST constants, same DEFAULT_PRECISION,
//     same SI-floor contract: meters/m·s⁻¹/°C/kPa/Wh in, user unit out).
//   - `@/hooks/useFormatting` -> a local shim exposing `formatCurrency` from the
//     settings `currency_symbol` + `decimal_precision` (verbatim logic).
//   - `@/lib/numberFormat` (fmtNumber/fmtInt) -> inlined locale-aware helpers; the
//     user `decimal_precision` is honoured via the useUnits binding (web globals).
//   - `@/lib/dateFormat` (formatDate/formatDateTime) -> inlined Intl-based ports.
//   - `./helpers` (batteryColor, TIRE_PRESSURE_PA, paToKpa, tirePressureVariant,
//     durationStr) -> inlined verbatim (the helpers module is not yet ported).
//   - `@/components/ui` GlassPanel -> the native shared `components/ui/GlassPanel`.
//     Badge -> the ported `web-parity/components/ui/Badge` (variant/dot/size API).
//     DataTable + Column -> the ported `web-parity/components/ui/DataTable`.
//   - `@/components/charts` RadialGauge -> the ported native RadialGauge. The
//     Recharts bar/area chart bodies in BatteryRangeCharts are FORBIDDEN on native
//     (rule 4); the battery composition is reproduced with proportional View bars
//     and the drive-distance trend with View bars (EmptyState when no data),
//     preserving the visual intent without SVG/Recharts. See
//     `nativeVehicleDetailCapabilities`.
//   - `@/components/data-display` MetricCard/AnimatedNumber/KVList -> local
//     View-based shims reproducing the web look (MetricCard drops the decorative
//     lucide icon — the label carries meaning — and surfaces the colour prop as a
//     small leading dot; AnimatedNumber renders the final value statically, native
//     has no rAF count-up). `@/components/feedback` EmptyState/Skeleton -> local
//     message/placeholder shims.
//   - lucide-react icons -> small decorative emoji glyphs in `AppText`
//     (accessibilityElementsHidden — the adjacent heading/label text carries the
//     meaning), the established native icon mapping.
//   - react-router-dom `Link` (back link, "View all", quick links) -> native has
//     no DOM router, so these render as `accessibilityRole="link"` Views that
//     preserve the visual + a11y intent but do not navigate; the `to` target is
//     retained in intent for a future React Navigation wiring. VehicleHeader's
//     wake `Button` keeps its real `onWake`/`waking` behaviour via a Pressable.
//   - `cn` (Tailwind merge) -> dropped; styling moves to StyleSheet + token
//     colours, with dynamic values (battery/severity colours, bar widths) inlined.
//
// DOM -> native: every `<div>` -> `View`; `<span>`/`<p>`/`<h*>` -> `AppText`.
// Tailwind spacing maps at 1 unit = 4px. No DOM modules, browser HTML elements,
// Recharts, Leaflet, react-router-dom, framer-motion, or old web UI components are
// imported.

import React, {useMemo, type ReactElement, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {Badge} from '../../../../components/ui/Badge';
import {DataTable, type Column} from '../../../../components/ui/DataTable';
import {RadialGauge} from '../../../../components/charts/RadialGauge';
import {useSettings} from '../../../../api/hooks/useSettings';
import {statusVariant} from '../../../../api/types';
import type {
  ChargingSession,
  ChargingTelemetry,
  ClimateSnapshot,
  Drive,
  MotorSnapshot,
  SecurityEvent,
  TirePressureSnapshot,
  Vehicle,
  VehicleConfigSnapshot,
  VehicleState,
  VehicleStatus,
} from '../../../../api/types';

const h = React.createElement;

// Instantiation-expression aliases (TS 4.7+) so the generic DataTable can be
// rendered via React.createElement with a concrete row type.
const DrivesTable = DataTable<Drive>;
const ChargesTable = DataTable<ChargingSession>;

// The native shared GlassPanel marks `children` as required, which trips
// React.createElement's typed overloads when children are passed variadically.
// This thin wrapper makes children optional so the barrel can compose panels
// with `h(GPanel, {style}, ...children)`.
function GPanel({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}): ReactElement {
  return h(GlassPanel, {style, children});
}

// ─── Shared constants ─────────────────────────────────────────
const EMPTY_DISPLAY = '—';
const DEFAULT_LOCALE = 'en-US';
// web numberFormat `_globalPrecision` initial (useSettings promotes it to
// the user's decimal_precision).
const DEFAULT_GLOBAL_PRECISION = 2;

// lib/unitConversion conversion factors (NIST-grade, verbatim).
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;
const KPA_PER_PSI = 6.894757;
const KPA_PER_BAR = 100;
const SECONDS_PER_HOUR = 3600;

// lib/unitConversion DEFAULT_PRECISION (per-quantity fallback when unset).
const PRECISION_DISTANCE = 1;
const PRECISION_SPEED = 0;
const PRECISION_TEMPERATURE = 1;
const PRECISION_PRESSURE = 1;

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '°C' | '°F';
type PressureUnitPref = 'kPa' | 'psi' | 'bar';
type EnergyUnitPref = 'Wh' | 'kWh';

interface FormatOptions {
  precision?: number;
}

// ─── i18n fallback shim ───────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
// `{{token}}` placeholders are interpolated from the options bag (SecuritySection
// uses `{{count}}`).
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback: string, opts?: TOptions) => string;

function interpolate(template: string, opts?: TOptions): string {
  if (!opts) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
    opts[token] != null ? String(opts[token]) : match,
  );
}

function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback, opts) => interpolate(fallback, opts)};
}

// ─── Inlined number helpers (@/lib/numberFormat) ──────────────
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatNumber(
  value: unknown,
  decimals: number,
  locale: string = DEFAULT_LOCALE,
): string {
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

// ─── Inlined SI converters (@/lib/unitConversion) ─────────────
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

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  return to === '°F' ? (celsius * 9) / 5 + 32 : celsius;
}

function convertPressureFromSI(kpa: number, to: PressureUnitPref): number {
  switch (to) {
    case 'kPa':
      return kpa;
    case 'psi':
      return kpa / KPA_PER_PSI;
    case 'bar':
      return kpa / KPA_PER_BAR;
  }
}

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  return to === 'kWh' ? wh / 1000 : wh;
}

// ─── Inlined date helpers (@/lib/dateFormat) ──────────────────
function formatDate(value: string | null | undefined, locale?: string): string {
  if (!value) {
    return EMPTY_DISPLAY;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return EMPTY_DISPLAY;
  }
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(
  value: string | null | undefined,
  locale?: string,
): string {
  if (!value) {
    return EMPTY_DISPLAY;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return EMPTY_DISPLAY;
  }
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── `useUnits` derivations (web @/hooks/useUnits) ────────────
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function deriveSpeed(unitOfLength: string | undefined): SpeedUnitPref {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
}

function deriveTemperature(unitOfTemp: string | undefined): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

function derivePressure(unitOfPressure: string | undefined): PressureUnitPref {
  return unitOfPressure === 'psi' ? 'psi' : 'bar';
}

function deriveLocale(locale: string | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') {
    return undefined;
  }
  if (!Number.isFinite(decimalPrecision) || decimalPrecision < 0) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

function resolvePrecision(
  prefPrecision: number | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  if (
    typeof prefPrecision === 'number' &&
    Number.isFinite(prefPrecision) &&
    prefPrecision >= 0
  ) {
    return Math.floor(prefPrecision);
  }
  return fallback;
}

interface UnitPrefs {
  distance: DistanceUnitPref;
}

type UnitFormatter = (
  value: number | null | undefined,
  options?: FormatOptions,
) => string;

interface UseUnitsResult {
  unitPrefs: UnitPrefs;
  formatDistance: UnitFormatter;
  formatSpeed: UnitFormatter;
  formatTemperature: UnitFormatter;
  formatPressure: UnitFormatter;
  fmtNumber: (value: unknown, decimals?: number) => string;
  fmtInt: (value: unknown) => string;
}

// Mirrors the web `useUnits -> useSettings` chain. Reads settings once, derives a
// stable preference bag, and exposes SI-floor formatters that convert at the
// display boundary. fmtNumber/fmtInt honour the user's decimal_precision (web
// numberFormat globals) so the call sites stay byte-identical.
function useUnits(): UseUnitsResult {
  const {data: settings} = useSettings();
  const distance = deriveDistance(settings?.unit_of_length);
  const speed = deriveSpeed(settings?.unit_of_length);
  const temperature = deriveTemperature(settings?.unit_of_temp);
  const pressure = derivePressure(settings?.unit_of_pressure);
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);
  const numberPrecision = precision ?? DEFAULT_GLOBAL_PRECISION;

  const formatDistance: UnitFormatter = (value, options) => {
    if (!isFiniteNumber(value)) {
      return EMPTY_DISPLAY;
    }
    const digits = resolvePrecision(precision, options?.precision, PRECISION_DISTANCE);
    return `${formatNumber(convertDistanceFromSI(value, distance), digits, locale)} ${distance}`;
  };

  const formatSpeed: UnitFormatter = (value, options) => {
    if (!isFiniteNumber(value)) {
      return EMPTY_DISPLAY;
    }
    const digits = resolvePrecision(precision, options?.precision, PRECISION_SPEED);
    return `${formatNumber(convertSpeedFromSI(value, speed), digits, locale)} ${speed}`;
  };

  const formatTemperature: UnitFormatter = (value, options) => {
    if (!isFiniteNumber(value)) {
      return EMPTY_DISPLAY;
    }
    const digits = resolvePrecision(
      precision,
      options?.precision,
      PRECISION_TEMPERATURE,
    );
    // No space between number and °unit (typographic convention).
    return `${formatNumber(convertTempFromSI(value, temperature), digits, locale)}${temperature}`;
  };

  const formatPressure: UnitFormatter = (value, options) => {
    if (!isFiniteNumber(value)) {
      return EMPTY_DISPLAY;
    }
    const digits = resolvePrecision(precision, options?.precision, PRECISION_PRESSURE);
    return `${formatNumber(convertPressureFromSI(value, pressure), digits, locale)} ${pressure}`;
  };

  const fmtNumber = (value: unknown, decimals: number = numberPrecision): string =>
    formatNumber(value, decimals, locale);

  const fmtInt = (value: unknown): string => formatNumber(value, 0, locale);

  return {
    unitPrefs: {distance},
    formatDistance,
    formatSpeed,
    formatTemperature,
    formatPressure,
    fmtNumber,
    fmtInt,
  };
}

// ─── `useFormatting` shim (web @/hooks/useFormatting) ─────────
function useFormatting(): {formatCurrency: (amount: number, decimals?: number) => string} {
  const {data: settings} = useSettings();
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const locale = deriveLocale(settings?.locale);
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;

  const formatCurrency = (amount: number, decimals?: number): string =>
    `${currencySymbol}${formatNumber(amount, decimals ?? userPrecision, locale)}`;

  return {formatCurrency};
}

// ─── Inlined `./helpers` ──────────────────────────────────────
function batteryColor(level: number): string {
  if (level > 60) {
    return '#10b981';
  }
  if (level > 25) {
    return '#f59e0b';
  }
  return '#ef4444';
}

// Backend tire-pressure SI baseline is Pascals; thresholds live in Pa so one
// canonical source of truth is shared. Display converts Pa -> kPa -> user pref.
const TIRE_PRESSURE_PA = Object.freeze({
  LOW_CRITICAL: 206_800, // ≈ 30.0 psi / 2.068 bar
  LOW_WARNING: 241_300, // ≈ 35.0 psi / 2.413 bar
  HIGH_WARNING: 310_300, // ≈ 45.0 psi / 3.103 bar
  HIGH_CRITICAL: 344_700, // ≈ 50.0 psi / 3.447 bar
} as const);

function paToKpa(pa: number | null | undefined): number | null {
  if (pa == null || !Number.isFinite(pa)) {
    return null;
  }
  return pa / 1000;
}

type TireVariant = 'success' | 'warning' | 'danger' | 'neutral';

function tirePressureVariant(pa: number | null | undefined): TireVariant {
  if (pa == null || !Number.isFinite(pa)) {
    return 'neutral';
  }
  if (pa < TIRE_PRESSURE_PA.LOW_CRITICAL || pa > TIRE_PRESSURE_PA.HIGH_CRITICAL) {
    return 'danger';
  }
  if (pa < TIRE_PRESSURE_PA.LOW_WARNING || pa > TIRE_PRESSURE_PA.HIGH_WARNING) {
    return 'warning';
  }
  return 'success';
}

function durationStr(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = formatNumber(minutes % 60, 0);
  return hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
}

// SecuritySection windowOpenCount: count windows reading > 0 (percent open).
function windowOpenCount(s: SecurityEvent): number {
  const fields = [s.fd_window, s.fp_window, s.rd_window, s.rp_window];
  let open = 0;
  for (const v of fields) {
    if (v == null) {
      continue;
    }
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n > 0) {
      open += 1;
    }
  }
  return open;
}

// ─── Presentational shims ─────────────────────────────────────

// lucide icon -> decorative emoji glyph. The adjacent heading/label text carries
// the meaning, so the glyph is hidden from the accessibility tree.
function Glyph({
  glyph,
  style,
}: {
  glyph: string;
  style?: StyleProp<TextStyle>;
}): ReactElement {
  return h(
    AppText,
    {
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
      style: [styles.glyph, style],
    },
    glyph,
  );
}

function SectionHeading({
  glyph,
  title,
  glyphColor,
  right,
}: {
  glyph: string;
  title: string;
  glyphColor?: string;
  right?: ReactNode;
}): ReactElement {
  const heading = h(
    View,
    {style: styles.headingLeft},
    h(Glyph, {glyph, style: glyphColor ? {color: glyphColor} : styles.headingGlyph}),
    h(AppText, {style: styles.headingText}, title),
  );
  if (right) {
    return h(View, {style: styles.headingRow}, heading, right);
  }
  return h(View, {style: styles.heading}, heading);
}

type MetricColor = 'cyan' | 'green' | 'purple';

const metricDotColors: Record<MetricColor, string> = {
  cyan: colors.accent,
  green: colors.success,
  purple: colors.violet,
};

// web MetricCard (compact). The decorative lucide icon is dropped (the label
// carries the meaning); the `color` prop becomes a small leading dot.
function MetricCard({
  label,
  value,
  color = 'cyan',
  subtitle,
}: {
  label: string;
  value: string | number;
  color?: MetricColor;
  subtitle?: string;
}): ReactElement {
  return h(
    View,
    {style: styles.metricCard},
    h(
      View,
      {style: styles.metricLabelRow},
      h(View, {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants',
        style: [styles.metricDot, {backgroundColor: metricDotColors[color]}],
      }),
      h(AppText, {style: styles.metricLabel, tone: 'muted'}, label),
    ),
    h(AppText, {style: styles.metricValue}, value),
    subtitle
      ? h(AppText, {style: styles.metricSubtitle, tone: 'muted'}, subtitle)
      : null,
  );
}

// web feedback EmptyState (message-only, optional decorative glyph). Web no-action
// note: transient empty state — surfaces when source data is missing; no specific
// recovery action available.
function EmptyState({
  message,
  glyph,
}: {
  message: string;
  glyph?: string;
}): ReactElement {
  return h(
    View,
    {accessibilityRole: 'text', style: styles.emptyState},
    glyph ? h(Glyph, {glyph, style: styles.emptyGlyph}) : null,
    h(AppText, {style: styles.emptyMessage, tone: 'muted'}, message),
  );
}

// web feedback Skeleton (loading placeholder bars).
function Skeleton({
  lines,
  height,
}: {
  lines: number;
  height: number;
}): ReactElement {
  const bars: ReactElement[] = [];
  for (let i = 0; i < lines; i += 1) {
    bars.push(
      h(View, {
        key: `sk-${i}`,
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants',
        style: [styles.skeletonBar, {height}],
      }),
    );
  }
  return h(View, {accessibilityRole: 'progressbar', style: styles.skeleton}, bars);
}

interface KVItem {
  label: string;
  value: ReactNode;
}

// web data-display KVList (label/value rows, 1 or 2 columns).
function KVList({
  items,
  columns = 1,
}: {
  items: KVItem[];
  columns?: 1 | 2;
}): ReactElement {
  const rows = items.map(item =>
    h(
      View,
      {key: item.label, style: columns === 2 ? styles.kvRowTwoCol : styles.kvRow},
      h(AppText, {style: styles.kvLabel, tone: 'muted'}, item.label),
      h(AppText, {style: styles.kvValue}, item.value),
    ),
  );
  return h(
    View,
    {style: columns === 2 ? styles.kvListTwoCol : styles.kvList},
    rows,
  );
}

// web data-display AnimatedNumber. Native renders the final value statically (no
// rAF count-up); the formatted output matches the web end state.
function AnimatedNumber({
  value,
  decimals = 0,
  prefix,
  suffix,
  style,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}): ReactElement {
  return h(
    AppText,
    {style},
    `${prefix ?? ''}${formatNumber(value, decimals)}${suffix ?? ''}`,
  );
}

// react-router-dom Link -> native-safe non-navigating link (no DOM router). The
// `to` target is retained in intent for a future React Navigation wiring.
function NavLink({
  children,
  style,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}): ReactElement {
  return h(View, {accessibilityRole: 'link', style}, children);
}

// ─── Proportional / trend bars (Recharts replacement) ─────────
function CompositionBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}): ReactElement {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return h(
    View,
    {style: styles.compRow},
    h(AppText, {style: styles.compLabel, tone: 'muted'}, label),
    h(
      View,
      {style: styles.compTrack},
      h(View, {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants',
        style: [styles.compFill, {width: `${pct * 100}%`, backgroundColor: color}],
      }),
    ),
    h(AppText, {style: styles.compValue}, formatNumber(value, 0)),
  );
}

interface TrendPoint {
  date: string;
  distance: number;
  duration: number;
}

const TREND_MAX_HEIGHT = 120;

function TrendBars({
  data,
  unit,
}: {
  data: TrendPoint[];
  unit: string;
}): ReactElement {
  const maxDistance = data.reduce((m, d) => Math.max(m, d.distance), 0);
  const bars = data.map((d, i) => {
    const ratio = maxDistance > 0 ? d.distance / maxDistance : 0;
    const barHeight = Math.max(4, Math.round(ratio * TREND_MAX_HEIGHT));
    return h(
      View,
      {key: `trend-${i}-${d.date}`, style: styles.trendColumn},
      h(AppText, {style: styles.trendValue, tone: 'muted'}, formatNumber(d.distance, 0)),
      h(View, {style: styles.trendBarTrack}, h(View, {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants',
        style: [styles.trendBar, {height: barHeight}],
      })),
      h(AppText, {style: styles.trendDate, tone: 'muted', numberOfLines: 1}, d.date),
    );
  });
  return h(
    View,
    {style: styles.trendWrap},
    h(AppText, {style: styles.trendLegend, tone: 'muted'}, `Distance (${unit})`),
    h(View, {style: styles.trendRow}, bars),
  );
}

// ─── 1. VehicleHeader ─────────────────────────────────────────
interface VehicleHeaderProps {
  vehicle: Vehicle | undefined;
  status: VehicleStatus;
  onWake: () => void;
  waking: boolean;
}

export function VehicleHeader({
  vehicle,
  status,
  onWake,
  waking,
}: VehicleHeaderProps): ReactElement {
  const {t} = useTranslation();
  return h(
    GPanel,
    {style: styles.panel},
    h(
      View,
      {style: styles.headerRow},
      h(NavLink, {style: styles.backLink}, h(Glyph, {glyph: '←', style: styles.backGlyph})),
      h(
        View,
        {style: styles.headerCenter},
        h(
          View,
          {style: styles.headerBadges},
          h(Badge, {variant: statusVariant(status), dot: true, size: 'lg'}, status),
          h(
            Badge,
            {variant: 'neutral', size: 'sm'},
            `${vehicle?.model ?? ''} ${vehicle?.trim_badging ?? ''}`.trim(),
          ),
        ),
        h(
          AppText,
          {style: styles.vin, tone: 'muted', numberOfLines: 1},
          vehicle?.vin ?? '',
        ),
      ),
      h(
        Pressable,
        {
          accessibilityRole: 'button',
          accessibilityState: {disabled: waking, busy: waking},
          disabled: waking,
          onPress: onWake,
          style: styles.wakeButton,
        },
        h(Glyph, {glyph: '⏻', style: styles.wakeGlyph}),
        h(
          AppText,
          {style: styles.wakeLabel},
          waking ? t('common.waking', 'Waking…') : t('common.wakeUp', 'Wake Up'),
        ),
      ),
    ),
  );
}

// ─── 2. BatteryRangePanel ─────────────────────────────────────
interface BatteryRangePanelProps {
  state: VehicleState;
}

export function BatteryRangePanel({state}: BatteryRangePanelProps): ReactElement {
  const {t} = useTranslation();
  const {formatDistance, fmtNumber} = useUnits();
  return h(
    GPanel,
    {style: styles.panel},
    h(
      View,
      {style: styles.batteryRow},
      h(RadialGauge, {
        value: state.battery_level,
        max: 100,
        label: t('common.battery', 'Battery'),
        unit: '%',
        color: batteryColor(state.battery_level),
        size: 140,
      }),
      h(
        View,
        {style: styles.metricGrid},
        h(MetricCard, {
          label: t('vehicles.detail.ratedRange', 'Rated Range'),
          value: formatDistance(state.rated_range, {precision: 0}),
          color: 'cyan',
        }),
        h(MetricCard, {
          label: t('vehicles.detail.idealRange', 'Ideal Range'),
          value: formatDistance(state.ideal_range, {precision: 0}),
          color: 'green',
        }),
        h(MetricCard, {
          label: t('common.charging', 'Charging'),
          value: state.is_charging
            ? `${formatDistance(state.charge_rate)}/h`
            : t('common.notCharging', 'Not Charging'),
          color: state.is_charging ? 'green' : 'cyan',
          subtitle:
            state.is_charging && state.time_to_full_charge > 0
              ? `${t('vehicles.detail.fullIn', 'Full in')} ${fmtNumber(state.time_to_full_charge, 1)}h`
              : undefined,
        }),
      ),
    ),
  );
}

// ─── 3. LiveStateIndicators ───────────────────────────────────
interface LiveStateIndicatorsProps {
  state: VehicleState;
}

export function LiveStateIndicators({
  state,
}: LiveStateIndicatorsProps): ReactElement {
  const {t} = useTranslation();
  const {formatSpeed} = useUnits();
  return h(
    View,
    {style: styles.badgeRow},
    h(
      Badge,
      {variant: state.speed > 0 ? 'success' : 'neutral', dot: true, size: 'lg'},
      `${t('common.speed', 'Speed')}: ${formatSpeed(state.speed, {precision: 0})}`,
    ),
    h(
      Badge,
      {variant: state.is_locked ? 'success' : 'danger', dot: true, size: 'lg'},
      state.is_locked
        ? t('common.locked', 'Locked')
        : t('common.unlocked', 'Unlocked'),
    ),
    h(
      Badge,
      {variant: state.sentry_mode ? 'warning' : 'neutral', dot: true, size: 'lg'},
      `${t('common.sentry', 'Sentry')}: ${
        state.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off')
      }`,
    ),
    h(
      Badge,
      {variant: state.is_climate_on ? 'info' : 'neutral', dot: true, size: 'lg'},
      `${t('common.climate', 'Climate')}: ${
        state.is_climate_on ? t('common.on', 'On') : t('common.off', 'Off')
      }`,
    ),
    h(
      Badge,
      {variant: state.is_charging ? 'warning' : 'neutral', dot: true, size: 'lg'},
      state.is_charging
        ? t('common.charging', 'Charging')
        : t('common.notCharging', 'Not Charging'),
    ),
  );
}

// ─── 4. QuickStatsGrid ────────────────────────────────────────
interface QuickStatsGridProps {
  state: VehicleState;
  status: VehicleStatus;
}

export function QuickStatsGrid({
  state,
  status,
}: QuickStatsGridProps): ReactElement {
  const {t} = useTranslation();
  const {formatDistance, formatSpeed, formatTemperature, fmtNumber} = useUnits();
  return h(
    View,
    {style: styles.metricGrid},
    h(MetricCard, {
      label: t('common.battery', 'Battery'),
      value: `${state.battery_level}%`,
      color: state.battery_level > 50 ? 'green' : 'cyan',
    }),
    h(MetricCard, {
      label: t('common.range', 'Range'),
      value: formatDistance(state.rated_range, {precision: 0}),
      color: 'cyan',
    }),
    h(MetricCard, {
      label: t('common.odometer', 'Odometer'),
      value: formatDistance(state.odometer, {precision: 0}),
      color: 'purple',
    }),
    h(MetricCard, {
      label: t('common.speed', 'Speed'),
      value: formatSpeed(state.speed, {precision: 0}),
      color: 'cyan',
      subtitle:
        state.speed > 0
          ? t('common.driving', 'Driving')
          : t('common.parked', 'Parked'),
    }),
    h(MetricCard, {
      label: t('common.insideTemp', 'Inside Temp'),
      value: formatTemperature(state.inside_temp),
      color: 'green',
    }),
    h(MetricCard, {
      label: t('common.outsideTemp', 'Outside Temp'),
      value: formatTemperature(state.outside_temp),
      color: 'cyan',
    }),
    h(MetricCard, {
      label: t('common.power', 'Power'),
      value: `${fmtNumber(state.power)} kW`,
      color: 'purple',
    }),
    h(MetricCard, {
      label: t('common.state', 'State'),
      value: status,
      color: 'cyan',
    }),
  );
}

// ─── 5. MotorSection ──────────────────────────────────────────
interface MotorSectionProps {
  motorData: MotorSnapshot | null | undefined;
}

export function MotorSection({motorData}: MotorSectionProps): ReactElement {
  const {t} = useTranslation();
  const {formatTemperature, fmtNumber, fmtInt} = useUnits();

  const maxMotorTemp = motorData
    ? Math.max(
        motorData.motor_temp_c_front ?? -Infinity,
        motorData.motor_temp_c_rear ?? -Infinity,
      )
    : null;
  const vbat = motorData?.vbat_rear ?? motorData?.vbat_front ?? null;

  return h(
    GPanel,
    {style: styles.panel},
    h(SectionHeading, {glyph: '⚙️', title: t('vehicles.detail.motor', 'Powertrain')}),
    motorData
      ? h(
          View,
          {style: styles.metricGrid},
          h(MetricCard, {
            label: t('vehicles.detail.shiftState', 'Shift State'),
            value: motorData.shift_state ?? EMPTY_DISPLAY,
            color: 'cyan',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.packVoltage', 'Pack Voltage'),
            value: vbat != null ? `${fmtNumber(vbat)} V` : EMPTY_DISPLAY,
            color: 'purple',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.motorCurrentFront', 'Motor Current (F)'),
            value:
              motorData.motor_current_front != null
                ? `${fmtNumber(motorData.motor_current_front)} A`
                : EMPTY_DISPLAY,
            color: 'green',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.torqueFront', 'Front Torque'),
            value:
              motorData.torque_nm_front != null
                ? `${fmtNumber(motorData.torque_nm_front)} Nm`
                : EMPTY_DISPLAY,
            color: 'cyan',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.torqueRear', 'Rear Torque'),
            value:
              motorData.torque_nm_rear != null
                ? `${fmtNumber(motorData.torque_nm_rear)} Nm`
                : EMPTY_DISPLAY,
            color: 'purple',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.rpmFront', 'Front RPM'),
            value:
              motorData.motor_rpm_front != null
                ? fmtInt(motorData.motor_rpm_front)
                : EMPTY_DISPLAY,
            color: 'cyan',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.rpmRear', 'Rear RPM'),
            value:
              motorData.motor_rpm_rear != null
                ? fmtInt(motorData.motor_rpm_rear)
                : EMPTY_DISPLAY,
            color: 'purple',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.motorTemp', 'Motor Temp (peak)'),
            value:
              maxMotorTemp != null && isFinite(maxMotorTemp)
                ? formatTemperature(maxMotorTemp)
                : EMPTY_DISPLAY,
            color: 'green',
          }),
        )
      : h(EmptyState, {
          message: t('vehicles.detail.noMotorData', 'No motor data available'),
        }),
  );
}

// ─── 6. ClimateSection ────────────────────────────────────────
interface ClimateSectionProps {
  climateData: ClimateSnapshot | null | undefined;
}

export function ClimateSection({climateData}: ClimateSectionProps): ReactElement {
  const {t} = useTranslation();
  const {formatTemperature} = useUnits();
  const defrostOn =
    climateData?.defrost_mode != null && climateData.defrost_mode !== 'Off';
  const climateOn = climateData
    ? (climateData.is_ac_on ?? climateData.is_climate_on)
    : false;

  return h(
    GPanel,
    {style: styles.panel},
    h(SectionHeading, {glyph: '🌬️', title: t('vehicles.detail.climate', 'Climate')}),
    climateData
      ? h(
          View,
          {style: styles.metricGrid},
          h(MetricCard, {
            label: t('common.insideTemp', 'Inside Temp'),
            value: formatTemperature(
              climateData.inside_temp ?? climateData.inside_temp_c,
            ),
            color: 'green',
          }),
          h(MetricCard, {
            label: t('common.outsideTemp', 'Outside Temp'),
            value: formatTemperature(
              climateData.outside_temp ?? climateData.outside_temp_c,
            ),
            color: 'cyan',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.driverSetpoint', 'Driver Setpoint'),
            value: formatTemperature(
              climateData.driver_temp_setting ?? climateData.driver_setpoint_c,
            ),
            color: 'purple',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.fanSpeed', 'Fan Speed'),
            value:
              climateData.hvac_fan_status != null
                ? String(climateData.hvac_fan_status)
                : climateData.fan_status != null
                  ? String(climateData.fan_status)
                  : EMPTY_DISPLAY,
            color: 'cyan',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.seatHeaterL', 'Seat Heater Left'),
            value:
              climateData.seat_heater_left != null
                ? `${t('common.level', 'Level')} ${climateData.seat_heater_left}`
                : EMPTY_DISPLAY,
            color: 'green',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.seatHeaterR', 'Seat Heater Right'),
            value:
              climateData.seat_heater_right != null
                ? `${t('common.level', 'Level')} ${climateData.seat_heater_right}`
                : EMPTY_DISPLAY,
            color: 'green',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.defrost', 'Defrost'),
            value: defrostOn
              ? String(climateData.defrost_mode)
              : t('common.off', 'Off'),
            color: defrostOn ? 'green' : 'cyan',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.climateOn', 'Climate On'),
            value: climateOn ? t('common.on', 'On') : t('common.off', 'Off'),
            color: climateOn ? 'green' : 'cyan',
          }),
        )
      : h(EmptyState, {
          message: t('vehicles.detail.noClimateData', 'No climate data available'),
        }),
  );
}

// ─── 7. SecuritySection ───────────────────────────────────────
interface SecuritySectionProps {
  securityData: SecurityEvent | null | undefined;
  state: VehicleState;
}

export function SecuritySection({
  securityData,
  state,
}: SecuritySectionProps): ReactElement {
  const {t} = useTranslation();
  const windowsOpen = securityData ? windowOpenCount(securityData) : 0;
  const doorState =
    securityData?.door_state != null && securityData.door_state !== ''
      ? String(securityData.door_state)
      : null;

  return h(
    GPanel,
    {style: styles.panel},
    h(SectionHeading, {glyph: '🛡️', title: t('vehicles.detail.security', 'Security')}),
    securityData
      ? h(
          View,
          {style: styles.metricGrid},
          h(MetricCard, {
            label: t('common.locked', 'Locked'),
            value: state.is_locked ? t('common.yes', 'Yes') : t('common.no', 'No'),
            color: state.is_locked ? 'green' : 'cyan',
          }),
          h(MetricCard, {
            label: t('common.sentry', 'Sentry'),
            value: state.sentry_mode
              ? t('common.active', 'Active')
              : t('common.off', 'Off'),
            color: state.sentry_mode ? 'green' : 'cyan',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.doors', 'Doors'),
            value: doorState ?? t('common.closed', 'Closed'),
            color: doorState ? 'cyan' : 'green',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.windows', 'Windows'),
            value:
              windowsOpen > 0
                ? t('vehicles.detail.windowsOpen', '{{count}} open', {
                    count: windowsOpen,
                  })
                : t('common.closed', 'Closed'),
            color: windowsOpen > 0 ? 'cyan' : 'green',
          }),
        )
      : h(EmptyState, {
          message: t(
            'vehicles.detail.noSecurityData',
            'No security data available',
          ),
        }),
  );
}

// ─── 8. TirePressureSection ───────────────────────────────────
interface TirePressureSectionProps {
  tireData: TirePressureSnapshot | null | undefined;
}

const tireVariantBadge: Record<TireVariant, 'success' | 'warning' | 'danger' | 'neutral'> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'neutral',
};

export function TirePressureSection({
  tireData,
}: TirePressureSectionProps): ReactElement {
  const {t} = useTranslation();
  const {formatPressure} = useUnits();

  const tirePressures = tireData
    ? [
        {label: t('vehicles.detail.tireFl', 'Front Left'), value: tireData.front_left},
        {label: t('vehicles.detail.tireFr', 'Front Right'), value: tireData.front_right},
        {label: t('vehicles.detail.tireRl', 'Rear Left'), value: tireData.rear_left},
        {label: t('vehicles.detail.tireRr', 'Rear Right'), value: tireData.rear_right},
      ]
    : [];

  return h(
    GPanel,
    {style: styles.panel},
    h(SectionHeading, {
      glyph: '◉',
      title: t('vehicles.detail.tirePressure', 'Tire Pressure'),
    }),
    tireData
      ? h(
          View,
          {style: styles.metricGrid},
          tirePressures.map(tp => {
            const variant = tirePressureVariant(tp.value);
            const statusLabel =
              tp.value != null
                ? tp.value >= TIRE_PRESSURE_PA.LOW_WARNING &&
                  tp.value <= TIRE_PRESSURE_PA.HIGH_WARNING
                  ? t('common.normal', 'Normal')
                  : tp.value >= TIRE_PRESSURE_PA.LOW_CRITICAL &&
                      tp.value <= TIRE_PRESSURE_PA.HIGH_CRITICAL
                    ? t('common.low', 'Low')
                    : t('common.critical', 'Critical')
                : t('common.noData', 'No Data');
            return h(
              GPanel,
              {key: tp.label, style: styles.tireTile},
              h(AppText, {style: styles.tireLabel, tone: 'muted'}, tp.label),
              h(
                AppText,
                {style: styles.tireValue},
                formatPressure(paToKpa(tp.value)),
              ),
              h(
                View,
                {style: styles.tireBadge},
                h(Badge, {variant: tireVariantBadge[variant], size: 'sm'}, statusLabel),
              ),
            );
          }),
        )
      : h(EmptyState, {
          glyph: '◉',
          message: t(
            'vehicles.detail.noTireData',
            'No tire pressure data available',
          ),
        }),
  );
}

// ─── 9. ChargingTelemetrySection ──────────────────────────────
interface ChargingTelemetrySectionProps {
  chargingTelemetry: ChargingTelemetry | null | undefined;
}

export function ChargingTelemetrySection({
  chargingTelemetry,
}: ChargingTelemetrySectionProps): ReactElement {
  const {t} = useTranslation();
  const {formatDistance, formatSpeed, fmtNumber} = useUnits();

  return h(
    GPanel,
    {style: styles.panel},
    h(SectionHeading, {
      glyph: '⚡',
      glyphColor: colors.success,
      title: t('vehicles.detail.chargingTelemetry', 'Charging Telemetry'),
    }),
    chargingTelemetry
      ? h(
          View,
          {style: styles.metricGrid},
          h(MetricCard, {
            label: t('vehicles.detail.chargerPower', 'Charger Power'),
            value:
              chargingTelemetry.charger_power_w != null
                ? `${fmtNumber(chargingTelemetry.charger_power_w)} kW`
                : EMPTY_DISPLAY,
            color: 'green',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.voltage', 'Voltage'),
            value:
              chargingTelemetry.charger_voltage != null
                ? `${fmtNumber(chargingTelemetry.charger_voltage)} V`
                : EMPTY_DISPLAY,
            color: 'cyan',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.current', 'Current'),
            value:
              chargingTelemetry.charger_actual_current != null
                ? `${fmtNumber(chargingTelemetry.charger_actual_current)} A`
                : EMPTY_DISPLAY,
            color: 'purple',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.energyAdded', 'Energy Added'),
            value:
              chargingTelemetry.charge_energy_added_wh != null
                ? `${fmtNumber(chargingTelemetry.charge_energy_added_wh)} kWh`
                : EMPTY_DISPLAY,
            color: 'green',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.chargingState', 'Charging State'),
            value: chargingTelemetry.charging_state ?? EMPTY_DISPLAY,
            color: 'cyan',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.batteryLevel', 'Battery Level'),
            value:
              chargingTelemetry.battery_level != null
                ? `${fmtNumber(chargingTelemetry.battery_level)}%`
                : EMPTY_DISPLAY,
            color: 'green',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.chargeRate', 'Charge Rate'),
            value:
              chargingTelemetry.range_added_meters_per_hour != null
                ? formatSpeed(chargingTelemetry.range_added_meters_per_hour / 3600)
                : EMPTY_DISPLAY,
            color: 'cyan',
          }),
          h(MetricCard, {
            label: t('vehicles.detail.rangeAdded', 'Range Added'),
            value:
              chargingTelemetry.range_added_meters != null
                ? formatDistance(chargingTelemetry.range_added_meters)
                : EMPTY_DISPLAY,
            color: 'purple',
          }),
        )
      : h(EmptyState, {
          glyph: '⚡',
          message: t(
            'vehicles.detail.noChargingTelemetry',
            'No charging telemetry available',
          ),
        }),
  );
}

// ─── 10. BatteryRangeCharts ───────────────────────────────────
interface BatteryRangeChartsProps {
  state: VehicleState;
  drives: Drive[] | undefined;
}

export function BatteryRangeCharts({
  state,
  drives,
}: BatteryRangeChartsProps): ReactElement {
  const {t} = useTranslation();
  const {unitPrefs} = useUnits();

  const driveChartData = useMemo<TrendPoint[]>(
    () =>
      (drives ?? [])
        .map(d => ({
          date: formatDate(d.start_ts),
          distance: Math.round(
            convertDistanceFromSI(d.distance_m ?? 0, unitPrefs.distance),
          ),
          duration: Math.round((d.duration_s ?? 0) / 60),
        }))
        .reverse(),
    [drives, unitPrefs.distance],
  );

  const rangeValue = convertDistanceFromSI(state.rated_range, unitPrefs.distance);

  const batteryPanel = h(
    GPanel,
    {style: styles.panel},
    h(SectionHeading, {
      glyph: '🔋',
      title: t('vehicles.detail.batteryOverview', 'Battery Overview'),
    }),
    h(
      View,
      {style: styles.chartTopRow},
      h(RadialGauge, {
        value: state.battery_level,
        max: 100,
        label: t('common.battery', 'Battery'),
        unit: '%',
        color: batteryColor(state.battery_level),
        size: 100,
      }),
      h(
        View,
        {style: styles.chartStatsCol},
        h(
          GPanel,
          {style: styles.chartStatCard},
          h(AppText, {style: styles.chartStatLabel, tone: 'muted'}, t('common.battery', 'Battery')),
          h(AnimatedNumber, {
            value: state.battery_level,
            suffix: '%',
            style: styles.chartStatValue,
          }),
        ),
        h(
          GPanel,
          {style: styles.chartStatCard},
          h(AppText, {style: styles.chartStatLabel, tone: 'muted'}, t('common.range', 'Range')),
          h(AnimatedNumber, {
            value: rangeValue,
            decimals: 0,
            suffix: ` ${unitPrefs.distance}`,
            style: styles.chartStatValue,
          }),
        ),
      ),
    ),
    h(
      View,
      {style: styles.composition},
      h(CompositionBar, {
        label: t('common.current', 'Current'),
        value: state.battery_level,
        max: 100,
        color: colors.accent,
      }),
      h(CompositionBar, {
        label: t('common.remaining', 'Remaining'),
        value: 100 - state.battery_level,
        max: 100,
        color: colors.violet,
      }),
    ),
  );

  const trendPanel = h(
    GPanel,
    {style: styles.panel},
    h(SectionHeading, {
      glyph: '🛣️',
      title: t('vehicles.detail.driveTrend', 'Drive Distance Trend'),
    }),
    driveChartData.length > 0
      ? h(TrendBars, {data: driveChartData, unit: unitPrefs.distance})
      : h(EmptyState, {
          glyph: '🛣️',
          message: t('vehicles.detail.noDriveData', 'No drive data for chart'),
        }),
  );

  return h(View, {style: styles.chartsWrap}, batteryPanel, trendPanel);
}

// ─── 11. RecentDrivesSection ──────────────────────────────────
interface RecentDrivesSectionProps {
  drives: Drive[] | undefined;
}

export function RecentDrivesSection({
  drives,
}: RecentDrivesSectionProps): ReactElement {
  const {t} = useTranslation();
  const {unitPrefs, fmtNumber} = useUnits();
  const distanceUnit = unitPrefs.distance;

  const driveColumns: Column<Drive>[] = [
    {
      key: 'date',
      header: t('common.date', 'Date'),
      render: d => formatDateTime(d.start_ts),
    },
    {
      key: 'distance',
      header: t('common.distance', 'Distance'),
      render: d =>
        `${fmtNumber(convertDistanceFromSI(d.distance_m ?? 0, distanceUnit))} ${distanceUnit}`,
      sortable: true,
    },
    {
      key: 'duration',
      header: t('common.duration', 'Duration'),
      render: d => durationStr((d.duration_s ?? 0) / 60),
    },
    {
      key: 'battery',
      header: t('common.battery', 'Battery'),
      render: d =>
        d.start_soc_pct != null && d.end_soc_pct != null
          ? `${d.start_soc_pct}% → ${d.end_soc_pct}%`
          : EMPTY_DISPLAY,
    },
  ];

  const viewAll = h(
    NavLink,
    {style: styles.viewAll},
    h(AppText, {style: styles.viewAllText, tone: 'muted'}, t('common.viewAll', 'View all')),
    h(Glyph, {glyph: '›', style: styles.viewAllGlyph}),
  );

  return h(
    GPanel,
    {style: styles.panel},
    h(SectionHeading, {
      glyph: '🛣️',
      title: t('common.recentDrives', 'Recent Drives'),
      right: viewAll,
    }),
    drives && drives.length > 0
      ? h(DrivesTable, {
          tableId: 'vehicles:detail-recent-drives',
          columns: driveColumns,
          data: drives,
          keyExtractor: (d: Drive) => d.id,
          compact: true,
          pagination: true,
          emptyMessage: t('common.noDrives', 'No drives recorded yet'),
        })
      : h(EmptyState, {
          glyph: '🛣️',
          message: t('common.noDrives', 'No drives recorded yet'),
        }),
  );
}

// ─── 12. RecentChargesSection ─────────────────────────────────
interface RecentChargesSectionProps {
  sessions: ChargingSession[] | undefined;
}

export function RecentChargesSection({
  sessions,
}: RecentChargesSectionProps): ReactElement {
  const {t} = useTranslation();
  const {fmtNumber} = useUnits();
  const {formatCurrency} = useFormatting();

  const chargeColumns: Column<ChargingSession>[] = [
    {
      key: 'date',
      header: t('common.date', 'Date'),
      render: s => formatDateTime(s.start_ts),
    },
    {
      key: 'energy',
      header: t('common.energy', 'Energy'),
      render: s =>
        `${fmtNumber(convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh'))} kWh`,
      sortable: true,
    },
    {
      key: 'duration',
      header: t('common.duration', 'Duration'),
      render: s => durationStr(s.duration_min),
    },
    {
      key: 'cost',
      header: t('common.cost', 'Cost'),
      render: s => (s.cost != null ? formatCurrency(s.cost) : EMPTY_DISPLAY),
    },
    {
      key: 'battery',
      header: t('common.battery', 'Battery'),
      render: s =>
        s.end_soc_pct != null
          ? `${s.start_soc_pct}% → ${s.end_soc_pct}%`
          : `${s.start_soc_pct}%`,
    },
  ];

  const viewAll = h(
    NavLink,
    {style: styles.viewAll},
    h(AppText, {style: styles.viewAllText, tone: 'muted'}, t('common.viewAll', 'View all')),
    h(Glyph, {glyph: '›', style: styles.viewAllGlyph}),
  );

  return h(
    GPanel,
    {style: styles.panel},
    h(SectionHeading, {
      glyph: '🔌',
      glyphColor: colors.success,
      title: t('common.recentCharges', 'Recent Charges'),
      right: viewAll,
    }),
    sessions && sessions.length > 0
      ? h(ChargesTable, {
          tableId: 'vehicles:detail-recent-charges',
          columns: chargeColumns,
          data: sessions,
          keyExtractor: (s: ChargingSession) => s.id,
          compact: true,
          pagination: true,
          emptyMessage: t('common.noCharges', 'No charging sessions recorded yet'),
        })
      : h(EmptyState, {
          glyph: '🔌',
          message: t('common.noCharges', 'No charging sessions recorded yet'),
        }),
  );
}

// ─── 13. VehicleConfigSection ─────────────────────────────────
interface VehicleConfigSectionProps {
  vehicleConfig: VehicleConfigSnapshot | null | undefined;
  softwareVersion: string | undefined;
}

export function VehicleConfigSection({
  vehicleConfig,
  softwareVersion,
}: VehicleConfigSectionProps): ReactElement {
  const {t} = useTranslation();

  const yesNo = (v: boolean | null | undefined): string =>
    v != null ? (v ? t('common.yes', 'Yes') : t('common.no', 'No')) : EMPTY_DISPLAY;

  const configItems: KVItem[] = vehicleConfig
    ? [
        {label: t('vehicles.detail.carType', 'Car Type'), value: vehicleConfig.car_type ?? EMPTY_DISPLAY},
        {label: t('vehicles.detail.trim', 'Trim'), value: vehicleConfig.trim ?? EMPTY_DISPLAY},
        {label: t('vehicles.detail.color', 'Exterior Color'), value: vehicleConfig.exterior_color ?? EMPTY_DISPLAY},
        {label: t('vehicles.detail.wheels', 'Wheels'), value: vehicleConfig.wheel_type ?? EMPTY_DISPLAY},
        {label: t('vehicles.detail.roofColor', 'Roof Color'), value: vehicleConfig.roof_color ?? EMPTY_DISPLAY},
        {label: t('vehicles.detail.chargePort', 'Charge Port'), value: vehicleConfig.charge_port ?? EMPTY_DISPLAY},
        {label: t('vehicles.detail.rhd', 'Right-Hand Drive'), value: yesNo(vehicleConfig.right_hand_drive)},
        {label: t('vehicles.detail.europeVehicle', 'Europe Vehicle'), value: yesNo(vehicleConfig.europe_vehicle)},
        {label: t('vehicles.detail.offroadLightbar', 'Offroad Lightbar'), value: yesNo(vehicleConfig.offroad_lightbar_present)},
        {label: t('vehicles.detail.rearSeatHeaters', 'Rear Seat Heaters'), value: vehicleConfig.rear_seat_heaters ?? EMPTY_DISPLAY},
        {label: t('vehicles.detail.sunroofInstalled', 'Sunroof'), value: vehicleConfig.sunroof_installed ?? EMPTY_DISPLAY},
        {
          label: t('vehicles.detail.softwareVersion', 'Software'),
          value: vehicleConfig.software_update_version ?? softwareVersion ?? EMPTY_DISPLAY,
        },
      ]
    : [];

  return h(
    GPanel,
    {style: styles.panel},
    h(SectionHeading, {
      glyph: '⚙️',
      title: t('vehicles.detail.vehicleConfig', 'Vehicle Configuration'),
    }),
    configItems.length > 0
      ? h(KVList, {items: configItems, columns: 2})
      : h(Skeleton, {lines: 4, height: 16}),
  );
}

// ─── 14. QuickLinksSection ────────────────────────────────────
interface QuickLink {
  label: string;
  glyph: string;
  to: string;
}

export function QuickLinksSection(): ReactElement {
  const {t} = useTranslation();

  const quickLinks: QuickLink[] = [
    {label: t('nav.drives', 'Drives'), glyph: '🛣️', to: '/drives'},
    {label: t('nav.charging', 'Charging'), glyph: '🔌', to: '/charging'},
    {label: t('nav.battery', 'Battery'), glyph: '🔋', to: '/battery'},
    {label: t('nav.climate', 'Climate'), glyph: '🌡️', to: '/climate'},
    {label: t('nav.efficiency', 'Efficiency'), glyph: '📊', to: '/efficiency'},
    {label: t('nav.settings', 'Settings'), glyph: '⚙️', to: '/settings'},
  ];

  return h(
    GPanel,
    {style: styles.panel},
    h(SectionHeading, {
      glyph: '›',
      title: t('vehicles.detail.quickLinks', 'Quick Links'),
    }),
    h(
      View,
      {style: styles.quickGrid},
      quickLinks.map(link =>
        h(
          NavLink,
          {key: link.to, style: styles.quickCard},
          h(Glyph, {glyph: link.glyph, style: styles.quickGlyph}),
          h(AppText, {style: styles.quickLabel}, link.label),
        ),
      ),
    ),
  );
}

// Documents which web capabilities are unavailable / simplified in this port.
export const nativeVehicleDetailCapabilities = {
  rechartsAvailable: false,
  domRouterNavigationAvailable: false,
  animatedNumberCountUpAvailable: false,
  selfContainedBarrel: true,
} as const;

const styles = StyleSheet.create({
  panel: {
    padding: 24, // p-6
  },
  // Section heading
  heading: {
    marginBottom: 16, // mb-4
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headingLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
  },
  headingGlyph: {
    color: colors.accent, // text-[var(--neon-cyan)]
    fontSize: 14,
  },
  headingText: {
    color: colors.textPrimary,
    fontSize: 18, // text-lg
    fontWeight: '700', // font-bold
  },
  glyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  // VehicleHeader
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16, // gap-4
  },
  backLink: {
    borderRadius: 12,
    padding: 10, // p-2.5
  },
  backGlyph: {
    color: colors.textMuted,
    fontSize: 20,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
  },
  headerBadges: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12, // gap-3
  },
  vin: {
    fontFamily: 'monospace',
    fontSize: 13,
    marginTop: 4,
  },
  wakeButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  wakeGlyph: {
    color: colors.background,
    fontSize: 14,
  },
  wakeLabel: {
    color: colors.background,
    fontWeight: '600',
  },
  // Battery / metric layout
  batteryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24, // gap-6
  },
  metricGrid: {
    flexDirection: 'row',
    flexGrow: 1,
    flexShrink: 1,
    flexWrap: 'wrap',
    gap: 12, // gap-3
  },
  metricCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)', // bg-white/[0.02]
    borderColor: 'rgba(255, 255, 255, 0.04)', // border-white/[0.04]
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 140,
    padding: 12, // p-3
  },
  metricLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4, // mb-1
  },
  metricDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  metricLabel: {
    flexShrink: 1,
    fontSize: 10, // text-[10px]
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20, // text-xl
    fontWeight: '700', // font-bold
  },
  metricSubtitle: {
    fontSize: 10,
    marginTop: 2, // mt-0.5
  },
  // Badges
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8, // gap-2
  },
  // Empty / skeleton
  emptyState: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 28,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  skeleton: {
    gap: 8,
    paddingVertical: 4,
  },
  skeletonBar: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 6,
  },
  // Tire tiles
  tireTile: {
    alignItems: 'center',
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 140,
    padding: 16,
  },
  tireLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  tireValue: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  tireBadge: {
    marginTop: 8,
  },
  // KVList
  kvList: {
    width: '100%',
  },
  kvListTwoCol: {
    columnGap: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  kvRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  kvRowTwoCol: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexBasis: '45%',
    flexDirection: 'row',
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  kvLabel: {
    fontSize: 14,
  },
  kvValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
  },
  // View-all link
  viewAll: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  viewAllText: {
    fontSize: 12,
  },
  viewAllGlyph: {
    color: colors.textMuted,
    fontSize: 12,
  },
  // Charts
  chartsWrap: {
    gap: 24, // gap-6 (web lg:grid-cols-2 stacks on native)
  },
  chartTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  chartStatsCol: {
    flex: 1,
    gap: 8,
  },
  chartStatCard: {
    padding: 12, // p-3
  },
  chartStatLabel: {
    fontSize: 12,
  },
  chartStatValue: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  composition: {
    gap: 10,
  },
  compRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  compLabel: {
    fontSize: 12,
    width: 72,
  },
  compTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 6,
    flex: 1,
    height: 10,
    overflow: 'hidden',
  },
  compFill: {
    borderRadius: 6,
    height: 10,
  },
  compValue: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    width: 40,
  },
  trendWrap: {
    gap: 8,
  },
  trendLegend: {
    fontSize: 11,
  },
  trendRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 6,
  },
  trendColumn: {
    alignItems: 'center',
    flexGrow: 1,
    flexShrink: 1,
    gap: 4,
    minWidth: 28,
  },
  trendValue: {
    fontSize: 9,
  },
  trendBarTrack: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    height: TREND_MAX_HEIGHT,
  },
  trendBar: {
    backgroundColor: colors.accent,
    borderRadius: 3,
    width: 14,
  },
  trendDate: {
    fontSize: 9,
  },
  // Quick links
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickCard: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: '30%',
    flexGrow: 1,
    gap: 8,
    minWidth: 92,
    padding: 16,
  },
  quickGlyph: {
    color: colors.textMuted,
    fontSize: 20,
  },
  quickLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
});
