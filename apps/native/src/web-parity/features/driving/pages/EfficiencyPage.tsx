/**
 * Native parity port of web/src/features/driving/pages/EfficiencyPage.tsx.
 *
 * The web page is the per-vehicle "Efficiency" analytics surface: a header
 * (VehicleSelect + RangePicker + SavedViewMenu), a hero GlassPanel with a
 * RadialGauge + three AnimatedNumber stats, four StatCards, a daily-efficiency
 * AreaChart + an efficiency-by-speed BarChart (with per-bar Cell colours), two
 * scatter plots (speed-vs-eff / temp-vs-eff), a temperature-bucketed DataTable,
 * a MetricBar efficiency summary, and an energy-insights grid. It reads the
 * canonical `useDrivingStats` / `useDrives` TanStack Query hooks (`/drives/stats`
 * + `/drives`), converts the backend's SI figures to the user's display unit at
 * the render boundary, and derives every chart series from the date-filtered
 * drive list.
 *
 * This native port preserves that contract 1:1 — the same two queries + exact
 * API paths (via the already-ported native useDriving hooks), the verbatim
 * `efficiencyColor` / `getEfficiency` helpers, the verbatim
 * `toDistanceDisplay` / `toSpeedDisplay` / `toTemperatureDisplay` /
 * `toEfficiencyDisplay` closures (including the source's exact — and quirky —
 * `toDistanceDisplay(stats.totalDistanceKm)` / double-converted bucket-table
 * expressions, reproduced faithfully rather than "fixed"), all six derived
 * memos (`filteredDrives` / `dailyTrend` / `speedVsEff` / `tempVsEff` /
 * `speedDist` / `tempBuckets`), the `costPerKm` / `kmPerKwh` metrics, and every
 * section + empty state — using React Native primitives, the existing native
 * AppText / GlassPanel + design tokens, the already-ported web-parity
 * RadialGauge + native-safe charts barrel, and locally-reproduced native-safe
 * shims for the remaining web-only dependencies.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2): no native i18next runtime, so an
 *     inline native-safe `t(key, fallback?)` shim returns the English fallback
 *     (else the key), preserving every i18n key + intent verbatim. The
 *     `{ unit, defaultValue }` interpolation form used by `efficiency.dailyTrend`
 *     is supported.
 *   - lucide-react `Zap`/`TrendingUp`/`Thermometer`/`Fuel`/`Gauge` (web L3): DOM
 *     SVG icons → semantic emoji glyph constants (the DrivingPerformanceCards
 *     icon→glyph precedent).
 *   - `@/components/layout` PageContainer (web L4): reproduced locally as a
 *     native-safe ScrollView scaffold (title / subtitle / error / actions /
 *     children — the props this page uses).
 *   - `@/components/ui` GlassPanel/DataTable (web L5-6): native GlassPanel is the
 *     existing port; DataTable + `Column<T>` reproduced locally as a native-safe
 *     table (header / rows / align / compact / pagination — the props this page
 *     passes; the web table's localStorage sort/resize/visibility is reduced).
 *   - `@/components/data-display` MetricBar/SavedViewMenu/AnimatedNumber
 *     (web L7-8/16): MetricBar reproduced as a native track+fill bar (the
 *     framer-motion width tween is static); AnimatedNumber renders the final
 *     formatted value (the requestAnimationFrame count-up is reduced to a static
 *     value — visual-only); SavedViewMenu reproduced as a native-safe chip
 *     (localStorage/router-backed saved views are reduced to a clear-filter
 *     action via the same `onApply` contract).
 *   - `@/components/charts` ChartContainer/ChartTooltip/renderAnnotationLines/
 *     AREA_DEFAULTS/areaGradient/AreaChart/Area/BarChart/Bar/ScatterChart/
 *     Scatter/XAxis/YAxis/CartesianGrid/Tooltip/ResponsiveContainer/Cell +
 *     RadialGauge (web L9-15): imported from the native-safe web-parity charts
 *     barrel. Recharts has no React Native SVG backend, so the chart primitives
 *     render explicit "native chart unavailable" placeholders; the JSX
 *     structure, data wiring, axis/series props, annotation flow, and per-bar
 *     Cell colours are preserved 1:1.
 *   - `@/components/forms` RangePicker/VehicleSelect (web L17): VehicleSelect →
 *     a native Pressable chip selector wired to the shared selected-vehicle
 *     state; RangePicker → a native-safe display chip showing the active
 *     start–end range (the web calendar popover has no native equivalent here,
 *     so the trigger is display-only; the `onChange`/`setRangeBatch` write path
 *     is retained for completeness).
 *   - `@/components/motion` FadeIn/StaggerContainer/StaggerItem (web L18-20):
 *     framer-motion entrances → static passthrough Views (the Layout precedent);
 *     the `delay` prop is accepted but inert.
 *   - `@/components/feedback` EmptyState (web L21): native-safe local equivalent
 *     (icon? / title? / message).
 *   - `@/api/hooks/useDriving` useDrivingStats/useDrives + `Drive` (web L22):
 *     imported from the already-ported native hooks (same `/drives/stats` +
 *     `/drives?vehicle_id=` paths + response shapes).
 *   - `@/hooks/useSettings` (web L23): native-safe `isFahrenheit` derivation
 *     from `useSettings().unit_of_temp === 'F'`.
 *   - `@/hooks/useUnits` (web L24): native-safe `useUnits` deriving
 *     `unitPrefs.{distance,speed,temperature}` from settings + exposing
 *     `formatDuration` / `formatEnergy` that delegate to the ported SI
 *     formatters (energy → kWh, duration → h, the web defaults).
 *   - `@/hooks/usePageTitle` (web L25): `document.title` is browser-only → a
 *     documented no-op (the native navigator owns the title).
 *   - `@/hooks/useSelectedVehicle` (web L26): the web hook layers react-router
 *     params over a zustand store; native derives the selection from the ported
 *     `useVehicles()` list via a shared external store → first vehicle.
 *   - `@/hooks/useSavedViewUrl` (web L27): native-safe `{ currentQuery, apply }`
 *     over the in-memory URL-state store (no react-router location).
 *   - `@/hooks/useUrlState` useUrlBatch/useUrlString (web L28): native-safe
 *     in-memory query-param store (no react-router searchParams); the
 *     read/write contract this page uses (`from`/`to` strings + batch writes) is
 *     preserved.
 *   - `@/lib/dateFormat` formatDateShort (web L29), `@/lib/numberFormat`
 *     fmtNumber/fmtInt (web L30), `@/lib/unitConversion`
 *     convertDistanceFromSI/convertSpeedFromSI/convertTempFromSI (web L32):
 *     ported verbatim into native-safe helpers (NIST factors preserved).
 *   - `@/types/driving` `Drive` (web L31): the native useDriving `Drive` type
 *     (same field names this page reads: startBatteryPct/endBatteryPct/
 *     distanceM/startTs/avgSpeedMps/outsideTempAvgC).
 */
import React, {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
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

import {
  useDrives,
  useDrivingStats,
  type Drive,
} from '../../../api/hooks/useDriving';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {
  AREA_DEFAULTS,
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ChartContainer,
  ChartTooltip,
  RadialGauge,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  areaGradient,
  renderAnnotationLines,
} from '../../../components/charts';
import type {DataAnnotation} from '../../../api/hooks/useAnnotations';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

/** Native-safe port of web/src/components/ui DataTable `Column<T>`. */
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
}

type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '\u00B0C' | '\u00B0F';

interface UnitPrefs {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
}

interface FormatOptions {
  precision?: number;
}

type UnitFormatter = (
  value: number | null | undefined,
  options?: FormatOptions,
) => string;

interface UseUnitsResult {
  unitPrefs: UnitPrefs;
  formatDuration: UnitFormatter;
  formatEnergy: UnitFormatter;
}

/* ------------------------------------------------------------------ */
/*  lucide-react icon stand-ins (web L3)                              */
/* ------------------------------------------------------------------ */

const ICON_ZAP = '\u26A1'; // ⚡ (Zap)
const ICON_TRENDING_UP = '\uD83D\uDCC8'; // 📈 (TrendingUp)
const ICON_THERMOMETER = '\uD83C\uDF21'; // 🌡 (Thermometer)
const ICON_FUEL = '\u26FD'; // ⛽ (Fuel)
const ICON_GAUGE = '\u23F1'; // ⏱ (Gauge)

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)    */
/* ------------------------------------------------------------------ */

interface TInterpolation {
  unit?: string;
  defaultValue?: string;
}

type NativeTFunction = (
  key: string,
  fallbackOrOptions?: string | TInterpolation,
) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallbackOrOptions) => {
      if (typeof fallbackOrOptions === 'string') {
        return fallbackOrOptions;
      }
      if (fallbackOrOptions && typeof fallbackOrOptions === 'object') {
        const {unit, defaultValue} = fallbackOrOptions;
        const base = defaultValue ?? key;
        return unit != null ? base.replace('{{unit}}', unit) : base;
      }
      return key;
    },
    [],
  );
}

/* ------------------------------------------------------------------ */
/*  native-safe usePageTitle (web document.title is browser-only)     */
/* ------------------------------------------------------------------ */

function usePageTitle(_title: string): void {
  // The web hook writes document.title; on native the navigator owns the
  // header title, so the resolved title is intentionally not applied.
}

/* ------------------------------------------------------------------ */
/*  ported lib helpers (web L29/L30/L32)                              */
/* ------------------------------------------------------------------ */

/** 1 mile = 1609.344 m exactly (web/src/lib/unitConversion.ts). */
const METERS_PER_MILE = 1609.344;
/** 1 km = 1000 m exactly. */
const METERS_PER_KM = 1000;
/** Seconds in an hour. */
const SECONDS_PER_HOUR = 3600;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** convertDistanceFromSI — SI meters → display unit (web L32). */
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

/** convertSpeedFromSI — SI m/s → display unit (web L32). */
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  return to === 'mph'
    ? (mps * SECONDS_PER_HOUR) / METERS_PER_MILE
    : (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
}

/** convertTempFromSI — SI °C → display unit (web L32). */
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  return to === '\u00B0F' ? (celsius * 9) / 5 + 32 : celsius;
}

/** fmtNumber — locale-aware, default precision 2 (web/src/lib/numberFormat.ts). */
function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  const d = decimals;
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toFixed(d);
  }
}

/** fmtInt — integer with locale separators (web L30). */
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/** formatDateShort — "Apr 4" else "—" (web/src/lib/dateFormat.ts). */
function formatDateShort(iso: string | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  try {
    return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  } catch {
    return '\u2014';
  }
}

/* ----- SI energy/duration formatters (web/src/lib/unitConversion.ts) ----- */

const DEFAULT_EMPTY_DISPLAY = '\u2014';

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function formatNumber(
  value: number,
  locale: string | undefined,
  fractionDigits: number,
): string {
  try {
    return value.toLocaleString(locale ?? 'en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  } catch {
    return value.toFixed(fractionDigits);
  }
}

function resolvePrecision(
  prefPrecision: number | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= 0
  ) {
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

/** formatEnergy — SI watt-hours → kWh display (web default energy pref). */
function formatEnergySI(
  wh: number | null | undefined,
  locale: string | undefined,
  prefPrecision: number | undefined,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(wh)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const digits = resolvePrecision(prefPrecision, options?.precision, 2);
  return `${formatNumber(wh / 1000, locale, digits)} kWh`;
}

/** formatDuration — SI seconds → hours display (web default duration pref). */
function formatDurationSI(
  seconds: number | null | undefined,
  locale: string | undefined,
  prefPrecision: number | undefined,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(seconds)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const digits = resolvePrecision(prefPrecision, options?.precision, 0);
  return `${formatNumber(seconds / SECONDS_PER_HOUR, locale, digits)} h`;
}

/* ------------------------------------------------------------------ */
/*  native-safe useUnits + isFahrenheit (web L23/L24)                 */
/* ------------------------------------------------------------------ */

function deriveLocale(locale: string | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return 'en-US';
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

function useUnits(): UseUnitsResult {
  const {data: settings} = useSettings();
  const unitOfLength = settings?.unit_of_length;
  const unitOfTemp = settings?.unit_of_temp;
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);

  return useMemo<UseUnitsResult>(() => {
    const distance: DistanceUnitPref = unitOfLength === 'mi' ? 'mi' : 'km';
    const speed: SpeedUnitPref = unitOfLength === 'mi' ? 'mph' : 'km/h';
    const temperature: TemperatureUnitPref =
      unitOfTemp === 'F' ? '\u00B0F' : '\u00B0C';
    return {
      unitPrefs: {distance, speed, temperature},
      formatDuration: (value, options) =>
        formatDurationSI(value, locale, precision, options),
      formatEnergy: (value, options) =>
        formatEnergySI(value, locale, precision, options),
    };
  }, [unitOfLength, unitOfTemp, locale, precision]);
}

function useIsFahrenheit(): boolean {
  const {data: settings} = useSettings();
  return settings?.unit_of_temp === 'F';
}

/* ------------------------------------------------------------------ */
/*  native-safe useSelectedVehicle (web L26)                          */
/* ------------------------------------------------------------------ */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

let selectedVehicleOverride: number | null = null;
const selectedVehicleListeners = new Set<() => void>();

function getSelectedVehicleOverride(): number | null {
  return selectedVehicleOverride;
}

function subscribeSelectedVehicle(listener: () => void): () => void {
  selectedVehicleListeners.add(listener);
  return () => {
    selectedVehicleListeners.delete(listener);
  };
}

function setSelectedVehicleOverride(id: number | null): void {
  if (selectedVehicleOverride === id) {
    return;
  }
  selectedVehicleOverride = id;
  selectedVehicleListeners.forEach(listener => listener());
}

/**
 * The web hook layers react-router path/query params over a persisted zustand
 * store, then falls back to the first vehicle. Native has no router, so the
 * precedence collapses to: shared override store → first vehicle.
 */
function useSelectedVehicle(): SelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const override = useSyncExternalStore(
    subscribeSelectedVehicle,
    getSelectedVehicleOverride,
    getSelectedVehicleOverride,
  );
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  const vehicleId = override ?? firstVehicleId;
  const setVehicleId = useCallback(
    (id: number | null) => setSelectedVehicleOverride(id),
    [],
  );
  return {vehicleId, vehicles, setVehicleId};
}

/* ------------------------------------------------------------------ */
/*  native-safe URL state store (web L27/L28)                         */
/* ------------------------------------------------------------------ */

// In-memory replacement for react-router's searchParams. The web page mirrors
// the date range into the URL (`from`/`to`) so it can be shared/restored;
// native has no URL, so a tiny module store backs useUrlString / useUrlBatch /
// useSavedViewUrl with the same read/write semantics this page relies on.
const urlStateStore = new Map<string, string>();
const urlStateListeners = new Set<() => void>();
let urlStateQuerySnapshot = '';

function recomputeQuerySnapshot(): void {
  const pairs: string[] = [];
  for (const [key, value] of urlStateStore) {
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  urlStateQuerySnapshot = pairs.join('&');
}

function getUrlParam(key: string): string | undefined {
  return urlStateStore.get(key);
}

function getUrlQuerySnapshot(): string {
  return urlStateQuerySnapshot;
}

function subscribeUrlState(listener: () => void): () => void {
  urlStateListeners.add(listener);
  return () => {
    urlStateListeners.delete(listener);
  };
}

function notifyUrlState(): void {
  recomputeQuerySnapshot();
  urlStateListeners.forEach(listener => listener());
}

function setUrlParams(updates: Record<string, string | null | undefined>): void {
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    if (value == null || value === '') {
      if (urlStateStore.delete(key)) {
        changed = true;
      }
    } else if (urlStateStore.get(key) !== value) {
      urlStateStore.set(key, value);
      changed = true;
    }
  }
  if (changed) {
    notifyUrlState();
  }
}

function replaceUrlParams(query: string): void {
  urlStateStore.clear();
  const trimmed = query.startsWith('?') ? query.slice(1) : query;
  if (trimmed.length > 0) {
    for (const pair of trimmed.split('&')) {
      const [rawKey, rawValue = ''] = pair.split('=');
      if (rawKey) {
        urlStateStore.set(
          decodeURIComponent(rawKey),
          decodeURIComponent(rawValue),
        );
      }
    }
  }
  notifyUrlState();
}

function useUrlString(
  key: string,
  defaultValue = '',
): [string, (value: string) => void] {
  const raw = useSyncExternalStore(
    subscribeUrlState,
    () => getUrlParam(key),
    () => getUrlParam(key),
  );
  const value = raw ?? defaultValue;
  const set = useCallback(
    (next: string) => setUrlParams({[key]: next}),
    [key],
  );
  return [value, set];
}

function useUrlBatch(): (
  updates: Record<string, string | null | undefined>,
) => void {
  return useCallback(updates => setUrlParams(updates), []);
}

function useSavedViewUrl(): {currentQuery: string; apply: (query: string) => void} {
  const currentQuery = useSyncExternalStore(
    subscribeUrlState,
    getUrlQuerySnapshot,
    getUrlQuerySnapshot,
  );
  const apply = useCallback((query: string) => replaceUrlParams(query), []);
  return {currentQuery, apply};
}

/* ------------------------------------------------------------------ */
/*  Page helpers (web L38-50)                                         */
/* ------------------------------------------------------------------ */

function efficiencyColor(wh: number): string {
  if (wh < 140) {
    return '#39ff14';
  }
  if (wh < 170) {
    return '#10b981';
  }
  if (wh < 200) {
    return '#00f0ff';
  }
  if (wh < 240) {
    return '#f59e0b';
  }
  return '#ef4444';
}

function getEfficiency(drive: Drive): number | null {
  const battUsed = (drive.startBatteryPct ?? 0) - (drive.endBatteryPct ?? 0);
  if (drive.distanceM > 0 && battUsed > 0) {
    return (battUsed * 0.75 * 1000) / (drive.distanceM / 1000);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  native motion shims (web @/components/motion)                     */
/* ------------------------------------------------------------------ */

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View>{children}</View>;
}

function StaggerContainer({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

function StaggerItem({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)          */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  message: string;
  testID?: string;
}

function EmptyState({icon, title, message, testID}: EmptyStateProps) {
  return (
    <View style={styles.emptyState} testID={testID}>
      {icon ? <View style={styles.emptyStateIcon}>{icon}</View> : null}
      {title ? (
        <AppText style={styles.emptyStateTitle} weight="semibold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.emptyStateMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native MetricBar (web @/components/data-display MetricBar)        */
/* ------------------------------------------------------------------ */

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
        <View
          style={[styles.metricBarFill, {backgroundColor: color, width}]}
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native AnimatedNumber (web @/components/data-display)             */
/* ------------------------------------------------------------------ */

// The web component count-ups from 0 → value via requestAnimationFrame. Native
// renders the final formatted value directly (the animation is visual-only and
// reduced to a static value); prefix/suffix/decimals are preserved.
function AnimatedNumber({
  value,
  decimals = 0,
  prefix,
  suffix,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}): ReactElement {
  return (
    <>
      {prefix}
      {fmtNumber(value, decimals)}
      {suffix}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  native VehicleSelect (web @/components/forms VehicleSelect)       */
/* ------------------------------------------------------------------ */

function VehicleSelect() {
  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();

  if (vehicles.length === 0) {
    return null;
  }

  return (
    <View style={styles.vehicleSelect} testID="vehicle-select">
      {vehicles.map(v => {
        const active = v.id === vehicleId;
        const label = v.display_name || v.vin || `Vehicle ${v.id}`;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            hitSlop={4}
            key={v.id}
            onPress={() => setVehicleId(v.id)}
            style={[styles.vehicleChip, active && styles.vehicleChipActive]}>
            <AppText
              numberOfLines={1}
              style={[
                styles.vehicleChipText,
                active && styles.vehicleChipTextActive,
              ]}
              variant="caption">
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native RangePicker (web @/components/forms RangePicker)           */
/* ------------------------------------------------------------------ */

interface RangeValue {
  start: string;
  end: string;
}

function RangePicker({
  value,
  onChange,
  triggerTestId,
}: {
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  align?: 'start' | 'end';
  triggerTestId?: string;
}) {
  // The web calendar popover has no native equivalent here; the trigger is a
  // display-only chip showing the active range. `onChange` is retained so the
  // write path stays wired even though the native trigger does not open a
  // picker.
  void onChange;
  const label = `${formatDateShort(value.start)} \u2013 ${formatDateShort(
    value.end,
  )}`;
  return (
    <Pressable
      accessibilityRole="button"
      style={styles.rangePicker}
      testID={triggerTestId}>
      <AppText style={styles.rangePickerText} tone="secondary" variant="caption">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native SavedViewMenu (web @/components/data-display SavedViewMenu)*/
/* ------------------------------------------------------------------ */

function SavedViewMenu({
  currentQuery,
  onApply,
}: {
  route: string;
  currentQuery: string;
  onApply: (query: string) => void;
}) {
  // localStorage/router-backed saved views are reduced to a clear-filter
  // action via the same onApply contract: the chip clears the active query.
  const hasQuery = currentQuery.length > 0;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!hasQuery}
      hitSlop={4}
      onPress={() => onApply('')}
      style={[styles.savedViewChip, !hasQuery && styles.savedViewChipDisabled]}
      testID="saved-view-menu">
      <AppText style={styles.savedViewText} tone="secondary" variant="caption">
        {hasQuery ? 'Clear view' : 'Saved views'}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native PageContainer (web @/components/layout PageContainer)      */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  error?: Error | null;
  actions?: ReactNode;
  children: ReactNode;
  testID?: string;
}

function PageContainer({
  title,
  subtitle,
  error,
  actions,
  children,
  testID,
}: PageContainerProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID={testID ?? 'efficiency-page'}>
      <View style={styles.scaffoldHeader}>
        <View style={styles.scaffoldHeaderText}>
          <AppText style={styles.scaffoldTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.scaffoldSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.scaffoldActions}>{actions}</View> : null}
      </View>

      {error ? (
        <View style={styles.errorBox} testID="efficiency-error">
          <AppText style={styles.errorText} variant="caption">
            {error.message}
          </AppText>
        </View>
      ) : (
        <View style={styles.scaffoldBody}>{children}</View>
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  native DataTable (web @/components/ui DataTable)                  */
/* ------------------------------------------------------------------ */

interface DataTableProps<T> {
  tableId?: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  emptyMessage?: string;
  compact?: boolean;
  pagination?: boolean;
}

const PAGE_SIZE = 10;

function toComparable(node: ReactNode): number | string {
  const s = node == null ? '' : String(node);
  const stripped = s.replace(/[^0-9.\-]/g, '');
  const num = Number(stripped);
  if (stripped !== '' && Number.isFinite(num) && /[0-9]/.test(s)) {
    return num;
  }
  return s.toLowerCase();
}

function alignStyle(align: Column<unknown>['align']): ViewStyle {
  if (align === 'right') {
    return {textAlign: 'right'} as ViewStyle;
  }
  if (align === 'center') {
    return {textAlign: 'center'} as ViewStyle;
  }
  return {textAlign: 'left'} as ViewStyle;
}

function DataTable<T>({
  tableId,
  columns,
  data,
  keyExtractor,
  emptyMessage = 'No data',
  compact,
  pagination,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) {
      return data;
    }
    const col = columns.find(c => c.key === sortKey);
    if (!col) {
      return data;
    }
    const rows = [...data];
    rows.sort((a, b) => {
      const av = toComparable(col.render(a));
      const bv = toComparable(col.render(b));
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data, columns, sortKey, sortDir]);

  const pageCount = pagination
    ? Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
    : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = pagination
    ? sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
    : sorted;

  const onSort = useCallback(
    (key: string, sortable?: boolean) => {
      if (!sortable) {
        return;
      }
      if (sortKey === key) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('asc');
      }
      setPage(0);
    },
    [sortKey],
  );

  if (data.length === 0) {
    return (
      <View testID={tableId ? `${tableId}-empty` : 'datatable-empty'}>
        <EmptyState message={emptyMessage} />
      </View>
    );
  }

  return (
    <View testID={tableId ?? 'datatable'}>
      <View style={[styles.tableRow, styles.tableHeaderRow]}>
        {columns.map(col => {
          const isSorted = sortKey === col.key;
          const indicator = isSorted ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
          return (
            <Pressable
              accessibilityRole={col.sortable ? 'button' : 'text'}
              disabled={!col.sortable}
              key={col.key}
              onPress={() => onSort(col.key, col.sortable)}
              style={styles.tableCell}>
              <AppText
                numberOfLines={1}
                style={[styles.tableHeaderText, alignStyle(col.align)]}
                tone="muted"
                variant="caption"
                weight="semibold">
                {col.header}
                {indicator}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {visible.map(row => (
        <View
          key={String(keyExtractor(row))}
          style={[styles.tableRow, compact && styles.tableRowCompact]}>
          {columns.map(col => (
            <View key={col.key} style={styles.tableCell}>
              <AppText
                numberOfLines={1}
                style={[styles.tableCellText, alignStyle(col.align)]}
                variant="caption">
                {col.render(row)}
              </AppText>
            </View>
          ))}
        </View>
      ))}

      {pagination && pageCount > 1 ? (
        <View style={styles.pagination}>
          <Pressable
            accessibilityRole="button"
            disabled={safePage === 0}
            hitSlop={6}
            onPress={() => setPage(p => Math.max(0, p - 1))}
            style={[styles.pageButton, safePage === 0 && styles.pageButtonDisabled]}>
            <AppText style={styles.pageButtonText} variant="caption">
              {'\u2039'}
            </AppText>
          </Pressable>
          <AppText style={styles.pageLabel} tone="muted" variant="caption">
            {`${safePage + 1} / ${pageCount}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            disabled={safePage >= pageCount - 1}
            hitSlop={6}
            onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            style={[
              styles.pageButton,
              safePage >= pageCount - 1 && styles.pageButtonDisabled,
            ]}>
            <AppText style={styles.pageButtonText} variant="caption">
              {'\u203A'}
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  EfficiencyPage                                                    */
/* ------------------------------------------------------------------ */

interface TempBucketRow {
  range: string;
  count: number;
  avgEff: number;
  totalDist: number;
  avgSpeed: number;
}

export default function EfficiencyPage() {
  const t = useNativeTranslation();
  usePageTitle(t('efficiency.title', 'Efficiency'));
  const savedView = useSavedViewUrl();

  // The header VehiclePicker is the source of truth.
  const {vehicleId} = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const {data: stats} = useDrivingStats(vehicleIdStr);
  const {data: drives} = useDrives(vehicleIdStr);

  const isFahrenheit = useIsFahrenheit();
  const {unitPrefs, formatDuration, formatEnergy} = useUnits();
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toSpeedDisplay = useCallback(
    (value: number) => convertSpeedFromSI(value, unitPrefs.speed),
    [unitPrefs.speed],
  );
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) =>
      unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm,
    [unitPrefs.distance],
  );

  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(
    () => new Date().toISOString().split('T')[0],
    [],
  );
  const [startDate] = useUrlString('from', defaultStartDate);
  const [endDate] = useUrlString('to', defaultEndDate);
  const setRangeBatch = useUrlBatch();

  /* ---- Filtered drives ---- */
  const filteredDrives = useMemo(() => {
    if (!drives) {
      return [];
    }
    return drives.filter(d => {
      const driveDate = d.startTs?.split('T')[0];
      if (!driveDate) {
        return true;
      }
      if (startDate && driveDate < startDate) {
        return false;
      }
      if (endDate && driveDate > endDate) {
        return false;
      }
      return true;
    });
  }, [drives, startDate, endDate]);

  /* ---- Daily efficiency trend ---- */
  const dailyTrend = useMemo(() => {
    return filteredDrives
      .filter(d => getEfficiency(d) !== null)
      .slice(0, 30)
      .reverse()
      .map(d => ({
        date: formatDateShort(d.startTs),
        efficiency: Math.round(toEfficiencyDisplay(getEfficiency(d)!)),
        distance: parseFloat(fmtNumber(toDistanceDisplay(d.distanceM ?? 0), 1)),
      }));
  }, [filteredDrives, toEfficiencyDisplay, toDistanceDisplay]);

  /* ---- Speed vs Efficiency scatter ---- */
  const speedVsEff = useMemo(() => {
    return filteredDrives
      .filter(d => d.avgSpeedMps && getEfficiency(d))
      .map(d => ({
        speed: Math.round(toSpeedDisplay(d.avgSpeedMps!)),
        efficiency: Math.round(toEfficiencyDisplay(getEfficiency(d)!)),
      }));
  }, [filteredDrives, toSpeedDisplay, toEfficiencyDisplay]);

  /* ---- Temp vs Efficiency scatter ---- */
  const tempVsEff = useMemo(() => {
    return filteredDrives
      .filter(d => d.outsideTempAvgC !== null && getEfficiency(d))
      .map(d => ({
        temp: Math.round(toTemperatureDisplay(d.outsideTempAvgC!)),
        efficiency: Math.round(toEfficiencyDisplay(getEfficiency(d)!)),
      }));
  }, [filteredDrives, toTemperatureDisplay, toEfficiencyDisplay]);

  /* ---- Speed distribution ---- */
  const speedDist = useMemo(() => {
    const buckets = [
      {range: `0\u201330`, min: 0, max: 30, count: 0, totalEff: 0},
      {range: `30\u201360`, min: 30, max: 60, count: 0, totalEff: 0},
      {range: `60\u201390`, min: 60, max: 90, count: 0, totalEff: 0},
      {range: `90\u2013120`, min: 90, max: 120, count: 0, totalEff: 0},
      {range: `120+`, min: 120, max: 999, count: 0, totalEff: 0},
    ];
    filteredDrives.forEach(d => {
      if (d.avgSpeedMps == null) {
        return;
      }
      const eff = getEfficiency(d);
      if (!eff) {
        return;
      }
      const displaySpeed = toSpeedDisplay(d.avgSpeedMps!);
      const b = buckets.find(
        bk => displaySpeed >= bk.min && displaySpeed < bk.max,
      );
      if (b) {
        b.count++;
        b.totalEff += eff;
      }
    });
    return buckets
      .filter(b => b.count > 0)
      .map(b => ({
        range: `${b.range} ${speedUnit}`,
        avgEff: Math.round(toEfficiencyDisplay(b.totalEff / b.count)),
        count: b.count,
      }));
  }, [filteredDrives, speedUnit, toEfficiencyDisplay, toSpeedDisplay]);

  /* ---- Temperature-bucketed efficiency ---- */
  const tempBuckets = useMemo<TempBucketRow[]>(() => {
    const ranges = isFahrenheit
      ? [
          {range: '< 32\u00B0F', min: -999, max: 0},
          {range: '32\u201350\u00B0F', min: 0, max: 10},
          {range: '50\u201368\u00B0F', min: 10, max: 20},
          {range: '68\u201386\u00B0F', min: 20, max: 30},
          {range: '> 86\u00B0F', min: 30, max: 999},
        ]
      : [
          {range: '< 0\u00B0C', min: -999, max: 0},
          {range: '0\u201310\u00B0C', min: 0, max: 10},
          {range: '10\u201320\u00B0C', min: 10, max: 20},
          {range: '20\u201330\u00B0C', min: 20, max: 30},
          {range: '> 30\u00B0C', min: 30, max: 999},
        ];
    const buckets = ranges.map(r => ({
      ...r,
      count: 0,
      totalEff: 0,
      totalDist: 0,
      totalSpeed: 0,
    }));
    filteredDrives.forEach(d => {
      if (d.outsideTempAvgC == null) {
        return;
      }
      const eff = getEfficiency(d);
      if (!eff) {
        return;
      }
      const b = buckets.find(
        bk => d.outsideTempAvgC! >= bk.min && d.outsideTempAvgC! < bk.max,
      );
      if (b) {
        b.count++;
        b.totalEff += eff;
        b.totalDist += toDistanceDisplay(d.distanceM);
        b.totalSpeed += toSpeedDisplay(d.avgSpeedMps ?? 0);
      }
    });
    return buckets
      .filter(b => b.count > 0)
      .map(b => ({
        range: b.range,
        count: b.count,
        avgEff: b.totalEff / b.count,
        totalDist: b.totalDist,
        avgSpeed: b.totalSpeed / b.count,
      }));
  }, [filteredDrives, isFahrenheit, toDistanceDisplay, toSpeedDisplay]);

  /* ---- Computed metrics ---- */
  const costPerKm =
    stats && stats.totalDistanceKm > 0
      ? fmtNumber((stats.avgEfficiencyWhKm / 1000) * 0.12, 3)
      : '\u2014';
  const kmPerKwh =
    stats && stats.avgEfficiencyWhKm > 0
      ? fmtNumber(1000 / stats.avgEfficiencyWhKm, 1)
      : '\u2014';

  return (
    <PageContainer
      title={t('efficiency.title', 'Efficiency')}
      subtitle={t(
        'efficiency.subtitle',
        'Energy consumption and driving efficiency analysis',
      )}
      error={null}
      actions={
        <View style={styles.headerActions}>
          <VehicleSelect />
          <RangePicker
            value={{start: startDate, end: endDate}}
            onChange={r => setRangeBatch({from: r.start, to: r.end})}
            align="end"
            triggerTestId="efficiency-range"
          />
          <SavedViewMenu
            route="/efficiency"
            currentQuery={savedView.currentQuery}
            onApply={savedView.apply}
          />
        </View>
      }>
      {/* Hero gauges */}
      <FadeIn>
        <GlassPanel style={styles.heroPanel}>
          {stats ? (
            <View style={styles.heroGrid}>
              <View style={styles.heroCell}>
                <RadialGauge
                  value={Math.round(toEfficiencyDisplay(stats.avgEfficiencyWhKm))}
                  max={300}
                  label={`${t('efficiency.avg', 'Avg')} ${efficiencyUnit}`}
                  color={efficiencyColor(stats.avgEfficiencyWhKm)}
                />
              </View>
              <View style={[styles.heroCell, styles.heroStat]}>
                <AppText style={styles.heroValue}>
                  <AnimatedNumber value={Number(kmPerKwh) || 0} decimals={1} />
                </AppText>
                <AppText style={styles.heroLabel}>
                  {t('efficiency.kmPerKwh', 'km/kWh')}
                </AppText>
              </View>
              <View style={[styles.heroCell, styles.heroStat]}>
                <AppText style={[styles.heroValue, styles.colorGreen]}>
                  <AnimatedNumber value={Math.round(stats.co2SavedKg)} />
                </AppText>
                <AppText style={styles.heroLabel}>
                  {t('efficiency.co2Saved', 'CO\u2082 Saved (kg)')}
                </AppText>
              </View>
              <View style={[styles.heroCell, styles.heroStat]}>
                <AppText style={[styles.heroValue, styles.colorCyan]}>
                  <AnimatedNumber
                    value={Math.round(toDistanceDisplay(stats.totalDistanceKm))}
                  />
                </AppText>
                <AppText style={styles.heroLabel}>
                  {t('efficiency.totalDistance', 'Total')} {distanceUnit}
                </AppText>
              </View>
            </View>
          ) : (
            <EmptyState
              message={t(
                'efficiency.noStats',
                'No efficiency data available yet',
              )}
              testID="efficiency-no-stats"
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Stat cards */}
      {stats ? (
        <StaggerContainer style={styles.statGrid}>
          <StaggerItem style={styles.statCell}>
            <GlassPanel style={styles.statPanel}>
              <AppText style={[styles.statIcon, styles.colorAmber]}>
                {ICON_ZAP}
              </AppText>
              <AppText style={styles.statValue}>
                {fmtNumber(toEfficiencyDisplay(stats.avgEfficiencyWhKm))}
              </AppText>
              <AppText style={styles.statLabel}>
                {t('efficiency.avgConsumption', 'Avg')} {efficiencyUnit}
              </AppText>
            </GlassPanel>
          </StaggerItem>
          <StaggerItem style={styles.statCell}>
            <GlassPanel style={styles.statPanel}>
              <AppText style={[styles.statIcon, styles.colorGreen]}>
                {ICON_TRENDING_UP}
              </AppText>
              <AppText style={styles.statValue}>
                {fmtNumber(toSpeedDisplay(stats.avgSpeedKmh))}
              </AppText>
              <AppText style={styles.statLabel}>
                {t('efficiency.avgSpeed', 'Avg Speed')} {speedUnit}
              </AppText>
            </GlassPanel>
          </StaggerItem>
          <StaggerItem style={styles.statCell}>
            <GlassPanel style={styles.statPanel}>
              <AppText style={[styles.statIcon, styles.colorCyan]}>
                {ICON_FUEL}
              </AppText>
              <AppText style={styles.statValue}>${costPerKm}</AppText>
              <AppText style={styles.statLabel}>
                {t('efficiency.costPerKm', 'Est. Cost/km')}
              </AppText>
            </GlassPanel>
          </StaggerItem>
          <StaggerItem style={styles.statCell}>
            <GlassPanel style={styles.statPanel}>
              <AppText style={[styles.statIcon, styles.colorPurple]}>
                {ICON_GAUGE}
              </AppText>
              <AppText style={styles.statValue}>{stats.totalDrives}</AppText>
              <AppText style={styles.statLabel}>
                {t('efficiency.drivesAnalyzed', 'Drives Analyzed')}
              </AppText>
            </GlassPanel>
          </StaggerItem>
        </StaggerContainer>
      ) : (
        <GlassPanel style={styles.panel}>
          <EmptyState
            message={t(
              'efficiency.noStatCards',
              'No driving statistics available yet',
            )}
            testID="efficiency-no-statcards"
          />
        </GlassPanel>
      )}

      {/* Charts row 1 */}
      {dailyTrend.length > 2 && (
        <View style={styles.chartRow}>
          <FadeIn>
            <ChartContainer
              title={t('efficiency.dailyTrend', {
                unit: efficiencyUnit,
                defaultValue: 'Daily Efficiency ({{unit}})',
              })}
              ariaLabel={t(
                'efficiency.dailyTrend.aria',
                'Daily efficiency trend area chart',
              )}
              data={dailyTrend.map(d => ({date: d.date, efficiency: d.efficiency}))}
              dataColumns={[
                {key: 'date', label: t('efficiency.col.date', 'Date')},
                {key: 'efficiency', label: efficiencyUnit},
              ]}
              height={240}
              annotations={{
                vehicleId,
                scope: 'efficiency',
                chartId: 'efficiency-daily-trend',
              }}>
              {({annotations: chartAnnotations}: {annotations: DataAnnotation[]}) => (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyTrend}>
                    {areaGradient('effGrad', '#00f0ff')}
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={colors.border}
                      strokeOpacity={0.4}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{fill: colors.textMuted, fontSize: 9}}
                    />
                    <YAxis tick={{fill: colors.textMuted, fontSize: 10}} />
                    <Tooltip content={<ChartTooltip />} />
                    {renderAnnotationLines(chartAnnotations, ts => ts)}
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="efficiency"
                      stroke="#00f0ff"
                      fill="url(#effGrad)"
                      name={efficiencyUnit}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </ChartContainer>
          </FadeIn>

          <FadeIn>
            <ChartContainer
              title={t('efficiency.speedDist', 'Efficiency by Speed Range')}
              ariaLabel={t(
                'efficiency.speedDist.aria',
                'Efficiency by speed-range bar chart',
              )}
              data={speedDist.map(b => ({range: b.range, avgEff: b.avgEff}))}
              dataColumns={[
                {key: 'range', label: t('efficiency.col.range', 'Speed range')},
                {
                  key: 'avgEff',
                  label: `${t('efficiency.avg', 'Avg')} ${efficiencyUnit}`,
                },
              ]}
              height={240}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={speedDist}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={colors.border}
                    strokeOpacity={0.4}
                  />
                  <XAxis
                    dataKey="range"
                    tick={{fill: colors.textMuted, fontSize: 9}}
                  />
                  <YAxis tick={{fill: colors.textMuted, fontSize: 10}} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="avgEff"
                    name={`${t('efficiency.avg', 'Avg')} ${efficiencyUnit}`}
                    radius={[4, 4, 0, 0]}>
                    {speedDist.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={efficiencyColor(entry.avgEff)}
                        fillOpacity={0.7}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>
        </View>
      )}

      {/* Charts row 2: scatter plots */}
      <View style={styles.chartRow}>
        {speedVsEff.length > 3 && (
          <FadeIn>
            {/* chart-a11y:no-table per-drive scatter cloud — aggregated stats visible above */}
            <ChartContainer
              title={t('efficiency.speedVsEfficiency', 'Speed vs Efficiency')}
              ariaLabel={t(
                'efficiency.speedVsEfficiency.aria',
                'Speed versus efficiency scatter plot',
              )}
              height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={colors.border}
                    strokeOpacity={0.4}
                  />
                  <XAxis
                    dataKey="speed"
                    name={t('efficiency.speed', 'Speed')}
                    unit={` ${speedUnit}`}
                    tick={{fill: colors.textMuted, fontSize: 10}}
                  />
                  <YAxis
                    dataKey="efficiency"
                    name={efficiencyUnit}
                    unit={` ${efficiencyUnit}`}
                    tick={{fill: colors.textMuted, fontSize: 10}}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Scatter data={speedVsEff} fill="#f59e0b" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>
        )}

        {tempVsEff.length > 3 && (
          <FadeIn>
            {/* chart-a11y:no-table per-drive scatter cloud — bucketed temperature table follows below */}
            <ChartContainer
              title={t(
                'efficiency.tempVsEfficiency',
                'Temperature vs Efficiency',
              )}
              ariaLabel={t(
                'efficiency.tempVsEfficiency.aria',
                'Temperature versus efficiency scatter plot',
              )}
              height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={colors.border}
                    strokeOpacity={0.4}
                  />
                  <XAxis
                    dataKey="temp"
                    name={t('efficiency.temp', 'Temp')}
                    unit={` ${tempUnit}`}
                    tick={{fill: colors.textMuted, fontSize: 10}}
                  />
                  <YAxis
                    dataKey="efficiency"
                    name={efficiencyUnit}
                    unit={` ${efficiencyUnit}`}
                    tick={{fill: colors.textMuted, fontSize: 10}}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Scatter data={tempVsEff} fill="#a855f7" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>
        )}
      </View>

      {/* Temperature-Bucketed Efficiency Table */}
      <FadeIn>
        <GlassPanel style={styles.heroPanel}>
          <AppText style={styles.sectionTitle} weight="semibold">
            <AppText style={[styles.sectionIcon, styles.colorOrange]}>
              {ICON_THERMOMETER}
            </AppText>{' '}
            {t('efficiency.tempEfficiency', 'Efficiency by Temperature Range')}
          </AppText>
          {tempBuckets.length > 0 ? (
            <DataTable<TempBucketRow>
              tableId="driving:efficiency-temp-buckets"
              data={tempBuckets}
              keyExtractor={b => b.range}
              compact
              pagination
              columns={[
                {
                  key: 'range',
                  header: t('efficiency.tempRange', 'Temp Range'),
                  render: b => b.range,
                },
                {
                  key: 'count',
                  header: t('efficiency.drives', 'Drives'),
                  align: 'right',
                  render: b => String(b.count),
                },
                {
                  key: 'avgEff',
                  header: `${t('efficiency.avg', 'Avg')} ${efficiencyUnit}`,
                  align: 'right',
                  render: b => (
                    <AppText style={{color: efficiencyColor(b.avgEff)}} variant="caption">
                      {fmtInt(toEfficiencyDisplay(b.avgEff))}
                    </AppText>
                  ),
                },
                {
                  key: 'kmPerKwh',
                  header: `${distanceUnit}/kWh`,
                  align: 'right',
                  render: b => (
                    <AppText style={styles.colorCyan} variant="caption">
                      {b.avgEff > 0
                        ? fmtNumber(1000 / toEfficiencyDisplay(b.avgEff))
                        : '\u2014'}
                    </AppText>
                  ),
                },
                {
                  key: 'totalDist',
                  header: `${t('efficiency.total', 'Total')} ${distanceUnit}`,
                  align: 'right',
                  render: b => fmtInt(toDistanceDisplay(b.totalDist)),
                },
                {
                  key: 'avgSpeed',
                  header: t('efficiency.avgSpeedCol', 'Avg Speed'),
                  align: 'right',
                  render: b => `${fmtInt(toSpeedDisplay(b.avgSpeed))} ${speedUnit}`,
                },
              ]}
            />
          ) : (
            <EmptyState
              message={t(
                'efficiency.noTempData',
                'Not enough data for temperature breakdown',
              )}
              testID="efficiency-no-temp"
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Metric bars summary */}
      <FadeIn>
        <GlassPanel style={styles.heroPanel}>
          {stats ? (
            <>
              <AppText style={styles.sectionTitle} weight="semibold">
                <AppText style={[styles.sectionIcon, styles.colorAmber]}>
                  {ICON_ZAP}
                </AppText>{' '}
                {t('efficiency.summary', 'Efficiency Summary')}
              </AppText>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryCell}>
                  <MetricBar
                    label={t('efficiency.avgConsumption', 'Avg Consumption')}
                    value={toEfficiencyDisplay(stats.avgEfficiencyWhKm)}
                    max={300}
                    color="#00f0ff"
                  />
                  <AppText style={styles.summaryHint}>
                    {fmtNumber(toEfficiencyDisplay(stats.avgEfficiencyWhKm))}{' '}
                    {efficiencyUnit}
                  </AppText>
                </View>
                <View style={styles.summaryCell}>
                  <MetricBar
                    label={t('efficiency.avgSpeed', 'Avg Speed')}
                    value={toSpeedDisplay(stats.avgSpeedKmh)}
                    max={150}
                    color="#10b981"
                  />
                  <AppText style={styles.summaryHint}>
                    {fmtInt(toSpeedDisplay(stats.avgSpeedKmh))} {speedUnit}
                  </AppText>
                </View>
                <View style={styles.summaryCell}>
                  <MetricBar
                    label={t('efficiency.regenRatio', 'Regen Ratio')}
                    value={stats.regenRatio * 100}
                    max={100}
                    color="#a855f7"
                  />
                  <AppText style={styles.summaryHint}>
                    {fmtNumber(stats.regenRatio * 100)}%
                  </AppText>
                </View>
                <View style={styles.summaryCell}>
                  <MetricBar
                    label={t('efficiency.totalDriveTime', 'Total Drive Time')}
                    value={stats.totalDurationS}
                    max={Math.max(stats.totalDurationS, 36000)}
                    color="#f59e0b"
                  />
                  <AppText style={styles.summaryHint}>
                    {formatDuration(stats.totalDurationS, {precision: 1})}
                  </AppText>
                </View>
              </View>
            </>
          ) : (
            <EmptyState
              message={t(
                'efficiency.noSummary',
                'No efficiency summary available yet',
              )}
              testID="efficiency-no-summary"
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Energy insights */}
      <FadeIn>
        <GlassPanel style={styles.heroPanel}>
          {stats ? (
            <>
              <AppText style={styles.sectionTitle} weight="semibold">
                <AppText style={[styles.sectionIcon, styles.colorOrange]}>
                  {ICON_THERMOMETER}
                </AppText>{' '}
                {t('efficiency.insights', 'Energy Insights')}
              </AppText>
              <View style={styles.insightsGrid}>
                <View style={styles.insightCell}>
                  <AppText style={styles.insightLabel}>
                    {t('efficiency.totalRegen', 'Total Regen')}
                  </AppText>
                  <AppText style={[styles.insightValue, styles.colorGreen]}>
                    {formatEnergy(stats.regenEnergyWh, {precision: 1})}
                  </AppText>
                </View>
                <View style={styles.insightCell}>
                  <AppText style={styles.insightLabel}>
                    {t('efficiency.regenRatioLabel', 'Regen Ratio')}
                  </AppText>
                  <AppText style={[styles.insightValue, styles.colorCyan]}>
                    {fmtNumber(stats.regenRatio * 100)}%
                  </AppText>
                </View>
                <View style={styles.insightCell}>
                  <AppText style={styles.insightLabel}>
                    {t('efficiency.co2Label', 'CO\u2082 Saved')}
                  </AppText>
                  <AppText style={[styles.insightValue, styles.colorGreen]}>
                    {fmtInt(stats.co2SavedKg)}{' '}
                    <AppText style={styles.insightUnit}>kg</AppText>
                  </AppText>
                </View>
                <View style={styles.insightCell}>
                  <AppText style={styles.insightLabel}>
                    {t('efficiency.totalDistLabel', 'Total Distance')}
                  </AppText>
                  <AppText style={[styles.insightValue, styles.colorCyan]}>
                    {fmtInt(toDistanceDisplay(stats.totalDistanceKm))}{' '}
                    <AppText style={styles.insightUnit}>{distanceUnit}</AppText>
                  </AppText>
                </View>
                <View style={styles.insightCell}>
                  <AppText style={styles.insightLabel}>
                    {t('efficiency.topSpeed', 'Top Speed')}
                  </AppText>
                  <AppText style={[styles.insightValue, styles.colorPurple]}>
                    {fmtInt(toSpeedDisplay(stats.topSpeedKmh))}{' '}
                    <AppText style={styles.insightUnit}>{speedUnit}</AppText>
                  </AppText>
                </View>
                <View style={styles.insightCell}>
                  <AppText style={styles.insightLabel}>
                    {t('efficiency.costPerKmLabel', 'Est. Cost/km')}
                  </AppText>
                  <AppText style={[styles.insightValue, styles.colorAmber]}>
                    ${costPerKm}
                  </AppText>
                </View>
              </View>
            </>
          ) : (
            <EmptyState
              message={t(
                'efficiency.noInsights',
                'No energy insights available yet',
              )}
              testID="efficiency-no-insights"
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  scaffold: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  scaffoldHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  scaffoldHeaderText: {
    flexShrink: 1,
    minWidth: 0,
  },
  scaffoldTitle: {
    letterSpacing: -0.5,
  },
  scaffoldSubtitle: {
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  scaffoldActions: {
    flexShrink: 0,
  },
  scaffoldBody: {
    gap: spacing.lg,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 12,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  heroPanel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panel: {
    padding: spacing.lg,
  },
  heroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    rowGap: spacing.lg,
  },
  heroCell: {
    width: '48%',
    alignItems: 'center',
  },
  heroStat: {
    justifyContent: 'center',
  },
  heroValue: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  heroLabel: {
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  statCell: {
    width: '48%',
  },
  statPanel: {
    padding: spacing.md,
    alignItems: 'center',
  },
  statIcon: {
    fontSize: 16,
    marginBottom: spacing.xs,
  },
  statValue: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  chartRow: {
    gap: spacing.lg,
  },
  sectionTitle: {
    fontSize: typography.caption,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  sectionIcon: {
    fontSize: typography.caption,
  },
  summaryGrid: {
    gap: spacing.md,
  },
  summaryCell: {
    width: '100%',
  },
  summaryHint: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  metricBarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  metricBarLabel: {
    color: colors.textSecondary,
    fontWeight: '500',
  },
  metricBarValue: {
    fontVariant: ['tabular-nums'],
  },
  metricBarTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  metricBarFill: {
    height: '100%',
    borderRadius: 8,
  },
  insightsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  insightCell: {
    width: '31%',
    alignItems: 'center',
  },
  insightLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  insightValue: {
    fontSize: typography.body,
    fontWeight: '800',
    textAlign: 'center',
  },
  insightUnit: {
    fontSize: typography.caption,
    color: colors.textMuted,
    fontWeight: '400',
  },
  colorAmber: {
    color: '#fbbf24',
  },
  colorGreen: {
    color: '#4ade80',
  },
  colorCyan: {
    color: '#22d3ee',
  },
  colorPurple: {
    color: '#c084fc',
  },
  colorOrange: {
    color: '#fb923c',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyStateIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateTitle: {
    color: colors.textPrimary,
  },
  emptyStateMessage: {
    textAlign: 'center',
  },
  vehicleSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  vehicleChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  vehicleChipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  vehicleChipText: {
    color: colors.textSecondary,
    maxWidth: 160,
  },
  vehicleChipTextActive: {
    color: colors.textPrimary,
  },
  rangePicker: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rangePickerText: {
    color: colors.textSecondary,
  },
  savedViewChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  savedViewChipDisabled: {
    opacity: 0.6,
  },
  savedViewText: {
    color: colors.textSecondary,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  tableRowCompact: {
    paddingVertical: spacing.xs,
  },
  tableHeaderRow: {
    borderBottomWidth: 1,
  },
  tableCell: {
    flex: 1,
    minWidth: 0,
  },
  tableHeaderText: {
    letterSpacing: 0.4,
  },
  tableCellText: {
    color: colors.textPrimary,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  pageButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pageButtonDisabled: {
    opacity: 0.4,
  },
  pageButtonText: {
    color: colors.textPrimary,
  },
  pageLabel: {
    minWidth: 48,
    textAlign: 'center',
  },
});
