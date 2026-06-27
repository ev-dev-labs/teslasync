import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/charging/pages/ChargingDetailPage.tsx.
//
// `ChargingDetailPage` is the single-session deep dive: a header (back link,
// date, vehicle, AC/DC + live charging-state + charger-type + place badges), the
// AI charging diagnosis section, five hero RadialGauges (energy/SoC/peak/
// duration/avg power), a battery-fill progress panel, eight stat cards, a "more
// details" panel (inline metrics + KVList), an optional location panel, a charge
// curve chart, three time-synced charts (SoC/energy/range, temperature, voltage/
// current) wrapped in a ChartTimeRangeProvider, an advanced live-parameters
// KVList, and a started/ended timestamp footer. Every state name (`t`, `id`,
// `sessionId`, `unitPrefs`, `formatEnergy`, `toDistanceDisplay`, `distanceUnit`,
// `settingsCostPerKwh`, `currencySymbol`, `formatEnergyCost`, `tempUnit`,
// `session`, `isLoading`, `telemetry`, `vehicle`, `liveCharging`,
// `breadcrumbLabels`, `hasTelemetry`, `dc`, `chargingState`,
// `chargingStateVariant`, `chargeCurve`, `timeSeriesData`, `tempData`,
// `voltCurrentData`, `avgRate`, `durationMin`, `addedDistanceM`, `costPerKwh`),
// every API path (via the reused hooks), the SI unit handling (display-boundary
// conversion only), and every i18n key + English fallback are preserved verbatim.
//
// Web modules with no native-parity surface are mapped per the conversion
// contract (rules 4-7), each documented in the sidecar:
//   - react-router-dom `useParams` (L2) -> a native shim reading the session id
//     from an optional component prop (a native navigator passes it in place of
//     the DOM `:id` route param). No id -> the loading skeleton shows.
//   - react-router-dom `<Link to>` (L2) -> a Pressable whose onPress calls
//     `Linking.openURL` (same seam the HealthRow port uses); internal SPA routes
//     resolve only when a deep-link handler is registered (documented).
//   - react-i18next `useTranslation` (L3) -> a local key-preserving shim that
//     supports the two source call shapes: `t(key, 'English')` and the options
//     form `t(key, { defaultValue, ...interpolationParams })`, with `{{token}}`
//     interpolation (used by `charging.detail.atRate`).
//   - `@/api/types` types (L4) + `@/api/hooks/useCharging` / `@/api/hooks/
//     useVehicles` hooks (L5-6) -> the reused web-parity api types + hooks 1:1.
//     `useChargingSessionDetail` returns the structurally-identical
//     `ApiChargingSession`, assignable to the `ChargingSession` helpers.
//   - `@/hooks/useFormatting` (L7) + `@/hooks/useUnits` (L8) -> local shims that
//     read the reused `useSettings` hook and reproduce only the surface this page
//     uses: useUnits -> `{ unitPrefs: { distance, energy, temperature }, formatEnergy }`;
//     useFormatting -> `{ costPerKwh, currencySymbol, formatEnergyCost }`.
//   - `@/lib/unitConversion` converters (L9) and `formatEnergy` -> inlined verbatim.
//   - `@/hooks/usePageTitle` (L10) -> a documented native-safe no-op (no DOM
//     document.title; the translated title flows into PageContainer's header).
//   - `@/lib/dateFormat` formatDate/formatTime (L11) + the footer's full datetime
//     -> inlined native-safe copies (nullish/invalid -> '—').
//   - `@/lib/numberFormat` fmtNumber/fmtWithUnit/fmtPercent (L12) -> inlined
//     verbatim (safeNumber coerces nullish/non-finite -> 0, default precision 2,
//     en-US locale).
//   - `@/lib/tokens` chartTokens (L13) -> the `cursor` sub-object inlined; the
//     native ReferenceLine ignores the stroke props but they are passed faithfully.
//   - `@/components/layout` PageContainer (L14) -> the reused web-parity
//     PageContainer (title/breadcrumbLabels/actions match).
//   - `@/components/ui` GlassPanel/Badge/HelpTooltip/PrintButton (L15): GlassPanel
//     -> the shared native GlassPanel; Badge/PrintButton -> reused web-parity ui
//     ports; HelpTooltip -> a local "?" AppText whose hover/focus popover + Learn-
//     more link are UNAVAILABLE on native, so the help copy is surfaced via
//     accessibilityHint (the i18n keys + English copy are preserved).
//   - `@/components/data-display` MetricBar/InlineMetric/AnimatedNumber/StatCard/
//     KVList/LiveIndicator/DateTime (L16) -> local components mirroring each web
//     public API (no native data-display ports exist). AnimatedNumber keeps the
//     count-up via React Native `Animated`; LiveIndicator has no native SSE wire-
//     health hook so it renders the documented `unknown` state; DateTime renders
//     the full datetime (the `in`/`showTz` timezone resolution + abbreviation are
//     UNAVAILABLE on native — no tz provider).
//   - `@/components/charts` RadialGauge + the recharts-shaped primitives + helpers
//     (L17, L21-28) -> the web-parity charts barrel, which preserves the recharts
//     public API while rendering React-Native-safe placeholders (no recharts/SVG/
//     DOM). The chart JSX is kept structurally faithful; leaf primitives render
//     accessible "unavailable" placeholders. ChartTimeRangeProvider + the synced-
//     cursor hooks are the reused native sync store.
//   - `@/components/feedback` Skeleton/EmptyState/LiveStaleDataBanner +
//     *Skeleton blocks (L18) -> local components: Skeleton -> a static muted block
//     (the web `animate-pulse` shimmer is simplified); EmptyState -> a message +
//     optional glyph; LiveStaleDataBanner -> renders null (native has no live SSE
//     connection, so the >2-minute-disconnected banner never shows — faithful to
//     the web connected case).
//   - `@/components/motion` FadeIn/StaggerContainer/StaggerItem (L19) -> the reused
//     web-parity motion barrel. StaggerContainer renders a plain native column, so
//     the source hero-gauge CSS grid resolves to a full-width vertical stagger
//     stack (documented).
//   - `@/components/ai/AIChargingDiagnosis` (L20) -> the reused web-parity ai port.
//   - lucide-react icons (L31-33) -> decorative emoji glyphs via `Glyph`
//     (accessibility-hidden); the adjacent label always carries the meaning.
//   - `../components/charging-curve/helpers` distanceAddedM/durationMinutes (L34)
//     -> inlined verbatim (the native helpers module is not a standalone port yet).
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported. Tailwind maps to StyleSheet: `space-y-*` -> gap/margin
// tokens; the responsive `grid grid-cols-*` panels resolve mobile-first to flex-
// wrap rows; `--text-primary/secondary/muted` -> the AppText tones; the long page
// body is wrapped in a ScrollView so every section stays reachable.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Easing,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import type {
  ChargingSession,
  ChargeTelemetryReading,
} from '../../../api/types';
import {
  useChargingSessionDetail,
  useChargeTelemetry,
} from '../../../api/hooks/useCharging';
import {
  useVehicle,
  useChargingTelemetryLatest,
} from '../../../api/hooks/useVehicles';
import { useSettings } from '../../../api/hooks/useSettings';
import { PageContainer } from '../../../components/layout/PageContainer';
import { Badge } from '../../../components/ui/Badge';
import { PrintButton } from '../../../components/ui/PrintButton';
import { AIChargingDiagnosis } from '../../../components/ai/AIChargingDiagnosis';
import {
  FadeIn,
  StaggerContainer,
  StaggerItem,
} from '../../../components/motion';
import {
  AREA_DEFAULTS,
  Area,
  AreaChart,
  areaGradient,
  axisTickSm,
  ChartBrush,
  chartGrid,
  chartMargin,
  ChartTimeRangeProvider,
  ChartTooltip,
  ComposedChart,
  Line,
  RadialGauge,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  useSyncedCursor,
  useSyncedReferenceLineX,
  XAxis,
  YAxis,
} from '../../../components/charts';

/* ─── i18n shim ────────────────────────────────────────────────── */
// react-i18next is absent from the native deps. i18next returns the KEY when no
// translation exists, so this resolves the inline English fallback while keeping
// the key at every call site. Two source call shapes are supported:
//   t(key, 'English')                    -> 'English'
//   t(key, { defaultValue, ...params })  -> interpolate(defaultValue, params)
// `{{token}}` placeholders are filled from the supplied params (used by
// `charging.detail.atRate`).
type TPrimitive = string | number;
type TParams = Record<string, TPrimitive | undefined>;
interface TOptions {
  defaultValue?: string;
  [key: string]: TPrimitive | undefined;
}

function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = params[token];
    return value == null ? match : String(value);
  });
}

function translate(key: string, fallback?: string | TOptions): string {
  if (fallback == null) {
    return key;
  }
  if (typeof fallback === 'string') {
    return fallback;
  }
  const { defaultValue, ...params } = fallback;
  return interpolate(defaultValue ?? key, params);
}

function useTranslation(): { t: typeof translate } {
  return { t: translate };
}

/* ─── usePageTitle shim ────────────────────────────────────────── */
// The web hook writes document.title; native has no DOM document, so this is a
// documented native-safe no-op. The translated title is still computed at the
// call site and rendered by PageContainer as the on-screen header.
function usePageTitle(title: string): void {
  useEffect(() => undefined, [title]);
}

/* ─── useParams shim ───────────────────────────────────────────── */
// The web read the `:id` route param via react-router-dom. Native has no DOM
// router, so the id arrives via the optional component prop (passed by a native
// navigator). Returns the same `{ id }` shape; a missing id yields the loading
// state, matching the web pre-fetch render.
function useParams(idFromProps?: string): { id?: string } {
  return { id: idFromProps };
}

/* ─── numberFormat (inlined from @/lib/numberFormat) ───────────── */
// safeNumber collapses nullish/non-finite to 0; fmtNumber is the locale-aware
// fixed-precision formatter (default precision 2, en-US); fmtWithUnit/fmtPercent
// append the unit/percent suffix exactly as the web helpers do.
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toFixed(d);
  }
}

function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

function fmtPercent(v: unknown, decimals?: number): string {
  return `${fmtNumber(v, decimals)}%`;
}

/* ─── dateFormat (inlined from @/lib/dateFormat) ───────────────── */
// All three return the universal '—' placeholder for unrenderable input.
// formatDate -> "Apr 4, 2026"; formatTime -> locale 2-digit hour:minute;
// formatDateTime -> full date + time (the footer's `<DateTime in showTz>` body).
function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ─── unitConversion (inlined from @/lib/unitConversion) ───────── */
type DistanceUnitPref = 'km' | 'mi' | 'ft';
type EnergyUnitPref = 'Wh' | 'kWh';
type PowerUnitPref = 'W' | 'kW';
type TemperatureUnitPref = '°C' | '°F';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

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

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

function convertPowerFromSI(watts: number, to: PowerUnitPref): number {
  switch (to) {
    case 'W':
      return watts;
    case 'kW':
      return watts / 1000;
  }
}

// Inlined from @/lib/unitConversion `formatEnergy` (the only formatter the
// useUnits shim exposes): nullish/non-finite -> '—', else SI Wh -> the energy
// pref ('kWh' => /1000) at precision 2 with a trailing unit.
function formatEnergyValue(
  wh: number | null | undefined,
  pref: EnergyUnitPref,
  precision: number,
): string {
  if (typeof wh !== 'number' || !Number.isFinite(wh)) {
    return '—';
  }
  return `${fmtNumber(convertEnergyFromSI(wh, pref), precision)} ${pref}`;
}

/* ─── useUnits shim ────────────────────────────────────────────── */
// Mirrors the web useUnits surface this page reads: derive `unitPrefs.distance`
// from `unit_of_length` and `unitPrefs.temperature` from `unit_of_temp`; energy
// is the web default 'kWh'. `formatEnergy` delegates to the inlined formatter.
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function deriveTemperature(
  unitOfTemp: string | undefined,
): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '°F' : '°C';
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

interface UnitPrefsShape {
  distance: DistanceUnitPref;
  energy: EnergyUnitPref;
  temperature: TemperatureUnitPref;
}

function useUnits(): {
  unitPrefs: UnitPrefsShape;
  formatEnergy: (value: number | null | undefined) => string;
} {
  const { data: settings } = useSettings();
  const distance = deriveDistance(settings?.unit_of_length);
  const temperature = deriveTemperature(settings?.unit_of_temp);
  const precision = derivePrecision(settings?.decimal_precision) ?? 2;

  return useMemo(() => {
    const unitPrefs: UnitPrefsShape = { distance, energy: 'kWh', temperature };
    return {
      unitPrefs,
      formatEnergy: (value: number | null | undefined) =>
        formatEnergyValue(value, unitPrefs.energy, precision),
    };
  }, [distance, temperature, precision]);
}

/* ─── useFormatting shim ───────────────────────────────────────── */
// Mirrors the web useFormatting surface this page reads: `costPerKwh`
// (base_cost_per_kwh, default 0.12), `currencySymbol` (default '$'), and
// `formatEnergyCost(kwh)` = `${symbol}${fmtNumber(kwh * costPerKwh, precision)}`.
function useFormatting(): {
  costPerKwh: number;
  currencySymbol: string;
  formatEnergyCost: (kwh: number) => string;
} {
  const { data: settings } = useSettings();
  const costPerKwh = settings?.base_cost_per_kwh ?? 0.12;
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision = derivePrecision(settings?.decimal_precision) ?? 2;

  return useMemo(
    () => ({
      costPerKwh,
      currencySymbol,
      formatEnergyCost: (kwh: number) =>
        `${currencySymbol}${fmtNumber(kwh * costPerKwh, userPrecision)}`,
    }),
    [costPerKwh, currencySymbol, userPrecision],
  );
}

/* ─── chartTokens (inlined from @/lib/tokens) ──────────────────── */
// Only the `cursor` sub-object is read by this page. The native ReferenceLine
// renders a placeholder and ignores the stroke props, but they are passed
// faithfully so the source render shape is preserved.
const chartTokens = {
  cursor: {
    stroke: 'rgba(255, 255, 255, 0.3)',
    strokeWidth: 1,
    strokeDasharray: '4 2',
  },
} as const;

/* ─── helpers ──────────────────────────────────────────────────── */

function isDC(session: ChargingSession): boolean {
  const ft = session.charger_type?.toLowerCase() ?? '';
  return ft !== '' && ft !== '<invalid>' && ft !== 'unknown';
}

// Inlined verbatim from ../components/charging-curve/helpers (durationMinutes).
function durationMinutes(startedAt: string, endedAt: string | null): number {
  if (!endedAt) {
    return 0;
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return Math.round((end - start) / 60000);
}

// Inlined verbatim from ../components/charging-curve/helpers (distanceAddedM).
function distanceAddedM(s: ChargingSession): number | null {
  if (s.start_odometer_m == null || s.end_odometer_m == null) {
    return null;
  }
  const delta = s.end_odometer_m - s.start_odometer_m;
  return delta > 0 ? delta : null;
}

function kwhPerHour(session: ChargingSession): number | null {
  const durationMin = durationMinutes(session.started_at, session.ended_at);
  if (durationMin <= 0) {
    return null;
  }
  return (session.total_energy_added_wh / 1000 / durationMin) * 60;
}

/** Synthesize a plausible charge curve when telemetry is absent */
function synthesizeCurve(
  session: ChargingSession,
): { soc: number; power: number }[] {
  const startSoc = session.start_soc_pct ?? 0;
  const endSoc = session.end_soc_pct ?? 100;
  const peakPower = (session.peak_power_w ?? 50_000) / 1000;
  const points: { soc: number; power: number }[] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const pct = i / steps;
    const soc = startSoc + (endSoc - startSoc) * pct;
    // DC tapers above 80 %; AC stays roughly flat
    const taper = isDC(session) && soc > 80 ? 1 - (soc - 80) / 40 : 1;
    points.push({
      soc: Math.round(soc),
      power: Math.round(peakPower * Math.max(taper, 0.15) * 10) / 10,
    });
  }
  return points;
}

/* ─── decorative glyph (lucide icon substitute) ────────────────── */
function GlyphLegacyUnused({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      allowFontScaling={false}
      importantForAccessibility="no"
      style={style}
    >
      {children}
    </AppText>
  );
}

/* ─── HelpTooltip (web @/components/ui HelpTooltip) ────────────── */
// The web "?" trigger reveals a hover/focus tooltip popover (+ optional Learn-
// more link). Native has no hover affordance, so the help copy is surfaced via
// accessibilityHint while the i18n key + English fallback are preserved. Returns
// null when no content resolves, exactly like the web component.
function HelpTooltip({
  i18nKey,
  defaultValue,
  ariaLabel,
}: {
  size?: 'xs' | 'sm' | 'md';
  i18nKey?: string;
  defaultValue?: string;
  ariaLabel?: string;
}) {
  const resolved = i18nKey
    ? translate(i18nKey, { defaultValue: defaultValue ?? '' })
    : '';
  if (!resolved) {
    return null;
  }
  const label = ariaLabel ?? translate('help.tooltip.iconLabel', 'More info');
  return (
    <AppText
      accessibilityHint={resolved}
      accessibilityLabel={label}
      accessibilityRole="text"
      style={styles.helpIcon}
      tone="muted"
    >
      ?
    </AppText>
  );
}

/* ─── MetricBar (web @/components/data-display MetricBar) ───────── */
// The `sublabel ?? fmtNumber(value)` policy is preserved (an explicit empty
// string suppresses the readout). The web framer width animation is simplified
// to a static fill at the computed percentage.
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
  return (
    <View>
      <View style={styles.metricBarHeader}>
        <AppText style={styles.metricBarLabel} tone="secondary">
          {label}
        </AppText>
        <AppText style={[styles.metricBarValue, { color }]}>
          {sublabel ?? fmtNumber(value)}
        </AppText>
      </View>
      <View style={styles.metricBarTrack}>
        <View
          style={[
            styles.metricBarFill,
            { width: `${pct}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );
}

/* ─── InlineMetric (web @/components/data-display InlineMetric) ── */
// Compact icon + value (+ optional trailing label). Render order mirrors the web
// component: icon, value, then label. The lucide icon becomes a decorative glyph.
function InlineMetric({
  icon,
  value,
  label,
}: {
  icon: string;
  value: string | number;
  label?: string;
}) {
  return (
    <View style={styles.inlineMetric}>
      <Glyph style={styles.inlineMetricIcon}>{icon}</Glyph>
      <AppText style={styles.inlineMetricText} tone="muted" variant="caption">
        {String(value)}
      </AppText>
      {label ? (
        <AppText style={styles.inlineMetricText} tone="muted" variant="caption">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

/* ─── AnimatedNumber (web @/components/data-display AnimatedNumber) ── */
// Count-up from 0 to `value` over `duration` seconds with an ease-out-quad curve,
// reproduced with React Native `Animated` (the web used requestAnimationFrame).
function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  style,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}) {
  const [display, setDisplay] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    anim.setValue(0);
    const listenerId = anim.addListener(({ value: v }) => setDisplay(v));
    const animation = Animated.timing(anim, {
      toValue: value,
      duration: duration * 1000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    });
    animation.start();
    return () => {
      animation.stop();
      anim.removeListener(listenerId);
    };
  }, [value, duration, anim]);

  return (
    <AppText style={style}>
      {`${prefix ?? ''}${fmtNumber(display, decimals)}${suffix ?? ''}`}
    </AppText>
  );
}

/* ─── StatCard (web @/components/data-display StatCard) ─────────── */
function StatCard({
  label,
  value,
  unit,
  icon,
  sublabel,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon?: string;
  sublabel?: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statCardHeader}>
        <AppText
          numberOfLines={1}
          style={styles.statCardLabel}
          tone="muted"
          variant="caption"
        >
          {label}
        </AppText>
        {icon ? <Glyph style={styles.statCardIcon}>{icon}</Glyph> : null}
      </View>
      <View style={styles.statCardValueRow}>
        <AppText style={styles.statCardValue} weight="bold">
          {String(value)}
        </AppText>
        {unit ? (
          <AppText style={styles.statCardUnit} tone="muted">
            {unit}
          </AppText>
        ) : null}
      </View>
      {sublabel ? (
        <AppText style={styles.statCardSublabel} tone="muted" variant="caption">
          {sublabel}
        </AppText>
      ) : null}
    </View>
  );
}

/* ─── KVList (web @/components/data-display KVList) ─────────────── */
function KVList({
  items,
  columns = 1,
}: {
  items: { label: string; value: ReactNode }[];
  columns?: 1 | 2;
}) {
  return (
    <View style={columns === 2 ? styles.kvGrid : undefined}>
      {items.map(item => (
        <View
          key={item.label}
          style={[styles.kvRow, columns === 2 ? styles.kvRowHalf : null]}
        >
          <AppText style={styles.kvLabel} tone="muted">
            {item.label}
          </AppText>
          <AppText style={styles.kvValue}>{item.value}</AppText>
        </View>
      ))}
    </View>
  );
}

/* ─── LiveIndicator (web @/components/data-display LiveIndicator) ── */
// The web indicator reflects live SSE wire health. Native has no SSE wire-health
// hook ported, so the status is reported as the documented `unknown` state (the
// adjacent label names it); the connected/reconnecting/disconnected branches are
// UNAVAILABLE on native.
function LiveIndicator({
  variant = 'pill',
}: {
  variant?: 'pill' | 'dot' | 'compact';
}) {
  const label = translate('live.unknown', 'Unknown');
  if (variant === 'dot') {
    return (
      <View
        accessibilityLabel={label}
        accessibilityRole="image"
        style={styles.liveDot}
      />
    );
  }
  return (
    <View accessibilityRole="text" style={styles.liveChip}>
      <Glyph style={styles.liveGlyph}>○</Glyph>
      <AppText style={styles.liveLabel} tone="muted" variant="caption">
        {label}
      </AppText>
    </View>
  );
}

/* ─── DateTime (web @/components/data-display/format DateTime) ──── */
// Renders the full datetime. The web `in`/`showTz` props resolve a vehicle/user
// timezone + abbreviation via provider hooks; native has no tz provider, so that
// resolution is UNAVAILABLE — the props are accepted for source compatibility and
// the timestamp renders in the device locale/zone.
function DateTime({
  value,
}: {
  value: string | Date | null | undefined;
  in?: 'vehicle' | 'user' | 'utc';
  showTz?: boolean;
  variant?: 'full' | 'date' | 'time' | 'relative' | 'short';
}) {
  return <AppText style={styles.footerValue}>{formatDateTime(value)}</AppText>;
}

/* ─── LiveStaleDataBanner (web @/components/feedback) ───────────── */
// Web shows a warning once the live pipe has been disconnected for >2 minutes.
// Native has no live SSE connection, so the banner never shows (faithful to the
// web connected case); it renders null.
function LiveStaleDataBanner(): React.ReactElement | null {
  return null;
}

/* ─── EmptyState (web @/components/feedback EmptyState) ─────────── */
// Mirrors the API used here (`{ icon?, message }`): a centred muted message with
// an optional decorative glyph.
function EmptyState({ icon, message }: { icon?: string; message: string }) {
  return (
    <View accessibilityRole="text" style={styles.emptyState}>
      {icon ? <Glyph style={styles.emptyIcon}>{icon}</Glyph> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── Skeleton blocks (web @/components/feedback) ──────────────── */
// Static muted blocks; the web `animate-pulse` shimmer is simplified.
function Skeleton({
  height = 16,
  width = '100%',
  style,
}: {
  height?: number;
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.skeleton, { height, width }, style]} />;
}

function PageHeaderSkeleton() {
  return (
    <View style={styles.skelHeader}>
      <Skeleton height={28} width="50%" />
      <Skeleton height={16} width="32%" />
    </View>
  );
}

function StatGridSkeleton({ cards }: { cards: number }) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: cards }).map((_, i) => (
        <View key={i} style={styles.skelCard}>
          <Skeleton height={14} width="60%" />
          <Skeleton height={28} style={styles.skelCardValue} width="44%" />
        </View>
      ))}
    </View>
  );
}

function ChartBlockSkeleton({ height }: { height: number }) {
  return (
    <View style={styles.skelChart}>
      <Skeleton height={18} width="38%" />
      <Skeleton height={height} style={styles.skelChartBody} />
    </View>
  );
}

/**
 * Mirrors the ChargingDetailPage layout while session telemetry loads:
 * page header → 5 hero stat cards → cost ribbon → 8 secondary stats →
 * 2 charts (charge curve + power profile).
 */
function LoadingSkeleton() {
  return (
    <View style={styles.skelRoot} testID="charging-detail-skeleton">
      <PageHeaderSkeleton />
      <StatGridSkeleton cards={5} />
      <Skeleton height={96} />
      <StatGridSkeleton cards={8} />
      <ChartBlockSkeleton height={256} />
      <ChartBlockSkeleton height={288} />
    </View>
  );
}

/* ─── synced cursor render-prop helper ─────────────────────────── */
// Subscribes the inner chart to the surrounding <ChartTimeRangeProvider> so the
// active cursor + persistent reference line stay in lockstep across the three
// time-axis charts on this page.
function ChargingChartSync({
  children,
}: {
  children: (state: {
    sync: ReturnType<typeof useSyncedCursor>;
    syncedX: ReturnType<typeof useSyncedReferenceLineX>;
  }) => ReactNode;
}) {
  const sync = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();
  return <>{children({ sync, syncedX })}</>;
}

/* ─── main page ────────────────────────────────────────────────── */

interface ChargingDetailPageProps {
  /**
   * Native navigators pass the charging session id here in place of the web
   * router `:id` param. Omitted -> the loading skeleton renders.
   */
  id?: string;
}

export default function ChargingDetailPage({
  id: idProp,
}: ChargingDetailPageProps = {}) {
  const { t } = useTranslation();
  const { id } = useParams(idProp);
  const sessionId = Number(id);

  // ChargingSession distance delta comes through the repo adapter as miles. Live
  // ChargingTelemetry fields with misleading suffixes are SI values. Keep these
  // conversions at the display boundary until the backend fields are renamed.
  const { unitPrefs, formatEnergy } = useUnits();
  // Wrapped in useCallback (vs. the web's inline arrow) so it is stable across
  // renders — react-hooks/exhaustive-deps is an error in the native ESLint config
  // and the chart memos below list it as a dependency. Behaviour is identical.
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const distanceUnit = unitPrefs.distance;
  const {
    costPerKwh: settingsCostPerKwh,
    currencySymbol,
    formatEnergyCost,
  } = useFormatting();
  // Battery / inside / outside temperatures from chargeTelemetryFieldMappings
  // (InsideTemp/OutsideTemp/ModuleTempMax) are °C SI — migrate to the SI-aware
  // useUnits surface. unitPrefs.temperature replaces the old tempUnit string;
  // chart values use convertTempFromSI so YAxis ticks remain raw numbers.

  const tempUnit = unitPrefs.temperature;

  const { data: session, isLoading } = useChargingSessionDetail(
    sessionId || null,
  );
  const { data: telemetry } = useChargeTelemetry(session?.id ?? null);
  const { data: vehicle } = useVehicle(String(session?.vehicle_id ?? ''));
  const { data: liveCharging } = useChargingTelemetryLatest(
    session?.vehicle_id ?? 0,
  );

  usePageTitle(
    session
      ? `${t('charging.detail.title', 'Charge Session')} #${session.id}`
      : t('charging.detail.title', 'Charge Session'),
  );

  const breadcrumbLabels = {
    '/charging/:id': session
      ? `${formatDate(session.started_at)} — ${formatEnergy(
          session.total_energy_added_wh,
        )}`
      : `Session #${id}`,
  };

  const hasTelemetry = !!telemetry && telemetry.length > 0;
  const dc = session ? isDC(session) : false;

  const chargingState = liveCharging?.charging_state;
  const chargingStateVariant:
    | 'success'
    | 'warning'
    | 'danger'
    | 'info'
    | 'neutral' = (() => {
    switch (chargingState) {
      case 'Charging':
      case 'Starting':
        return 'success';
      case 'Complete':
        return 'info';
      case 'Stopped':
      case 'NoPower':
        return 'warning';
      case 'Error':
        return 'danger';
      default:
        return 'neutral';
    }
  })();

  /* derived chart data */
  const chargeCurve = useMemo(() => {
    if (!session) {
      return [];
    }
    if (hasTelemetry && telemetry) {
      return telemetry
        .filter(
          (r: ChargeTelemetryReading) =>
            r.battery_level != null && r.power_kw != null,
        )
        .map((r: ChargeTelemetryReading) => ({
          soc: r.battery_level!,
          power: Math.abs(r.power_kw!),
        }));
    }
    return synthesizeCurve(session);
  }, [session, telemetry, hasTelemetry]);

  const timeSeriesData = useMemo(() => {
    if (!hasTelemetry || !telemetry) {
      return [];
    }
    return telemetry.map((r: ChargeTelemetryReading) => ({
      time: formatTime(r.created_at),
      soc: r.battery_level ?? r.soc,
      energy: r.energy_added,
      range: r.rated_range != null ? toDistanceDisplay(r.rated_range) : null,
      power: r.power_kw != null ? Math.abs(r.power_kw) : null,
    }));
  }, [telemetry, hasTelemetry, toDistanceDisplay]);

  const tempData = useMemo(() => {
    if (!hasTelemetry || !telemetry) {
      return [];
    }
    return telemetry.map((r: ChargeTelemetryReading) => ({
      time: formatTime(r.created_at),
      battery:
        r.battery_temp != null
          ? convertTempFromSI(r.battery_temp, unitPrefs.temperature)
          : null,
      inside:
        r.inside_temp != null
          ? convertTempFromSI(r.inside_temp, unitPrefs.temperature)
          : null,
      outside:
        r.outside_temp != null
          ? convertTempFromSI(r.outside_temp, unitPrefs.temperature)
          : null,
    }));
  }, [telemetry, hasTelemetry, unitPrefs.temperature]);

  const voltCurrentData = useMemo(() => {
    if (!hasTelemetry || !telemetry) {
      return [];
    }
    return telemetry
      .filter(
        (r: ChargeTelemetryReading) =>
          r.voltage != null || r.current_amps != null,
      )
      .map((r: ChargeTelemetryReading) => ({
        time: formatTime(r.created_at),
        voltage: r.voltage,
        current: r.current_amps != null ? Math.abs(r.current_amps) : null,
      }));
  }, [telemetry, hasTelemetry]);

  /* ─── render ───────────────────────────────────────────── */

  if (isLoading || !session) {
    return (
      <PageContainer
        breadcrumbLabels={breadcrumbLabels}
        title={t('charging.detail.title', 'Charge Session')}
      >
        <ScrollView contentContainerStyle={styles.body}>
          <LoadingSkeleton />
        </ScrollView>
      </PageContainer>
    );
  }

  const avgRate = kwhPerHour(session);
  const durationMin = durationMinutes(session.started_at, session.ended_at);
  const addedDistanceM = distanceAddedM(session);
  const costPerKwh =
    session.cost_decimal != null && session.total_energy_added_wh > 0
      ? session.cost_decimal / (session.total_energy_added_wh / 1000)
      : null;

  return (
    <PageContainer
      actions={
        <View style={styles.actions}>
          <LiveIndicator variant="compact" />
          <PrintButton />
        </View>
      }
      breadcrumbLabels={breadcrumbLabels}
      title={t('charging.detail.title', 'Charge Session')}
    >
      <ScrollView contentContainerStyle={styles.body}>
        <LiveStaleDataBanner />
        <FadeIn>
          {/* ── 1. Header ──────────────────────────────────────── */}
          <View style={styles.header}>
            <Pressable
              accessibilityLabel={t('charging.detail.back', 'Charging')}
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => {
                void Linking.openURL('/charging');
              }}
            >
              <Glyph style={styles.backIcon}>←</Glyph>
            </Pressable>
            <AppText style={styles.headerTitle} variant="title" weight="bold">
              {formatDate(session.started_at)}
            </AppText>
            {vehicle ? (
              <AppText style={styles.headerVehicle} tone="muted">
                {vehicle.display_name}
              </AppText>
            ) : null}
            <Badge dot variant={dc ? 'warning' : 'info'}>
              {dc ? 'DC' : 'AC'}
            </Badge>
            {chargingState ? (
              <Badge dot size="sm" variant={chargingStateVariant}>
                {t(
                  `charging.detail.chargingState.${chargingState}`,
                  chargingState,
                )}
              </Badge>
            ) : null}
            {session.charger_type ? (
              <Badge size="sm" variant="neutral">
                {session.charger_type}
              </Badge>
            ) : null}
            {session.start_place ? (
              <Badge size="sm" variant="neutral">
                {`📍 ${session.start_place}`}
              </Badge>
            ) : null}
          </View>

          {/*
            The withAiFeature HOC inside AIChargingDiagnosis renders this section
            ONLY when ai_mode='local'|'cloud' AND the charging-diagnosis toggle is
            on (ADR-015 §I5 + §I6). When AI is off the wrapper returns null — the
            surrounding hero gauges, charge curve, and downstream sections are
            unaffected. Placement: directly between the header and the hero gauges
            so the diagnosis narrative appears alongside the same metrics.
          */}
          <View style={styles.aiSection}>
            <AIChargingDiagnosis sessionId={id} />
          </View>

          {/* ── 2. Hero gauges ─────────────────────────────────── */}
          <StaggerContainer>
            <StaggerItem>
              <GlassPanel style={styles.gaugePanel}>
                <RadialGauge
                  color="#00f0ff"
                  label={t('charging.detail.energyAdded', 'Energy Added')}
                  max={Math.max(
                    convertEnergyFromSI(
                      session.total_energy_added_wh ?? 1,
                      unitPrefs.energy,
                    ),
                    80,
                  )}
                  unit={unitPrefs.energy}
                  value={convertEnergyFromSI(
                    session.total_energy_added_wh ?? 0,
                    unitPrefs.energy,
                  )}
                />
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel style={styles.gaugePanel}>
                <RadialGauge
                  color="#10b981"
                  label={t('charging.detail.endSoc', 'End SoC')}
                  max={100}
                  unit="%"
                  value={session.end_soc_pct ?? 0}
                />
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel style={styles.gaugePanel}>
                <RadialGauge
                  color="#a855f7"
                  label={t('charging.detail.peakPower', 'Peak Power')}
                  max={dc ? 250 : 22}
                  unit="kW"
                  value={convertPowerFromSI(session.peak_power_w ?? 0, 'kW')}
                />
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel style={styles.gaugePanel}>
                <RadialGauge
                  color="#f59e0b"
                  label={t('charging.detail.duration', 'Duration')}
                  max={Math.max(durationMin || 1, 120)}
                  unit="min"
                  value={durationMin}
                />
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel style={styles.gaugePanel}>
                <RadialGauge
                  color="#06b6d4"
                  label={t('charging.detail.avgPower', 'Avg Power')}
                  max={dc ? 250 : 22}
                  unit="kW"
                  value={convertPowerFromSI(session.avg_power_w ?? 0, 'kW')}
                />
              </GlassPanel>
            </StaggerItem>
          </StaggerContainer>

          {/* ── 3. Battery fill meter ──────────────────────────── */}
          <GlassPanel style={styles.panel}>
            <View style={styles.panelHeadingRow}>
              <AppText style={styles.panelHeading} weight="semibold">
                {t('charging.detail.batteryProgress', 'Battery Progress')}
              </AppText>
              <HelpTooltip
                ariaLabel={t('help.charging.socRange.aria', {
                  defaultValue: 'More info about state-of-charge range',
                })}
                defaultValue="The starting and ending state-of-charge percentages for this session. Wider ranges generally mean longer sessions and more taper."
                i18nKey="help.charging.socRange"
                size="sm"
              />
            </View>
            <View style={styles.barStack}>
              <MetricBar
                color="#f59e0b"
                label={t('charging.detail.startSoc', 'Start SoC')}
                max={100}
                sublabel={fmtPercent(session.start_soc_pct)}
                value={session.start_soc_pct ?? 0}
              />
              <MetricBar
                color="#10b981"
                label={t('charging.detail.endSoc', 'End SoC')}
                max={100}
                sublabel={fmtPercent(session.end_soc_pct)}
                value={session.end_soc_pct ?? 0}
              />
            </View>
            <View style={styles.threeCol}>
              <View style={styles.threeColCell}>
                <AppText style={styles.threeColLabel} tone="muted">
                  {t('charging.detail.socGained', 'SoC Gained')}
                </AppText>
                <View style={styles.threeColValueRow}>
                  <AnimatedNumber
                    style={styles.threeColValue}
                    value={
                      (session.end_soc_pct ?? 0) - (session.start_soc_pct ?? 0)
                    }
                  />
                  <AppText style={styles.threeColValue}>%</AppText>
                </View>
              </View>
              <View style={styles.threeColCell}>
                <AppText style={styles.threeColLabel} tone="muted">
                  {t('charging.detail.rangeGained', 'Range Gained')}
                </AppText>
                <AppText style={styles.threeColValue}>
                  {addedDistanceM != null
                    ? fmtWithUnit(
                        toDistanceDisplay((addedDistanceM ?? 0) / 1000),
                        distanceUnit,
                        0,
                      )
                    : '—'}
                </AppText>
              </View>
              <View style={styles.threeColCell}>
                <AppText style={styles.threeColLabel} tone="muted">
                  {t('charging.detail.energyAdded', 'Energy Added')}
                </AppText>
                <AppText style={styles.threeColValue}>
                  {formatEnergy(session.total_energy_added_wh)}
                </AppText>
              </View>
            </View>
          </GlassPanel>

          {/* ── 4. Eight stat cards ────────────────────────────── */}
          <View style={styles.grid}>
            <StatCard
              icon="⚡"
              label={t('charging.detail.energy', 'Energy')}
              unit={unitPrefs.energy}
              value={fmtNumber(
                convertEnergyFromSI(
                  session.total_energy_added_wh,
                  unitPrefs.energy,
                ),
              )}
            />
            <StatCard
              icon="⏱"
              label={t('charging.detail.duration', 'Duration')}
              unit="min"
              value={fmtNumber(durationMin, 0)}
            />
            <StatCard
              icon="🎚"
              label={t('charging.detail.peakPower', 'Peak Power')}
              unit="kW"
              value={fmtNumber(
                convertPowerFromSI(session.peak_power_w ?? 0, 'kW'),
              )}
            />
            <StatCard
              icon="🔋"
              label={t('charging.detail.socRange', 'SoC Range')}
              unit="%"
              value={`${fmtNumber(session.start_soc_pct ?? 0, 0)}–${fmtNumber(
                session.end_soc_pct ?? 0,
                0,
              )}`}
            />
            <StatCard
              icon="💲"
              label={
                session.cost_decimal != null
                  ? t('charging.detail.totalCost', 'Total Cost')
                  : t('charging.detail.estCost', 'Est. Cost')
              }
              sublabel={
                session.cost_decimal == null &&
                session.total_energy_added_wh > 0
                  ? t('charging.detail.atRate', {
                      currencySymbol,
                      costPerKwh: settingsCostPerKwh,
                      defaultValue: 'at {{currencySymbol}}{{costPerKwh}}/kWh',
                    })
                  : undefined
              }
              unit={session.cost_decimal != null ? '$' : ''}
              value={
                session.cost_decimal != null
                  ? fmtNumber(session.cost_decimal, 2)
                  : session.total_energy_added_wh > 0
                  ? formatEnergyCost(session.total_energy_added_wh / 1000)
                  : '—'
              }
            />
            <StatCard
              icon="💲"
              label={t('charging.detail.perKwh', 'Per kWh')}
              sublabel={
                costPerKwh == null
                  ? t('charging.detail.fromSettings', 'from settings')
                  : undefined
              }
              unit="$/kWh"
              value={
                costPerKwh != null
                  ? fmtNumber(costPerKwh, 2)
                  : fmtNumber(settingsCostPerKwh, 2)
              }
            />
            <StatCard
              icon="📍"
              label={t('charging.detail.milesAdded', 'Miles Added')}
              unit={addedDistanceM != null ? distanceUnit : ''}
              value={
                addedDistanceM != null
                  ? fmtNumber(
                      toDistanceDisplay((addedDistanceM ?? 0) / 1000),
                      0,
                    )
                  : '—'
              }
            />
            <StatCard
              icon="⚡"
              label={t('charging.detail.avgRate', 'kWh/h Avg')}
              unit={avgRate != null ? 'kWh/h' : ''}
              value={avgRate != null ? fmtNumber(avgRate) : '—'}
            />
          </View>

          {/* ── 5. More details section ────────────────────────── */}
          <GlassPanel style={styles.panel}>
            <AppText style={styles.panelHeading} weight="semibold">
              {t('charging.detail.moreDetails', 'More Details')}
            </AppText>
            <View style={styles.inlineGrid}>
              <InlineMetric
                icon="🎚"
                label={t('charging.detail.avgPower', 'Avg Power')}
                value={
                  session.avg_power_w != null
                    ? fmtWithUnit(
                        convertPowerFromSI(session.avg_power_w, 'kW'),
                        'kW',
                      )
                    : '—'
                }
              />
              <InlineMetric
                icon="📍"
                label={t('charging.detail.milesAdded', 'Miles Added')}
                value={
                  addedDistanceM != null
                    ? fmtWithUnit(
                        toDistanceDisplay((addedDistanceM ?? 0) / 1000),
                        distanceUnit,
                        0,
                      )
                    : '—'
                }
              />
              <InlineMetric
                icon="⚡"
                label={t('charging.detail.status', 'Status')}
                value={session.ended_status ?? '—'}
              />
              <InlineMetric
                icon="💲"
                label={t('charging.detail.currency', 'Currency')}
                value={session.cost_currency ?? '—'}
              />
            </View>
            <KVList
              columns={2}
              items={[
                {
                  label: t('charging.detail.chargerType', 'Charger Type'),
                  value: session.charger_type ?? (dc ? 'DC' : 'AC'),
                },
                {
                  label: t('charging.detail.location', 'Location'),
                  value: session.start_place ?? '—',
                },
                {
                  label: t('charging.detail.vehicle', 'Vehicle'),
                  value: vehicle?.display_name ?? `ID ${session.vehicle_id}`,
                },
              ]}
            />
          </GlassPanel>

          {/* ── 6. Location info ────────────────────────────────── */}
          {session.start_place ? (
            <GlassPanel style={styles.panel}>
              <AppText style={styles.panelHeading} weight="semibold">
                {t('charging.detail.location', 'Location')}
              </AppText>
              <AppText style={styles.locationText}>
                {session.start_place}
              </AppText>
            </GlassPanel>
          ) : null}

          {/* ── 7. Charge curve chart ──────────────────────────── */}
          <GlassPanel style={styles.panel}>
            <View style={styles.panelHeadingRow}>
              <AppText style={styles.panelHeading} weight="semibold">
                {t('charging.detail.chargeCurve', 'Charge Curve')}
              </AppText>
              {!hasTelemetry ? (
                <AppText style={styles.estimatedNote} tone="muted">
                  {`(${t('charging.detail.estimated', 'estimated')})`}
                </AppText>
              ) : null}
              <HelpTooltip
                ariaLabel={t('help.charging.chargeCurve.aria', {
                  defaultValue: 'More info about taper and derating',
                })}
                defaultValue="Power vs SoC curve for the session. Tapering — the gradual drop in power as the battery approaches full — is inherent to lithium chemistry and is not a fault. Sudden drops below the curve indicate derating: the charger or battery is throttling power because of cell or ambient temperature limits."
                i18nKey="help.charging.chargeCurve"
                size="sm"
              />
            </View>
            {chargeCurve.length > 0 ? (
              <ResponsiveContainer height={280} width="100%">
                <AreaChart data={chargeCurve} margin={chartMargin}>
                  {areaGradient('powerGrad', '#a855f7')}
                  {chartGrid}
                  <XAxis
                    dataKey="soc"
                    label={{
                      value: 'SoC %',
                      position: 'insideBottom',
                      offset: -2,
                      fill: 'var(--text-muted)',
                      fontSize: 10,
                    }}
                    tick={axisTickSm}
                  />
                  <YAxis
                    label={{
                      value: 'kW',
                      angle: -90,
                      position: 'insideLeft',
                      fill: 'var(--text-muted)',
                      fontSize: 10,
                    }}
                    tick={axisTickSm}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    {...AREA_DEFAULTS}
                    dataKey="power"
                    fill="url(#powerGrad)"
                    name={t('charging.detail.power', 'Power')}
                    stroke="#a855f7"
                    unit=" kW"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon="📈"
                message={t('common.noData', 'No data available')}
              />
            )}
          </GlassPanel>

          {/* ── 8/9/10. Synced time-axis charts ─────────────────────
                The SoC/energy/range, temperature, and voltage/current panels all
                live on the same charge-session time axis but use different
                filtered telemetry rows. Wrapping them in a
                <ChartTimeRangeProvider> with syncMethod="value" mirrors the
                active hover cursor across all three, and each chart renders a
                persistent <ReferenceLine> at the last hovered timestamp via
                useSyncedReferenceLineX. */}
          <ChartTimeRangeProvider syncId="charging.session" syncMethod="value">
            {/* ── 8. SoC / Energy / Range over time ──────────────── */}
            <GlassPanel style={styles.panel}>
              <AppText style={styles.panelHeading} weight="semibold">
                {t(
                  'charging.detail.socOverTime',
                  'SoC, Energy & Range over Time',
                )}
              </AppText>
              {timeSeriesData.length > 0 ? (
                <ChargingChartSync>
                  {({ sync, syncedX }) => (
                    <ResponsiveContainer height={320} width="100%">
                      <ComposedChart
                        data={timeSeriesData}
                        margin={chartMargin}
                        onMouseMove={sync.onMouseMove}
                        syncId={sync.syncId}
                        syncMethod={sync.syncMethod}
                      >
                        {areaGradient('socGrad', '#10b981')}
                        {chartGrid}
                        <XAxis dataKey="time" tick={axisTickSm} />
                        <YAxis
                          domain={[0, 100]}
                          tick={axisTickSm}
                          yAxisId="left"
                        />
                        <YAxis
                          orientation="right"
                          tick={axisTickSm}
                          yAxisId="right"
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <Area
                          {...AREA_DEFAULTS}
                          dataKey="soc"
                          fill="url(#socGrad)"
                          name={t('charging.detail.soc', 'SoC')}
                          stroke="#10b981"
                          unit=" %"
                          yAxisId="left"
                        />
                        <Line
                          {...AREA_DEFAULTS}
                          dataKey="energy"
                          name={t('charging.detail.energy', 'Energy')}
                          stroke="#00f0ff"
                          unit=" kWh"
                          yAxisId="right"
                        />
                        <Line
                          {...AREA_DEFAULTS}
                          dataKey="range"
                          name={t('charging.detail.range', 'Range')}
                          stroke="#f59e0b"
                          unit={` ${distanceUnit}`}
                          yAxisId="right"
                        />
                        {syncedX != null ? (
                          <ReferenceLine
                            ifOverflow="hidden"
                            isFront
                            stroke={chartTokens.cursor.stroke}
                            strokeDasharray={chartTokens.cursor.strokeDasharray}
                            strokeWidth={chartTokens.cursor.strokeWidth}
                            x={syncedX}
                            yAxisId="left"
                          />
                        ) : null}
                        {/* Brush lets users zoom into a portion of the charge
                            timeline; recharts propagates the visible window to
                            every other chart sharing this provider's syncId. */}
                        <ChartBrush dataKey="time" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </ChargingChartSync>
              ) : (
                <EmptyState
                  icon="📈"
                  message={t('common.noData', 'No data available')}
                />
              )}
            </GlassPanel>

            {/* ── 9. Temperature chart ───────────────────────────── */}
            <GlassPanel style={styles.panel}>
              <AppText style={styles.panelHeading} weight="semibold">
                {t('charging.detail.temperature', 'Temperature')}
              </AppText>
              {tempData.length > 0 ? (
                <ChargingChartSync>
                  {({ sync, syncedX }) => (
                    <ResponsiveContainer height={240} width="100%">
                      <ComposedChart
                        data={tempData}
                        margin={chartMargin}
                        onMouseMove={sync.onMouseMove}
                        syncId={sync.syncId}
                        syncMethod={sync.syncMethod}
                      >
                        {chartGrid}
                        <XAxis dataKey="time" tick={axisTickSm} />
                        <YAxis tick={axisTickSm} unit={` ${tempUnit}`} />
                        <Tooltip content={<ChartTooltip />} />
                        <Line
                          {...AREA_DEFAULTS}
                          dataKey="battery"
                          name={t('charging.detail.batteryTemp', 'Battery')}
                          stroke="#ef4444"
                          unit={` ${tempUnit}`}
                        />
                        <Line
                          {...AREA_DEFAULTS}
                          dataKey="inside"
                          name={t('charging.detail.insideTemp', 'Inside')}
                          stroke="#f59e0b"
                          unit={` ${tempUnit}`}
                        />
                        <Line
                          {...AREA_DEFAULTS}
                          dataKey="outside"
                          name={t('charging.detail.outsideTemp', 'Outside')}
                          stroke="#3b82f6"
                          unit={` ${tempUnit}`}
                        />
                        {syncedX != null ? (
                          <ReferenceLine
                            ifOverflow="hidden"
                            isFront
                            stroke={chartTokens.cursor.stroke}
                            strokeDasharray={chartTokens.cursor.strokeDasharray}
                            strokeWidth={chartTokens.cursor.strokeWidth}
                            x={syncedX}
                          />
                        ) : null}
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </ChargingChartSync>
              ) : (
                <EmptyState
                  icon="📈"
                  message={t('common.noData', 'No data available')}
                />
              )}
            </GlassPanel>

            {/* ── 10. Voltage & Current chart ────────────────────── */}
            <GlassPanel style={styles.panel}>
              <AppText style={styles.panelHeading} weight="semibold">
                {t('charging.detail.voltageCurrent', 'Voltage & Current')}
              </AppText>
              {voltCurrentData.length > 0 ? (
                <ChargingChartSync>
                  {({ sync, syncedX }) => (
                    <ResponsiveContainer height={240} width="100%">
                      <ComposedChart
                        data={voltCurrentData}
                        margin={chartMargin}
                        onMouseMove={sync.onMouseMove}
                        syncId={sync.syncId}
                        syncMethod={sync.syncMethod}
                      >
                        {chartGrid}
                        <XAxis dataKey="time" tick={axisTickSm} />
                        <YAxis tick={axisTickSm} unit=" V" yAxisId="v" />
                        <YAxis
                          orientation="right"
                          tick={axisTickSm}
                          unit=" A"
                          yAxisId="a"
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <Line
                          {...AREA_DEFAULTS}
                          dataKey="voltage"
                          name={t('charging.detail.voltage', 'Voltage')}
                          stroke="#f59e0b"
                          unit=" V"
                          yAxisId="v"
                        />
                        <Line
                          {...AREA_DEFAULTS}
                          dataKey="current"
                          name={t('charging.detail.current', 'Current')}
                          stroke="#06b6d4"
                          unit=" A"
                          yAxisId="a"
                        />
                        {syncedX != null ? (
                          <ReferenceLine
                            ifOverflow="hidden"
                            isFront
                            stroke={chartTokens.cursor.stroke}
                            strokeDasharray={chartTokens.cursor.strokeDasharray}
                            strokeWidth={chartTokens.cursor.strokeWidth}
                            x={syncedX}
                            yAxisId="v"
                          />
                        ) : null}
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </ChargingChartSync>
              ) : (
                <EmptyState
                  icon="📈"
                  message={t('common.noData', 'No data available')}
                />
              )}
            </GlassPanel>
          </ChartTimeRangeProvider>

          {/* ── 11. Temperature summary fallback — removed: inside_temp_avg/outside_temp_avg no longer in session */}

          {/* ── 11b. Advanced charging parameters (live state) ─── */}
          <GlassPanel style={styles.panel}>
            <AppText style={styles.panelHeadingTight} weight="semibold">
              {t('charging.detail.advanced', 'Advanced Charging Parameters')}
            </AppText>
            <AppText style={styles.advancedHint} tone="muted" variant="caption">
              {t(
                'charging.detail.advancedHint',
                'Latest reported values from the vehicle.',
              )}
            </AppText>
            {liveCharging ? (
              <KVList
                columns={2}
                items={[
                  {
                    label: t('charging.detail.chargingState', 'Charging State'),
                    value:
                      liveCharging.charging_state != null &&
                      liveCharging.charging_state !== ''
                        ? liveCharging.charging_state
                        : '—',
                  },
                  {
                    label: t(
                      'charging.detail.chargerVoltage',
                      'Charger Voltage',
                    ),
                    value:
                      liveCharging.charger_voltage != null
                        ? fmtWithUnit(liveCharging.charger_voltage, 'V', 0)
                        : '—',
                  },
                  {
                    label: t(
                      'charging.detail.chargerActualCurrent',
                      'Active Charge Current',
                    ),
                    value:
                      liveCharging.charger_actual_current != null
                        ? fmtWithUnit(
                            liveCharging.charger_actual_current,
                            'A',
                            1,
                          )
                        : '—',
                  },
                  {
                    label: t(
                      'charging.detail.chargerPilotCurrent',
                      'Pilot Current',
                    ),
                    value:
                      liveCharging.charger_pilot_current != null
                        ? fmtWithUnit(
                            liveCharging.charger_pilot_current,
                            'A',
                            1,
                          )
                        : '—',
                  },
                  {
                    label: t('charging.detail.chargerPowerKw', 'Charger Power'),
                    value:
                      liveCharging.charger_power_w != null
                        ? fmtWithUnit(liveCharging.charger_power_w, 'kW', 1)
                        : '—',
                  },
                  {
                    label: t('charging.detail.chargerPhases', 'Phases'),
                    value:
                      liveCharging.charger_phases != null
                        ? String(liveCharging.charger_phases)
                        : '—',
                  },
                  {
                    label: t('charging.detail.batteryRange', 'Battery Range'),
                    value:
                      liveCharging.battery_range_mi != null
                        ? fmtWithUnit(
                            toDistanceDisplay(liveCharging.battery_range_mi),
                            distanceUnit,
                            0,
                          )
                        : '—',
                  },
                  {
                    label: t('charging.detail.chargeRate', 'Charge Rate'),
                    value:
                      liveCharging.range_added_meters_per_hour != null
                        ? fmtWithUnit(
                            toDistanceDisplay(
                              liveCharging.range_added_meters_per_hour,
                            ),
                            `${distanceUnit}/h`,
                            1,
                          )
                        : '—',
                  },
                  {
                    label: t(
                      'charging.detail.chargeEnergyAdded',
                      'Energy Added',
                    ),
                    value:
                      liveCharging.charge_energy_added_wh != null
                        ? fmtWithUnit(
                            liveCharging.charge_energy_added_wh,
                            'kWh',
                            2,
                          )
                        : '—',
                  },
                  {
                    label: t('charging.detail.chargeMilesAdded', 'Range Added'),
                    value:
                      liveCharging.range_added_meters_per_hour != null
                        ? fmtWithUnit(
                            toDistanceDisplay(
                              (liveCharging.range_added_meters_per_hour ?? 0) /
                                1000,
                            ),
                            distanceUnit,
                            1,
                          )
                        : '—',
                  },
                ]}
              />
            ) : (
              <AppText style={styles.noLiveText} tone="muted">
                {t(
                  'charging.detail.noLiveData',
                  'No live charging telemetry available.',
                )}
              </AppText>
            )}
          </GlassPanel>

          {/* ── 12. Timestamps footer ──────────────────────────── */}
          <GlassPanel style={styles.panel}>
            <View style={styles.footerGrid}>
              <View style={styles.footerCell}>
                <AppText style={styles.footerLabel} tone="muted">
                  {t('charging.detail.started', 'Started')}
                </AppText>
                <DateTime in="vehicle" showTz value={session.started_at} />
              </View>
              <View style={styles.footerCell}>
                <AppText style={styles.footerLabel} tone="muted">
                  {t('charging.detail.ended', 'Ended')}
                </AppText>
                {session.ended_at ? (
                  <DateTime in="vehicle" showTz value={session.ended_at} />
                ) : (
                  <AppText style={styles.footerValue}>—</AppText>
                )}
              </View>
            </View>
          </GlassPanel>
        </FadeIn>
      </ScrollView>
    </PageContainer>
  );
}

ChargingDetailPage.displayName = 'ChargingDetailPage';

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  advancedHint: {
    marginBottom: spacing.md,
  },
  aiSection: {
    marginBottom: spacing.lg,
  },
  backIcon: {
    color: colors.textMuted,
    fontSize: 20,
  },
  barStack: {
    gap: spacing.md,
  },
  body: {
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  emptyIcon: {
    fontSize: 28,
    marginBottom: spacing.sm,
    opacity: 0.4,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  estimatedNote: {
    fontSize: 11,
  },
  footerCell: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 160,
  },
  footerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  footerLabel: {
    fontSize: 13,
  },
  footerValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  gaugePanel: {
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingVertical: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  headerTitle: {
    color: colors.textPrimary,
  },
  headerVehicle: {
    fontSize: 13,
  },
  helpIcon: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    fontSize: 12,
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 1,
    textAlign: 'center',
  },
  inlineGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  inlineMetric: {
    alignItems: 'center',
    flexBasis: '44%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 150,
  },
  inlineMetricIcon: {
    fontSize: 13,
  },
  inlineMetricText: {
    fontSize: 12,
  },
  kvGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  kvLabel: {
    flexShrink: 1,
    fontSize: 14,
  },
  kvRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  kvRowHalf: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 160,
  },
  kvValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
  },
  liveChip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  liveDot: {
    backgroundColor: colors.textMuted,
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  liveGlyph: {
    color: colors.textMuted,
    fontSize: 12,
  },
  liveLabel: {
    fontSize: 12,
  },
  locationText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  metricBarFill: {
    borderRadius: 999,
    height: '100%',
  },
  metricBarHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  metricBarLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  metricBarTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  metricBarValue: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  noLiveText: {
    fontSize: 14,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelHeading: {
    color: colors.textPrimary,
    fontSize: 18,
  },
  panelHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  panelHeadingTight: {
    color: colors.textPrimary,
    fontSize: 18,
  },
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: '44%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 150,
    padding: spacing.md,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCardIcon: {
    fontSize: 14,
  },
  statCardLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  statCardSublabel: {
    fontSize: 11,
  },
  statCardUnit: {
    fontSize: 13,
  },
  statCardValue: {
    color: colors.textPrimary,
    fontSize: 22,
  },
  statCardValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  skelCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: '44%',
    flexGrow: 1,
    minWidth: 150,
    padding: spacing.md,
  },
  skelCardValue: {
    marginTop: spacing.sm,
  },
  skelChart: {
    gap: spacing.md,
  },
  skelChartBody: {
    borderRadius: 12,
  },
  skelHeader: {
    gap: spacing.sm,
  },
  skelRoot: {
    gap: spacing.xl,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
  },
  threeCol: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  threeColCell: {
    alignItems: 'center',
    flex: 1,
  },
  threeColLabel: {
    fontSize: 13,
    textAlign: 'center',
  },
  threeColValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  threeColValueRow: {
    flexDirection: 'row',
  },
});
