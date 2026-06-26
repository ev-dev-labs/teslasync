// Native parity port of web/src/features/driving/pages/DriveDetailPage.tsx.
//
// `DriveDetailPage` is the single-drive deep dive. It resolves the `:id` route
// param, fans it into `useDriveDetailData` (the per-drive aggregation hook that
// derives chartData, stats, the route trail + speed segments, and the speed
// histogram), then orchestrates ~18 sections wrapped in per-section error
// boundaries: a header (back / replay / share), an optional "no telemetry"
// banner, hero RadialGauges, a timeline bar, eight stat cards, the AI drive
// coaching surface, a more-details panel, an energy summary, a cost & savings
// panel, the route map, a journey-details panel, six time-synced charts
// (overview / SoC / elevation / temperature / speed-histogram / power) wrapped
// in a ChartTimeRangeProvider, the AI speed-profile insights surface, a tire-
// pressure section, a "why did this drive end?" diagnostic, and the share
// dialog. Every state name (`id`, `shareDialogOpen`, `drive`, `vehicle`,
// `isLoading`, `error`, `chartData`, `stats`, `trail`, `startPos`, `endPos`,
// `centerPos`, `speedSegments`, `speedHistData`, `hasTelemetryRows`,
// `hasMeaningfulDriveStats`, and every sub-component's internal state), every
// API path (via the reused hooks: `/drives/{id}`, `/drives/{id}/why-ended`,
// `/vehicles/{id}`, `/settings`, `/shares`), the SI unit handling (display-
// boundary conversion only), and every i18n key + English fallback are
// preserved verbatim from the source files.
//
// This page delegates to ~20 sibling source files under
// web/src/features/driving/components/drive-detail/* (the data hook + 18
// components + types/constants/helpers) plus ../components/ShareDriveDialog.
// Those siblings have not been converted to native yet, so — matching the
// established self-contained page precedent (ChargingDetailPage,
// BatteryCellsPage) — each is ported as a local native component/hook in this
// file, mirroring its web public API. Later per-file conversions are expected
// to extract these into sibling native files and slim this page to imports.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4-7), each documented in the parity sidecar:
//   - react-router-dom `useParams` / `<Link>` -> a native `useParams` shim
//     (reads an optional `id` prop a native navigator passes) + Pressable +
//     Linking.openURL for the back/replay affordances (internal SPA routes
//     resolve only with a registered deep-link handler).
//   - react-i18next `useTranslation` -> a local key-preserving shim supporting
//     `t(key,'English')` and `t(key,{defaultValue,...params})` with {{token}}
//     interpolation.
//   - `@/hooks/usePageTitle` -> a documented native-safe no-op (no DOM
//     document.title; the title flows into PageContainer's header).
//   - `@/hooks/useUnits` / `@/hooks/useFormatting` / `@/hooks/useSettings` ->
//     local shims over the reused web-parity `useSettings` query, reproducing
//     only the unit/format surfaces this page reads.
//   - `@/lib/unitConversion` SI converters, `@/lib/numberFormat`,
//     `@/lib/dateFormat`, `@/lib/geo`, `@/lib/tokens` chartTokens, and the
//     drive-detail `helpers`/`constants`/`types` -> inlined verbatim.
//   - `@/components/layout` PageContainer, `@/components/ui` PrintButton,
//     `@/components/charts` (RadialGauge + recharts-shaped primitives +
//     ChartTimeRangeProvider + synced-cursor hooks), `@/components/motion`
//     (FadeIn/StaggerContainer/StaggerItem), and `@/components/ai`
//     (AIDriveCoaching/AISpeedProfileInsights) -> the reused web-parity ports.
//   - `@/components/ui` GlassPanel/Button/Modal/Select/Toggle/Input/DataTable +
//     `@/components/data-display` AnimatedNumber/DateTime/Timeline/TimeStamp +
//     `@/components/feedback` SectionErrorBoundary/AlertBanner/EmptyState/
//     Spinner/Skeleton -> local native components mirroring each web public API.
//   - `@/components/maps` Leaflet `MapContainer`/`Polyline`/`CircleMarker`/etc.
//     -> the interactive map is UNAVAILABLE on native (no Leaflet/DOM); the
//     RouteMapSection renders a native-safe placeholder that preserves the
//     title, the has-route/empty branches, the start/end timestamps, the speed-
//     band legend, and the stationary-route banner (documented in the sidecar).
//   - lucide-react icons -> decorative emoji glyphs via `Glyph`
//     (accessibility-hidden); the adjacent label always carries the meaning.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported. Tailwind maps to StyleSheet; responsive `grid`
// panels resolve mobile-first to flex-wrap rows; `--text-*` CSS vars map to the
// AppText tones; the long page body is wrapped in a ScrollView so every section
// stays reachable.

import React, {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import { PageContainer } from '../../../components/layout/PageContainer';
import { PrintButton } from '../../../components/ui/PrintButton';
import { AIDriveCoaching } from '../../../components/ai/AIDriveCoaching';
import { AISpeedProfileInsights } from '../../../components/ai/AISpeedProfileInsights';
import { FadeIn, StaggerContainer, StaggerItem } from '../../../components/motion';
import {
  AREA_DEFAULTS,
  Area,
  AreaChart,
  areaGradient,
  Bar,
  BarChart,
  CartesianGrid,
  ChartBrush,
  ChartContainer,
  ChartTimeRangeProvider,
  ChartTooltip,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  RadialGauge,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  useSyncedCursor,
  useSyncedReferenceLineX,
  XAxis,
  YAxis,
} from '../../../components/charts';
import {
  useDrive,
  useDriveWhyEnded,
  type DriveDetail,
  type DriveDiagnosticSignal,
  type DriveDiagnosticTransition,
  type DriveDiagnosticWindow,
} from '../../../api/hooks/useDriving';
import { useVehicle } from '../../../api/hooks/useVehicles';
import { useSettings } from '../../../api/hooks/useSettings';
import {
  useCreateShareLink,
  useRevokeShareLink,
  useShareLinks,
} from '../../../api/hooks/useSharing';

/* ─── i18n shim (react-i18next) ────────────────────────────────── */
// i18next returns the KEY when no translation exists; this resolves the inline
// English fallback while keeping the key at every call site. Supports the two
// source call shapes: `t(key,'English')` and `t(key,{defaultValue,...params})`
// with `{{token}}` interpolation.
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

function translate(key: string, fallback?: string | TOptions, params?: TParams): string {
  if (fallback == null) {
    return key;
  }
  if (typeof fallback === 'string') {
    return params ? interpolate(fallback, params) : fallback;
  }
  const { defaultValue, ...rest } = fallback;
  return interpolate(defaultValue ?? key, rest);
}

function useTranslation(): { t: typeof translate } {
  return { t: translate };
}

/* ─── usePageTitle shim ────────────────────────────────────────── */
// The web hook writes document.title; native has no DOM document, so this is a
// documented native-safe no-op. The translated title still flows into
// PageContainer as the on-screen header.
function usePageTitle(title: string): void {
  useEffect(() => undefined, [title]);
}

/* ─── useParams shim (react-router-dom) ────────────────────────── */
// The web read the `:id` route param. Native has no DOM router, so the id
// arrives via the optional component prop (passed by a native navigator).
// A missing id yields the loading state, matching the web pre-fetch render.
function useParams(idFromProps?: string): { id?: string } {
  return { id: idFromProps };
}

/* ─── numberFormat (inlined from @/lib/numberFormat) ───────────── */
// safeNumber collapses nullish/non-finite to 0; fmtNumber is the locale-aware
// fixed-precision formatter (default precision 2, en-US); fmtInt/fmtWithUnit/
// fmtPercent mirror the web helpers.
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

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

function fmtPercent(v: unknown, decimals?: number): string {
  return `${fmtNumber(v, decimals)}%`;
}

/* ─── dateFormat (inlined from @/lib/dateFormat) ───────────────── */
// All return the universal '—' placeholder for unrenderable input.
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

/* ─── unitConversion SI converters (inlined from @/lib/unitConversion) ── */
type DistanceUnitPref = 'km' | 'mi' | 'ft';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '°C' | '°F';
type PressureUnitPref = 'kPa' | 'psi' | 'bar';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;
const KPA_PER_PSI = 6.894757;
const KPA_PER_BAR = 100;
const SECONDS_PER_HOUR = 3600;
const GALLONS_TO_LITERS = 3.78541;

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
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
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

/* ─── useUnits shim (@/hooks/useUnits) ─────────────────────────── */
// Derives distance/speed from `unit_of_length`, temperature from `unit_of_temp`,
// pressure from `unit_of_pressure`, mirroring the web hook's derivation exactly.
interface UnitPrefsShape {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
  pressure: PressureUnitPref;
}

function useUnits(): { unitPrefs: UnitPrefsShape } {
  const { data: settings } = useSettings();
  const distance: DistanceUnitPref =
    settings?.unit_of_length === 'mi' ? 'mi' : 'km';
  const speed: SpeedUnitPref =
    settings?.unit_of_length === 'mi' ? 'mph' : 'km/h';
  const temperature: TemperatureUnitPref =
    settings?.unit_of_temp === 'F' ? '°F' : '°C';
  const pressure: PressureUnitPref =
    settings?.unit_of_pressure === 'psi' ? 'psi' : 'bar';

  return useMemo(
    () => ({ unitPrefs: { distance, speed, temperature, pressure } }),
    [distance, speed, temperature, pressure],
  );
}

/* ─── useFormatting shim (@/hooks/useFormatting) ───────────────── */
// Reproduces the cost/currency surface this page reads: costPerKwh
// (base_cost_per_kwh, default 0.12), currencySymbol (default '$'),
// formatEnergyCost, formatCurrency, costPerDistanceUnit (SI meters), and
// estimateGasCost (mpg + gas_price_per_unit, with the gallon->liter bridge).
interface UseFormattingResult {
  costPerKwh: number;
  currencySymbol: string;
  formatEnergyCost: (kwh: number) => string;
  formatCurrency: (amount: number, decimals?: number) => string;
  costPerDistanceUnit: (kwh: number, distanceM: number) => number | null;
  estimateGasCost: (distanceM: number) => number | null;
}

function useFormatting(): UseFormattingResult {
  const { data: settings } = useSettings();
  const { unitPrefs } = useUnits();

  const costPerKwh = settings?.base_cost_per_kwh ?? 0.12;
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;
  const distancePref = unitPrefs.distance;
  const gasMpg = settings?.gas_efficiency_mpg ?? 0;
  const gasPrice = settings?.gas_price_per_unit ?? 0;
  const gasUnit = settings?.gas_unit ?? 'gallon';

  const formatEnergyCost = useCallback(
    (kwh: number): string => `${currencySymbol}${fmtNumber(kwh * costPerKwh, userPrecision)}`,
    [costPerKwh, currencySymbol, userPrecision],
  );

  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );

  const costPerDistanceUnit = useCallback(
    (kwh: number, distanceM: number): number | null => {
      if (distanceM <= 0) {
        return null;
      }
      const cost = kwh * costPerKwh;
      const distance = convertDistanceFromSI(distanceM, distancePref);
      return distance > 0 ? cost / distance : null;
    },
    [costPerKwh, distancePref],
  );

  const estimateGasCost = useCallback(
    (distanceM: number): number | null => {
      if (gasMpg <= 0 || gasPrice <= 0 || distanceM <= 0) {
        return null;
      }
      const distanceMi = convertDistanceFromSI(distanceM, 'mi');
      const gallonsUsed = distanceMi / gasMpg;
      if (gasUnit === 'liter') {
        return gallonsUsed * GALLONS_TO_LITERS * gasPrice;
      }
      return gallonsUsed * gasPrice;
    },
    [gasMpg, gasPrice, gasUnit],
  );

  return useMemo(
    () => ({
      costPerKwh,
      currencySymbol,
      formatEnergyCost,
      formatCurrency,
      costPerDistanceUnit,
      estimateGasCost,
    }),
    [
      costPerKwh,
      currencySymbol,
      formatEnergyCost,
      formatCurrency,
      costPerDistanceUnit,
      estimateGasCost,
    ],
  );
}

/* ─── chartTokens (inlined from @/lib/tokens) ──────────────────── */
// Only the `cursor` sub-object is read. The native ReferenceLine renders a
// placeholder and ignores the stroke props, but they are passed faithfully.
const chartTokens = {
  cursor: {
    stroke: 'rgba(255, 255, 255, 0.3)',
    strokeWidth: 1,
    strokeDasharray: '4 2',
  },
} as const;

/* ─── helpers + constants (inlined from drive-detail/{helpers,constants}) ── */
function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const LEGEND_STYLE = { fontSize: 10, color: '#9ca3af' } as const;

// Route-map speed-colour thresholds in SI (m/s) — 30 / 60 / 100 mph.
const SPEED_SEGMENT_LOW_MPS = 30 * 0.44704;
const SPEED_SEGMENT_MED_MPS = 60 * 0.44704;
const SPEED_SEGMENT_HIGH_MPS = 100 * 0.44704;

/* ─── geo (inlined from @/lib/geo) ─────────────────────────────── */
const MIN_MEANINGFUL_ROUTE_METERS = 10;

interface LatLngLike {
  latitude: number;
  longitude: number;
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isValidLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  if (lat === 0 && lng === 0) {
    return false;
  }
  if (lat < -90 || lat > 90) {
    return false;
  }
  if (lng < -180 || lng > 180) {
    return false;
  }
  return true;
}

function hasMeaningfulRoute(positions: readonly LatLngLike[]): boolean {
  let anchorIdx = -1;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (isValidLatLng(p.latitude, p.longitude)) {
      anchorIdx = i;
      break;
    }
  }
  if (anchorIdx < 0) {
    return false;
  }
  const anchor = positions[anchorIdx];
  for (let i = anchorIdx + 1; i < positions.length; i++) {
    const p = positions[i];
    if (!isValidLatLng(p.latitude, p.longitude)) {
      continue;
    }
    const d = haversineDistance(
      anchor.latitude,
      anchor.longitude,
      p.latitude,
      p.longitude,
    );
    if (d >= MIN_MEANINGFUL_ROUTE_METERS) {
      return true;
    }
  }
  return false;
}

function firstValidIndex(positions: readonly LatLngLike[]): number {
  for (let i = 0; i < positions.length; i++) {
    if (isValidLatLng(positions[i].latitude, positions[i].longitude)) {
      return i;
    }
  }
  return -1;
}

/* ─── drive-detail types (inlined from drive-detail/types) ─────── */
type LatLng = [number, number];

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

interface RoutePoint {
  lat: number;
  lng: number;
  speed: number;
}

interface SpeedSegment {
  positions: LatLng[];
  color: string;
}

interface SpeedHistogramBucket {
  range: string;
  pct: number;
}

/* ─── useDriveDetailData (inlined from drive-detail/useDriveDetailData) ── */
// Derives the route trail + speed segments, the per-sample chartData (SI ->
// display via the converters above), the computed DriveStats, and the speed
// histogram. The web hook read `useDateFormat().formatTime`; native uses the
// module-level `formatTime` (device locale/zone — vehicle tz resolution is
// UNAVAILABLE on native, documented). All math + field access is verbatim.
function useDriveDetailData(id: string) {
  const { data: drive, isLoading, error } = useDrive(id);
  const { data: vehicle } = useVehicle(String(drive?.vehicleId ?? ''));
  const { unitPrefs } = useUnits();

  const distancePref = unitPrefs.distance;
  const speedPref = unitPrefs.speed;
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, distancePref),
    [distancePref],
  );
  const toSpeedDisplay = useCallback(
    (value: number) => convertSpeedFromSI(value, speedPref),
    [speedPref],
  );

  /* ---- Route data ---- */
  const routeSource = useMemo<RoutePoint[]>(() => {
    if (!drive) {
      return [];
    }
    const tele = drive.telemetry ?? [];
    const pos = drive.positions ?? [];
    if (tele.length > 0) {
      return tele
        .filter(
          (tp) =>
            tp.latitude != null &&
            tp.longitude != null &&
            (tp.latitude !== 0 || tp.longitude !== 0),
        )
        .map((tp) => ({ lat: tp.latitude!, lng: tp.longitude!, speed: tp.speed ?? 0 }));
    }
    return pos
      .filter((p) => p.latitude !== 0 || p.longitude !== 0)
      .map((p) => ({ lat: p.latitude, lng: p.longitude, speed: p.speed ?? 0 }));
  }, [drive]);

  const trail = useMemo<LatLng[]>(
    () => routeSource.map((p) => [p.lat, p.lng] as LatLng),
    [routeSource],
  );
  const startPos = trail[0] as LatLng | undefined;
  const endPos = trail.length > 1 ? (trail[trail.length - 1] as LatLng) : undefined;
  const centerPos: LatLng =
    startPos ??
    (drive?.startLat && drive?.startLon
      ? [drive.startLat, drive.startLon]
      : [47.6, -122.3]);

  /* Speed-colored segments (routeSource[i].speed is m/s SI). */
  const speedSegments = useMemo<SpeedSegment[]>(() => {
    const segs: SpeedSegment[] = [];
    for (let i = 1; i < routeSource.length; i++) {
      const prev = routeSource[i - 1];
      const curr = routeSource[i];
      let color = '#10b981';
      if (curr.speed >= SPEED_SEGMENT_HIGH_MPS) {
        color = '#ef4444';
      } else if (curr.speed >= SPEED_SEGMENT_MED_MPS) {
        color = '#f59e0b';
      } else if (curr.speed >= SPEED_SEGMENT_LOW_MPS) {
        color = '#00f0ff';
      }
      segs.push({
        positions: [
          [prev.lat, prev.lng],
          [curr.lat, curr.lng],
        ],
        color,
      });
    }
    return segs;
  }, [routeSource]);

  /* ---- Chart data ---- */
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!drive) {
      return [];
    }
    const tele = drive.telemetry ?? [];
    if (tele.length > 0) {
      return tele.map((tp) => ({
        time: formatTime(tp.createdAt ?? tp.created_at ?? tp.timestamp),
        speed: convertSpeedFromSI(tp.speed ?? 0, unitPrefs.speed),
        battery: tp.batteryLevel ?? 0,
        elevation: tp.elevation ?? 0,
        power: tp.power ?? 0,
        outsideTemp:
          tp.outsideTemp != null
            ? convertTempFromSI(tp.outsideTemp, unitPrefs.temperature)
            : null,
        insideTemp:
          tp.insideTemp != null
            ? convertTempFromSI(tp.insideTemp, unitPrefs.temperature)
            : null,
        driverTemp:
          tp.driverTemp != null
            ? convertTempFromSI(tp.driverTemp, unitPrefs.temperature)
            : null,
        passengerTemp:
          tp.passengerTemp != null
            ? convertTempFromSI(tp.passengerTemp, unitPrefs.temperature)
            : null,
        idealRange:
          tp.idealRange != null
            ? convertDistanceFromSI(tp.idealRange, unitPrefs.distance)
            : null,
        ratedRange:
          tp.ratedRange != null
            ? convertDistanceFromSI(tp.ratedRange, unitPrefs.distance)
            : null,
        estRange:
          tp.estRange != null
            ? convertDistanceFromSI(tp.estRange, unitPrefs.distance)
            : null,
        odometer:
          tp.odometer != null
            ? convertDistanceFromSI(tp.odometer, unitPrefs.distance)
            : null,
        soc: tp.soc,
        usableSoc: tp.usableSoc,
        tireFl:
          tp.tirePressureFl != null
            ? convertPressureFromSI(tp.tirePressureFl / 1000, unitPrefs.pressure)
            : null,
        tireFr:
          tp.tirePressureFr != null
            ? convertPressureFromSI(tp.tirePressureFr / 1000, unitPrefs.pressure)
            : null,
        tireRl:
          tp.tirePressureRl != null
            ? convertPressureFromSI(tp.tirePressureRl / 1000, unitPrefs.pressure)
            : null,
        tireRr:
          tp.tirePressureRr != null
            ? convertPressureFromSI(tp.tirePressureRr / 1000, unitPrefs.pressure)
            : null,
        climateOn: tp.isClimateOn ?? null,
        fanStatus: tp.fanStatus ?? null,
      }));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- positions may have snake_case fallback fields
    return (drive.positions ?? []).map((p: any) => ({
      time: formatTime(p.createdAt ?? p.created_at ?? p.timestamp),
      speed: convertSpeedFromSI(p.speed ?? 0, unitPrefs.speed),
      battery: p.batteryLevel ?? p.battery_level ?? 0,
      elevation: p.elevation ?? 0,
      power: p.power ?? 0,
      outsideTemp:
        (p.outsideTemp ?? p.outside_temp) != null
          ? convertTempFromSI(p.outsideTemp ?? p.outside_temp, unitPrefs.temperature)
          : null,
      insideTemp:
        (p.insideTemp ?? p.inside_temp) != null
          ? convertTempFromSI(p.insideTemp ?? p.inside_temp, unitPrefs.temperature)
          : null,
      driverTemp: null as number | null,
      passengerTemp: null as number | null,
      idealRange:
        (p.idealRange ?? p.ideal_range) != null
          ? convertDistanceFromSI(p.idealRange ?? p.ideal_range, unitPrefs.distance)
          : null,
      ratedRange:
        (p.ratedRange ?? p.rated_range) != null
          ? convertDistanceFromSI(p.ratedRange ?? p.rated_range, unitPrefs.distance)
          : null,
      estRange: null as number | null,
      odometer:
        p.odometer != null
          ? convertDistanceFromSI(p.odometer, unitPrefs.distance)
          : null,
      soc: null as number | null,
      usableSoc: null as number | null,
      tireFl: null as number | null,
      tireFr: null as number | null,
      tireRl: null as number | null,
      tireRr: null as number | null,
      climateOn: p.isClimateOn ?? null,
      fanStatus: p.fanStatus ?? null,
    }));
  }, [
    drive,
    unitPrefs.speed,
    unitPrefs.temperature,
    unitPrefs.distance,
    unitPrefs.pressure,
  ]);

  /* ---- Computed stats ---- */
  const stats = useMemo<DriveStats | null>(() => {
    if (!drive) {
      return null;
    }
    const maxSpd = drive.maxSpeedMps != null ? toSpeedDisplay(drive.maxSpeedMps) : 0;
    const avgSpd = drive.avgSpeedMps != null ? toSpeedDisplay(drive.avgSpeedMps) : 0;
    const movingSpeeds = chartData.map((d) => d.speed).filter((s) => s > 0);
    const minSpd = movingSpeeds.length > 0 ? Math.min(...movingSpeeds) : 0;
    const powerValues = chartData.map((d) => d.power).filter((p) => p !== 0);
    const powerMax =
      powerValues.length > 0 ? Math.max(...powerValues) : (drive.avgPowerW ?? 0) / 1000;
    const powerMin = powerValues.length > 0 ? Math.min(...powerValues) : 0;
    const avgPower =
      drive.avgPowerW != null
        ? drive.avgPowerW / 1000
        : chartData.length > 0
          ? chartData.reduce((s, d) => s + d.power, 0) / chartData.length
          : 0;
    const durationH = (drive.durationS ?? 0) / 3600;
    const energyWh =
      drive.energyUsedWh != null
        ? drive.energyUsedWh
        : Math.abs(avgPower) * durationH * 1000;
    const regenWh =
      drive.regenEnergyWh != null
        ? drive.regenEnergyWh
        : chartData.length > 0
          ? chartData.filter((d) => d.power < 0).reduce((s, d) => s + Math.abs(d.power), 0) *
            (durationH / chartData.length) *
            1000
          : 0;
    const consumptionWhKm = drive.distanceM > 0 ? energyWh / (drive.distanceM / 1000) : 0;
    const elevGain = chartData.reduce((sum, d, i) => {
      if (i === 0) {
        return 0;
      }
      const diff = d.elevation - chartData[i - 1].elevation;
      return diff > 0 ? sum + diff : sum;
    }, 0);
    const elevLoss = chartData.reduce((sum, d, i) => {
      if (i === 0) {
        return 0;
      }
      const diff = d.elevation - chartData[i - 1].elevation;
      return diff < 0 ? sum + Math.abs(diff) : sum;
    }, 0);

    const outsideTemps = chartData
      .filter((d) => d.outsideTemp !== null)
      .map((d) => d.outsideTemp!);
    const insideTemps = chartData
      .filter((d) => d.insideTemp !== null)
      .map((d) => d.insideTemp!);
    const driverTemps = chartData
      .filter((d) => d.driverTemp !== null)
      .map((d) => d.driverTemp!);
    const passengerTemps = chartData
      .filter((d) => d.passengerTemp !== null)
      .map((d) => d.passengerTemp!);
    const avgOutsideTemp =
      outsideTemps.length > 0
        ? outsideTemps.reduce((a, b) => a + b, 0) / outsideTemps.length
        : null;
    const avgInsideTemp =
      insideTemps.length > 0
        ? insideTemps.reduce((a, b) => a + b, 0) / insideTemps.length
        : null;
    const hasAnyTemp =
      outsideTemps.length > 0 ||
      insideTemps.length > 0 ||
      driverTemps.length > 0 ||
      passengerTemps.length > 0;

    const climateOnCount = chartData.filter((d) => d.climateOn === true).length;
    const climateOffCount = chartData.filter((d) => d.climateOn === false).length;
    const climateStatus =
      climateOnCount > 0
        ? climateOnCount >= climateOffCount
          ? 'On'
          : 'Mostly Off'
        : climateOffCount > 0
          ? 'Off'
          : null;
    const fanValues = chartData
      .map((d) => d.fanStatus)
      .filter((v): v is number => v != null);
    const avgFanSpeed =
      fanValues.length > 0 ? fanValues.reduce((a, b) => a + b, 0) / fanValues.length : null;
    const maxFanSpeed = fanValues.length > 0 ? Math.max(...fanValues) : null;

    const firstWithRange = chartData.find(
      (d) => d.idealRange != null || d.ratedRange != null,
    );
    const lastWithRange = [...chartData]
      .reverse()
      .find((d) => d.idealRange != null || d.ratedRange != null);
    const startRange = firstWithRange
      ? firstWithRange.idealRange ?? firstWithRange.ratedRange
      : null;
    const endRange = lastWithRange
      ? lastWithRange.idealRange ?? lastWithRange.ratedRange
      : null;

    const firstOdometer =
      chartData.find((d) => d.odometer != null && d.odometer > 0)?.odometer ?? null;
    const lastOdometer =
      [...chartData].reverse().find((d) => d.odometer != null && d.odometer > 0)?.odometer ??
      null;
    const odometerStart = firstOdometer ?? 0;
    const odometerEnd = lastOdometer ?? 0;

    const hasTirePressure = chartData.some(
      (d) => d.tireFl !== null || d.tireFr !== null || d.tireRl !== null || d.tireRr !== null,
    );

    const efficiencyPctPer100 =
      drive.distanceM > 0 && drive.startBatteryPct != null && drive.endBatteryPct != null
        ? ((drive.startBatteryPct - drive.endBatteryPct) / toDistanceDisplay(drive.distanceM)) *
          10
        : null;

    return {
      maxSpd,
      avgSpd,
      minSpd,
      powerMax,
      powerMin,
      avgPower,
      energyWh,
      regenWh,
      consumptionWhKm,
      elevGain,
      elevLoss,
      avgOutsideTemp,
      avgInsideTemp,
      hasAnyTemp,
      insideTemps,
      outsideTemps,
      driverTemps,
      passengerTemps,
      climateStatus,
      avgFanSpeed,
      maxFanSpeed,
      startRange,
      endRange,
      odometerStart,
      odometerEnd,
      hasTirePressure,
      efficiencyPctPer100,
    };
  }, [drive, chartData, toSpeedDisplay, toDistanceDisplay]);

  /* ---- Speed histogram ---- */
  const speedHistData = useMemo<SpeedHistogramBucket[]>(() => {
    if (chartData.length === 0) {
      return [];
    }
    const defs = [
      { min: 0, max: 20 },
      { min: 20, max: 40 },
      { min: 40, max: 60 },
      { min: 60, max: 80 },
      { min: 80, max: 100 },
      { min: 100, max: 120 },
      { min: 120, max: 9999 },
    ];
    const buckets = defs.map((d) => ({
      range: d.max >= 9999 ? `${fmtNumber(d.min)}+` : `${fmtNumber(d.min)}–${fmtNumber(d.max)}`,
      count: 0,
    }));
    chartData.forEach((d) => {
      const idx = defs.findIndex((def) => d.speed >= def.min && d.speed < def.max);
      if (idx >= 0) {
        buckets[idx].count++;
      }
    });
    return buckets
      .filter((b) => b.count > 0)
      .map((b) => ({
        range: b.range,
        pct: chartData.length > 0 ? Math.round((b.count / chartData.length) * 100) : 0,
      }));
  }, [chartData]);

  return {
    drive: drive ?? null,
    vehicle: vehicle ?? null,
    isLoading,
    error,
    chartData,
    stats,
    trail,
    startPos,
    endPos,
    centerPos,
    speedSegments,
    speedHistData,
  };
}

/* ─── Glyph (lucide-react icons -> decorative emoji) ───────────── */
// Decorative only (accessibility-hidden); the adjacent label carries meaning.
function Glyph({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
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

/* ─── DateTime (web @/components/data-display DateTime) ─────────── */
// The web `in`/`showTz` props resolve a vehicle/user timezone via provider
// hooks; native has no tz provider, so that is UNAVAILABLE — props are accepted
// for source compatibility and the timestamp renders in the device locale/zone.
// `variant` selects date/time/full rendering.
function DateTime({
  value,
  variant = 'full',
  style,
}: {
  value: string | Date | null | undefined;
  variant?: 'full' | 'date' | 'time' | 'relative' | 'short';
  in?: 'vehicle' | 'user' | 'utc';
  showTz?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const text =
    variant === 'date'
      ? formatDate(value)
      : variant === 'time'
        ? formatTime(value)
        : formatDateTime(value);
  return <AppText style={style}>{text}</AppText>;
}

/* ─── AnimatedNumber (web @/components/data-display AnimatedNumber) ── */
// Count-up from 0 to `value` over `duration` seconds (ease-out-quad), via RN
// `Animated` (the web used requestAnimationFrame).
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

/* ─── SectionErrorBoundary (web @/components/feedback) ──────────── */
// Wraps a single section so one section's render crash doesn't take down the
// page. Mirrors the web `name`/`fallbackTitle` contract.
interface SectionErrorBoundaryProps {
  name: string;
  fallbackTitle: string;
  children: ReactNode;
}
interface SectionErrorBoundaryState {
  error: Error | null;
}
class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): SectionErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`section:${this.props.name} render failed`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <GlassPanel accessibilityRole="alert" style={styles.sectionError}>
          <AppText style={styles.sectionErrorTitle} weight="semibold">
            {this.props.fallbackTitle}
          </AppText>
          <AppText tone="muted" variant="caption">
            {this.state.error.message}
          </AppText>
        </GlassPanel>
      );
    }
    return this.props.children;
  }
}

/* ─── AlertBanner (web @/components/feedback AlertBanner) ───────── */
// `variant` tints the leading rail + icon; title is bold, children is the body.
function AlertBanner({
  variant = 'info',
  title,
  icon,
  children,
}: {
  variant?: 'info' | 'warning' | 'danger' | 'success';
  title: string;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const accent =
    variant === 'warning'
      ? colors.warning
      : variant === 'danger'
        ? colors.danger
        : variant === 'success'
          ? colors.success
          : colors.accent;
  return (
    <GlassPanel accessibilityRole="summary" style={[styles.alertBanner, { borderLeftColor: accent }]}>
      <View style={styles.alertHeader}>
        {icon ? <View style={styles.alertIcon}>{icon}</View> : null}
        <AppText style={[styles.alertTitle, { color: accent }]} weight="semibold">
          {title}
        </AppText>
      </View>
      {children ? (
        <AppText style={styles.alertBody} tone="secondary">
          {children}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

/* ─── Spinner (web @/components/feedback Spinner) ───────────────── */
function Spinner() {
  return <ActivityIndicator color={colors.accent} />;
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

/* ─── Metric cell (shared by the detail panels) ────────────────── */
// Mirrors the repeated `<div className="text-center"><p label/><p value/></div>`
// blocks across MoreDetails / EnergySummary / CostSavings panels.
function Metric({
  label,
  color,
  children,
}: {
  label: string;
  color?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.metricCell}>
      <AppText numberOfLines={2} style={styles.metricLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      <AppText style={[styles.metricValue, color ? { color } : null]} weight="bold">
        {children}
      </AppText>
    </View>
  );
}

/* ─── IconStatCard (drive-detail/IconStatCard) ─────────────────── */
function IconStatCard({
  icon,
  color,
  value,
  label,
}: {
  icon: string;
  color: string;
  value: ReactNode;
  label: string;
}) {
  return (
    <GlassPanel style={styles.iconStatCard}>
      <Glyph style={[styles.iconStatIcon, { color }]}>{icon}</Glyph>
      {typeof value === 'string' || typeof value === 'number' ? (
        <AppText style={styles.iconStatValue} weight="bold">
          {String(value)}
        </AppText>
      ) : (
        value
      )}
      <AppText style={styles.iconStatLabel} tone="muted" variant="caption">
        {label}
      </AppText>
    </GlassPanel>
  );
}

/* ─── DriveDetailSkeleton (drive-detail/DriveDetailSkeleton) ────── */
function DriveDetailSkeleton() {
  return (
    <ScrollView contentContainerStyle={styles.body} testID="drive-detail-skeleton">
      <View style={styles.skelHeader}>
        <Skeleton height={28} width="50%" />
        <Skeleton height={16} width="32%" />
      </View>
      <Skeleton height={144} />
      <View style={styles.grid}>
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={i} style={styles.skelCard}>
            <Skeleton height={14} width="60%" />
            <Skeleton height={28} style={styles.skelCardValue} width="44%" />
          </View>
        ))}
      </View>
      <View style={styles.skelChart}>
        <Skeleton height={18} width="38%" />
        <Skeleton height={320} style={styles.skelChartBody} />
      </View>
      <View style={styles.chartGrid}>
        <View style={[styles.skelChart, styles.chartGridItem]}>
          <Skeleton height={18} width="38%" />
          <Skeleton height={280} style={styles.skelChartBody} />
        </View>
        <View style={[styles.skelChart, styles.chartGridItem]}>
          <Skeleton height={18} width="38%" />
          <Skeleton height={280} style={styles.skelChartBody} />
        </View>
      </View>
    </ScrollView>
  );
}

/* ─── DriveDetailHeader (drive-detail/DriveDetailHeader) ────────── */
// The `<Link>` back/replay affordances -> Pressable + Linking.openURL (internal
// SPA routes resolve only with a registered deep-link handler). The web
// `<DateTime>` date/time line is composed as a single locale string (tz/showTz
// UNAVAILABLE on native).
function DriveDetailHeader({
  drive,
  driveId,
  vehicleName,
  onShare,
}: {
  drive: DriveDetail;
  driveId: string;
  vehicleName: string;
  onShare: () => void;
}) {
  const { t } = useTranslation();
  const meta = `${vehicleName} · ${formatDate(drive.startTs)} · ${formatTime(drive.startTs)}${
    drive.endTs ? ` → ${formatTime(drive.endTs)}` : ''
  }`;
  return (
    <FadeIn>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={t('common.back', 'Back')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => Linking.openURL('/drives').catch(() => undefined)}
          style={styles.backButton}
        >
          <Glyph style={styles.backIcon}>←</Glyph>
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <View style={styles.headerTitleRow}>
            <Glyph style={styles.headerTitleIcon}>🛣</Glyph>
            <AppText style={styles.headerTitle} variant="title" weight="bold">
              {drive.startAddress && drive.endAddress
                ? `${drive.startAddress} → ${drive.endAddress}`
                : t('driveDetail.title', 'Drive Details')}
            </AppText>
          </View>
          <AppText style={styles.headerVehicle} tone="muted">
            {meta}
          </AppText>
        </View>
        <Pressable
          accessibilityLabel={t('driveDetail.replay', 'Replay')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => Linking.openURL(`/drives/${driveId}/replay`).catch(() => undefined)}
          style={styles.ghostButton}
        >
          <Glyph style={styles.ghostButtonIcon}>▶</Glyph>
          <AppText style={styles.ghostButtonText} variant="caption" weight="semibold">
            {t('driveDetail.replay', 'Replay')}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityLabel={t('driveDetail.share', 'Share')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onShare}
          style={styles.ghostButton}
        >
          <Glyph style={styles.ghostButtonIcon}>🔗</Glyph>
          <AppText style={styles.ghostButtonText} variant="caption" weight="semibold">
            {t('driveDetail.share', 'Share')}
          </AppText>
        </Pressable>
      </View>
    </FadeIn>
  );
}

/* ─── HeroGauges (drive-detail/HeroGauges) ─────────────────────── */
function HeroGauges({ drive, stats }: { drive: DriveDetail; stats: DriveStats }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const isMiles = unitPrefs.distance === 'mi';
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);
  const toEfficiencyDisplay = (whPerKm: number) =>
    unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  return (
    <FadeIn>
      <GlassPanel style={styles.heroPanel}>
        <View style={styles.heroRow}>
          <RadialGauge
            value={Math.round(toDistanceDisplay(drive.distanceM))}
            max={Math.max(toDistanceDisplay(drive.distanceM) * 1.5, 100)}
            label={t('driveDetail.distance', 'Distance')}
            unit={distanceUnit}
            color="#00f0ff"
            size={110}
          />
          <RadialGauge
            value={Math.round(stats.maxSpd)}
            max={toSpeedDisplay(250)}
            label={t('driveDetail.maxSpeed', 'Max Speed')}
            unit={speedUnit}
            color="#a855f7"
            size={110}
          />
          <RadialGauge
            value={Math.round((drive.durationS ?? 0) / 60)}
            max={Math.max(((drive.durationS ?? 0) / 60) * 1.5, 60)}
            label={t('driveDetail.duration', 'Duration')}
            unit="min"
            color="#f59e0b"
            size={110}
          />
          <RadialGauge
            value={Math.round(toEfficiencyDisplay(stats.consumptionWhKm))}
            max={Math.max(toEfficiencyDisplay(stats.consumptionWhKm) * 1.5, 300)}
            label={t('driveDetail.consumption', 'Consumption')}
            unit={efficiencyUnit}
            color="#ef4444"
            size={110}
          />
          {stats.efficiencyPctPer100 != null ? (
            <RadialGauge
              value={Number(fmtNumber(stats.efficiencyPctPer100))}
              max={30}
              label={t('driveDetail.efficiency', 'Efficiency')}
              unit={isMiles ? '%/100mi' : '%/100km'}
              color="#10b981"
              size={110}
            />
          ) : null}
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── DriveTimeline (drive-detail/DriveTimeline) ───────────────── */
function DriveTimeline({ drive }: { drive: DriveDetail }) {
  const { t } = useTranslation();
  return (
    <FadeIn>
      <GlassPanel style={styles.timelinePanel}>
        <View style={styles.timelineRow}>
          <View style={styles.timelineEnd}>
            <Glyph style={styles.timelineFlagStart}>🏁</Glyph>
            <AppText style={styles.timelineStartText} variant="caption">
              {formatTime(drive.startTs)}
            </AppText>
          </View>
          <AppText tone="muted" variant="caption">
            {formatDuration(drive.durationS / 60)}
          </AppText>
          <View style={styles.timelineEnd}>
            <Glyph style={styles.timelineFlagEnd}>🏁</Glyph>
            <AppText style={styles.timelineEndText} variant="caption">
              {drive.endTs ? formatTime(drive.endTs) : t('driveDetail.inProgress', 'In progress')}
            </AppText>
          </View>
        </View>
        <View style={styles.timelineBarTrack}>
          <View style={styles.timelineBarFill} />
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── DriveStatCards (drive-detail/DriveStatCards + IconStatCard) ── */
function DriveStatCards({ drive, stats }: { drive: DriveDetail; stats: DriveStats }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const { formatEnergyCost, formatCurrency, costPerDistanceUnit } = useFormatting();

  return (
    <StaggerContainer>
      <View style={styles.grid}>
        <StaggerItem>
          <IconStatCard
            icon="🛣"
            color="#00f0ff"
            value={
              <AnimatedNumber
                value={toDistanceDisplay(drive.distanceM)}
                decimals={1}
                suffix={` ${distanceUnit}`}
                style={styles.iconStatValue}
              />
            }
            label={t('driveDetail.distance', 'Distance')}
          />
        </StaggerItem>
        <StaggerItem>
          <IconStatCard
            icon="⏱"
            color="#f59e0b"
            value={formatDuration(drive.durationS / 60)}
            label={t('driveDetail.duration', 'Duration')}
          />
        </StaggerItem>
        <StaggerItem>
          <IconStatCard
            icon="🎚"
            color="#a855f7"
            value={
              <AnimatedNumber
                value={stats.maxSpd}
                suffix={` ${speedUnit}`}
                style={styles.iconStatValue}
              />
            }
            label={t('driveDetail.maxSpeed', 'Max Speed')}
          />
        </StaggerItem>
        <StaggerItem>
          <IconStatCard
            icon="📈"
            color="#10b981"
            value={
              <AnimatedNumber
                value={stats.avgSpd}
                suffix={` ${speedUnit}`}
                style={styles.iconStatValue}
              />
            }
            label={t('driveDetail.avgSpeed', 'Avg Speed')}
          />
        </StaggerItem>
        <StaggerItem>
          <IconStatCard
            icon="🔋"
            color="#10b981"
            value={`${fmtInt(drive.startBatteryPct)}% → ${fmtInt(drive.endBatteryPct)}%`}
            label={t('driveDetail.soc', 'SOC')}
          />
        </StaggerItem>
        <StaggerItem>
          <IconStatCard
            icon="⚡"
            color="#f59e0b"
            value={fmtWithUnit(stats.powerMax, 'kW')}
            label={t('driveDetail.maxPower', 'Max Power')}
          />
        </StaggerItem>
        <StaggerItem>
          <IconStatCard
            icon="🧭"
            color="#10b981"
            value={
              <AnimatedNumber
                value={Math.round(stats.elevGain)}
                suffix=" m ↑"
                style={styles.iconStatValue}
              />
            }
            label={t('driveDetail.elevGain', 'Elev. Gain')}
          />
        </StaggerItem>
        <StaggerItem>
          <IconStatCard
            icon="🧭"
            color="#ef4444"
            value={
              <AnimatedNumber
                value={Math.round(stats.elevLoss)}
                suffix=" m ↓"
                style={styles.iconStatValue}
              />
            }
            label={t('driveDetail.elevLoss', 'Elev. Loss')}
          />
        </StaggerItem>
        {stats.energyWh > 0 ? (
          <StaggerItem>
            <IconStatCard
              icon="💲"
              color="#10b981"
              value={formatEnergyCost(stats.energyWh / 1000)}
              label={t('driveDetail.tripCost', 'Trip Cost')}
            />
          </StaggerItem>
        ) : null}
        {stats.energyWh > 0 && drive.distanceM > 0 ? (
          <StaggerItem>
            <IconStatCard
              icon="📉"
              color="#06b6d4"
              value={formatCurrency(
                costPerDistanceUnit(stats.energyWh / 1000, drive.distanceM) ?? 0,
                3,
              )}
              label={t('driveDetail.costPerUnit', {
                unit: distanceUnit,
                defaultValue: 'Cost / {{unit}}',
              })}
            />
          </StaggerItem>
        ) : null}
      </View>
    </StaggerContainer>
  );
}

/* ─── PanelHeading (shared section heading) ────────────────────── */
function PanelHeading({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <View style={styles.panelHeadingRow}>
      <Glyph style={[styles.panelHeadingIcon, { color }]}>{icon}</Glyph>
      <AppText style={styles.panelHeading} weight="semibold">
        {text}
      </AppText>
    </View>
  );
}

/* ─── MoreDetailsPanel (drive-detail/MoreDetailsPanel) ─────────── */
function MoreDetailsPanel({ drive, stats }: { drive: DriveDetail; stats: DriveStats }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toEfficiencyDisplay = (whPerKm: number) =>
    unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <PanelHeading icon="📊" color="#22d3ee" text={t('driveDetail.moreDetails', 'More Details')} />
        <View style={styles.metricGrid}>
          <Metric label={t('driveDetail.odometer', 'Odometer (From → To)')} color="#22d3ee">
            {stats.odometerStart && stats.odometerEnd
              ? `${fmtNumber(stats.odometerStart)} → ${fmtNumber(stats.odometerEnd)} ${distanceUnit}`
              : '—'}
          </Metric>
          <Metric label={t('driveDetail.rangeStartEnd', 'Range (Start → End)')} color="#10b981">
            {stats.startRange != null
              ? `${fmtNumber(stats.startRange)} → ${stats.endRange != null ? fmtNumber(stats.endRange) : '?'} ${distanceUnit}`
              : '—'}
          </Metric>
          <View style={styles.metricCell}>
            <AppText numberOfLines={2} style={styles.metricLabel} tone="muted" variant="caption">
              {t('driveDetail.elevSummary', 'Elevation Summary')}
            </AppText>
            <AppText style={[styles.metricValueSm, { color: '#10b981' }]} weight="bold">
              {`↗ ${fmtNumber(stats.elevGain)} m`}
            </AppText>
            <AppText style={[styles.metricValueSm, { color: '#ef4444' }]} weight="bold">
              {`↘ ${fmtNumber(stats.elevLoss)} m`}
            </AppText>
          </View>
          <Metric label={t('driveDetail.energyConsumed', 'Energy Consumed')} color="#f59e0b">
            {stats.energyWh > 1000
              ? fmtWithUnit(stats.energyWh / 1000, 'kWh')
              : `${fmtNumber(stats.energyWh)} Wh`}
          </Metric>
          <Metric label={t('driveDetail.energyRecovered', 'Energy Recovered')} color="#10b981">
            {stats.regenWh > 1000
              ? fmtWithUnit(stats.regenWh / 1000, 'kWh')
              : `${fmtNumber(stats.regenWh)} Wh`}
          </Metric>
          <Metric label={t('driveDetail.consumptionRate', 'Consumption')} color="#a855f7">
            {stats.consumptionWhKm > 0
              ? `${fmtNumber(toEfficiencyDisplay(stats.consumptionWhKm))} ${efficiencyUnit}`
              : '—'}
          </Metric>
        </View>
        <View style={styles.panelDivider} />
        <View style={styles.metricGrid}>
          <Metric label={t('driveDetail.avgPower', 'Avg Power')} color="#f59e0b">
            {`${fmtNumber(stats.avgPower)} kW`}
          </Metric>
          {stats.avgOutsideTemp !== null ? (
            <Metric label={t('driveDetail.avgOutsideTemp', 'Avg Outside Temp')} color="#3b82f6">
              {`${fmtNumber(stats.avgOutsideTemp)}${tempUnit}`}
            </Metric>
          ) : null}
          {stats.avgInsideTemp !== null ? (
            <Metric label={t('driveDetail.avgInsideTemp', 'Avg Inside Temp')} color="#fb923c">
              {`${fmtNumber(stats.avgInsideTemp)}${tempUnit}`}
            </Metric>
          ) : null}
          <Metric label={t('driveDetail.minSpeed', 'Min Speed')} color={colors.textSecondary}>
            {`${fmtInt(stats.minSpd)} ${speedUnit}`}
          </Metric>
          <Metric label={t('driveDetail.batteryUsed', 'Battery Used')} color="#f59e0b">
            {drive.startBatteryPct != null && drive.endBatteryPct != null
              ? `${drive.startBatteryPct - drive.endBatteryPct}%`
              : '—'}
          </Metric>
          <Metric label={t('driveDetail.netEnergy', 'Net Consumption')} color="#22d3ee">
            {stats.energyWh - stats.regenWh > 1000
              ? fmtWithUnit((stats.energyWh - stats.regenWh) / 1000, 'kWh')
              : `${fmtNumber(stats.energyWh - stats.regenWh)} Wh`}
          </Metric>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── EnergySummaryPanel (drive-detail/EnergySummaryPanel) ─────── */
function EnergySummaryPanel({ drive, stats }: { drive: DriveDetail; stats: DriveStats }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toEfficiencyDisplay = (whPerKm: number) =>
    unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <PanelHeading icon="🔋" color="#10b981" text={t('driveDetail.energySummary', 'Energy Summary')} />
        <View style={styles.metricGrid}>
          <Metric label={t('driveDetail.energyConsumed', 'Energy Consumed')} color="#f59e0b">
            {stats.energyWh > 1000
              ? fmtWithUnit(stats.energyWh / 1000, 'kWh')
              : `${fmtNumber(stats.energyWh)} Wh`}
          </Metric>
          <Metric label={t('driveDetail.energyRecovered', 'Energy Recovered')} color="#10b981">
            {stats.regenWh > 1000
              ? fmtWithUnit(stats.regenWh / 1000, 'kWh')
              : `${fmtNumber(stats.regenWh)} Wh`}
          </Metric>
          <Metric label={t('driveDetail.netConsumption', 'Net Consumption')} color="#22d3ee">
            {stats.energyWh - stats.regenWh > 1000
              ? fmtWithUnit((stats.energyWh - stats.regenWh) / 1000, 'kWh')
              : `${fmtNumber(stats.energyWh - stats.regenWh)} Wh`}
          </Metric>
          <Metric label={t('driveDetail.efficiency', 'Efficiency')} color="#a855f7">
            {stats.consumptionWhKm > 0
              ? `${fmtNumber(toEfficiencyDisplay(stats.consumptionWhKm))} ${efficiencyUnit}`
              : '—'}
          </Metric>
          <View style={styles.metricCell}>
            <AppText numberOfLines={2} style={styles.metricLabel} tone="muted" variant="caption">
              {t('driveDetail.batteryUsed', 'Battery Used')}
            </AppText>
            <AppText style={[styles.metricValue, { color: '#f59e0b' }]} weight="bold">
              {drive.startBatteryPct != null && drive.endBatteryPct != null
                ? `${drive.startBatteryPct - drive.endBatteryPct}%`
                : '—'}
            </AppText>
            <AppText style={styles.metricSub} tone="muted" variant="caption">
              {`${drive.startBatteryPct ?? '?'}% → ${drive.endBatteryPct ?? '?'}%`}
            </AppText>
          </View>
          <Metric label={t('driveDetail.rangeUsed', 'Range Used')} color="#10b981">
            {stats.startRange != null && stats.endRange != null
              ? fmtWithUnit(stats.startRange - stats.endRange, distanceUnit)
              : '—'}
          </Metric>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── CostSavingsPanel (drive-detail/CostSavingsPanel) ─────────── */
function CostSavingsPanel({ drive, stats }: { drive: DriveDetail; stats: DriveStats }) {
  const { t } = useTranslation();
  const { data: settings } = useSettings();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const {
    costPerKwh,
    currencySymbol,
    formatEnergyCost,
    formatCurrency,
    costPerDistanceUnit,
    estimateGasCost,
  } = useFormatting();

  const gasCost = estimateGasCost(drive.distanceM);
  const evCost = (stats.energyWh / 1000) * costPerKwh;
  const savings = gasCost != null ? gasCost - evCost : null;

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <PanelHeading icon="💲" color="#10b981" text={t('driveDetail.costSavings', 'Cost & Savings')} />
        <View style={styles.metricGrid}>
          <View style={styles.metricCell}>
            <AppText numberOfLines={2} style={styles.metricLabel} tone="muted" variant="caption">
              {t('driveDetail.tripCost', 'Trip Cost')}
            </AppText>
            <AppText style={[styles.metricValue, { color: '#10b981' }]} weight="bold">
              {formatEnergyCost(stats.energyWh / 1000)}
            </AppText>
            <AppText style={styles.metricSub} tone="muted" variant="caption">
              {t('driveDetail.atRate', {
                currencySymbol,
                costPerKwh,
                defaultValue: 'at {{currencySymbol}}{{costPerKwh}}/kWh',
              })}
            </AppText>
          </View>
          {drive.distanceM > 0 ? (
            <Metric
              label={t('driveDetail.costPerUnit', {
                unit: distanceUnit,
                defaultValue: 'Cost / {{unit}}',
              })}
              color="#22d3ee"
            >
              {formatCurrency(costPerDistanceUnit(stats.energyWh / 1000, drive.distanceM) ?? 0, 3)}
            </Metric>
          ) : null}
          {savings != null && savings > 0 ? (
            <>
              <View style={styles.metricCell}>
                <AppText numberOfLines={2} style={styles.metricLabel} tone="muted" variant="caption">
                  {t('driveDetail.gasCostEquiv', 'Gas Cost (equiv)')}
                </AppText>
                <AppText style={[styles.metricValue, { color: '#ef4444' }]} weight="bold">
                  {formatCurrency(gasCost!)}
                </AppText>
                <AppText style={styles.metricSub} tone="muted" variant="caption">
                  {t('driveDetail.atMpg', {
                    mpg: settings?.gas_efficiency_mpg,
                    defaultValue: 'at {{mpg}} MPG',
                  })}
                </AppText>
              </View>
              <Metric label={t('driveDetail.gasSavings', 'vs Gas Savings')} color="#10b981">
                {formatCurrency(savings)}
              </Metric>
              <Metric label={t('driveDetail.savingsPct', 'Savings %')} color="#10b981">
                {`${fmtNumber((savings / gasCost!) * 100, 0)}%`}
              </Metric>
            </>
          ) : null}
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── JourneyDetailsPanel (drive-detail/JourneyDetailsPanel) ───── */
function JourneyDetailsPanel({ drive }: { drive: DriveDetail }) {
  const { t } = useTranslation();
  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <PanelHeading icon="🧭" color="#22d3ee" text={t('driveDetail.journeyDetails', 'Journey Details')} />
        <View style={styles.journeyGrid}>
          <View style={styles.journeyCell}>
            <View style={styles.journeyHeadRow}>
              <Glyph style={styles.journeyIconStart}>📍</Glyph>
              <AppText style={styles.journeyStartLabel} weight="semibold">
                {t('driveDetail.start', 'Start')}
              </AppText>
            </View>
            <AppText style={styles.journeyAddress} weight="semibold">
              {drive.startAddress
                ? drive.startAddress
                : drive.startLat && drive.startLon
                  ? `${fmtNumber(drive.startLat)}°${drive.startLat >= 0 ? 'N' : 'S'}, ${fmtNumber(Math.abs(drive.startLon))}°${drive.startLon >= 0 ? 'E' : 'W'}`
                  : t('driveDetail.noAddress', 'No address data')}
            </AppText>
            <DateTime value={drive.startTs} in="vehicle" style={styles.journeyDateTime} />
            <AppText tone="secondary" variant="caption">
              {`${t('driveDetail.battery', 'Battery')}: ${drive.startBatteryPct ?? '?'}%`}
            </AppText>
          </View>
          <View style={styles.journeyCell}>
            <View style={styles.journeyHeadRow}>
              <Glyph style={styles.journeyIconEnd}>🏁</Glyph>
              <AppText style={styles.journeyEndLabel} weight="semibold">
                {t('driveDetail.destination', 'Destination')}
              </AppText>
            </View>
            <AppText style={styles.journeyAddress} weight="semibold">
              {drive.endAddress
                ? drive.endAddress
                : drive.endLat && drive.endLon
                  ? `${fmtNumber(drive.endLat)}°${drive.endLat >= 0 ? 'N' : 'S'}, ${fmtNumber(Math.abs(drive.endLon))}°${drive.endLon >= 0 ? 'E' : 'W'}`
                  : drive.endTs
                    ? t('driveDetail.noAddress', 'No address data')
                    : t('driveDetail.inProgress', 'In progress')}
            </AppText>
            {drive.endTs ? (
              <DateTime value={drive.endTs} in="vehicle" style={styles.journeyDateTime} />
            ) : (
              <AppText tone="muted" variant="caption">
                {t('driveDetail.inProgress', 'In progress')}
              </AppText>
            )}
            <AppText tone="secondary" variant="caption">
              {`${t('driveDetail.battery', 'Battery')}: ${drive.endBatteryPct ?? '?'}%`}
            </AppText>
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── RouteMapSection (drive-detail/RouteMapSection) ───────────── */
// The interactive Leaflet map (MapContainer/Polyline/CircleMarker/Popup/
// MapLayerSwitcher) is UNAVAILABLE on native (no Leaflet/DOM). This renders a
// native-safe placeholder that preserves the "Route" title, the trail/empty
// branches, the stationary-route banner, the start/end timestamps, and the
// speed-band legend. `trail`/`startPos`/`endPos`/`centerPos`/`speedSegments`
// are accepted and drive the placeholder summary + legend.
function RouteMapSection({
  drive,
  trail,
  startPos,
  endPos,
  centerPos,
  speedSegments,
}: {
  drive: DriveDetail;
  trail: LatLng[];
  startPos: LatLng | undefined;
  endPos: LatLng | undefined;
  centerPos: LatLng;
  speedSegments: SpeedSegment[];
}) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);
  const speedUnit = unitPrefs.speed;

  const positionLatLngs = useMemo<LatLngLike[]>(
    () =>
      (drive.positions ?? []).map((p) => ({
        latitude: typeof p.latitude === 'number' ? p.latitude : Number(p.latitude),
        longitude: typeof p.longitude === 'number' ? p.longitude : Number(p.longitude),
      })),
    [drive.positions],
  );
  const hasRoute = useMemo(() => hasMeaningfulRoute(positionLatLngs), [positionLatLngs]);
  const anchorIdx = useMemo(() => firstValidIndex(positionLatLngs), [positionLatLngs]);
  const anchorPoint: LatLng | undefined = useMemo(() => {
    if (anchorIdx < 0) {
      return undefined;
    }
    const p = positionLatLngs[anchorIdx];
    return [p.latitude, p.longitude];
  }, [positionLatLngs, anchorIdx]);
  // startPos/endPos/centerPos/anchorPoint summarise the route extent in the
  // native placeholder (the web fed them to Leaflet markers/fit-bounds).
  const focus = startPos ?? anchorPoint ?? centerPos;

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <PanelHeading icon="📍" color="#22d3ee" text={t('driveDetail.route', 'Route')} />
        {trail.length > 0 ? (
          <>
            <View style={styles.mapPlaceholder}>
              <Glyph style={styles.mapGlyph}>🗺</Glyph>
              <AppText style={styles.mapPlaceholderText} tone="muted" variant="caption">
                {t(
                  'driveDetail.mapUnavailableNative',
                  'Interactive route map is unavailable on this device.',
                )}
              </AppText>
              <AppText tone="muted" variant="caption">
                {`${trail.length} ${t('driveDetail.points', 'points')} · ${speedSegments.length} ${t('driveDetail.segments', 'segments')} · ${fmtNumber(focus[0], 4)}, ${fmtNumber(focus[1], 4)}`}
              </AppText>
              {endPos ? (
                <AppText tone="muted" variant="caption">
                  {`→ ${fmtNumber(endPos[0], 4)}, ${fmtNumber(endPos[1], 4)}`}
                </AppText>
              ) : null}
              {!hasRoute ? (
                <View style={styles.mapBanner}>
                  <AlertBanner
                    variant="info"
                    icon={<Glyph style={styles.alertGlyph}>🧭</Glyph>}
                    title={t('driveDetail.stationaryRouteTitle', "Route can't be plotted")}
                  >
                    {t(
                      'driveDetail.stationaryRouteBody',
                      "Only one GPS coordinate was recorded for this drive, so the route can't be drawn. The drive's distance, duration, and other stats below are unaffected.",
                    )}
                  </AlertBanner>
                </View>
              ) : null}
            </View>
            <View style={styles.routeFooter}>
              <AppText style={styles.routeStart} variant="caption">
                {`🏁 ${t('driveDetail.start', 'Start')}: ${formatTime(drive.startTs)}`}
              </AppText>
              {hasRoute && trail.length > 1 ? (
                <View style={styles.routeLegend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendSwatch, { backgroundColor: '#10b981' }]} />
                    <AppText tone="muted" variant="caption">
                      {`<${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_LOW_MPS))}`}
                    </AppText>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendSwatch, { backgroundColor: '#22d3ee' }]} />
                    <AppText tone="muted" variant="caption">
                      {`${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_LOW_MPS))}–${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_MED_MPS))}`}
                    </AppText>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendSwatch, { backgroundColor: '#f59e0b' }]} />
                    <AppText tone="muted" variant="caption">
                      {`${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_MED_MPS))}–${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_HIGH_MPS))}`}
                    </AppText>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendSwatch, { backgroundColor: '#ef4444' }]} />
                    <AppText tone="muted" variant="caption">
                      {`>${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_HIGH_MPS))}`}
                    </AppText>
                  </View>
                  <AppText tone="muted" variant="caption">
                    {speedUnit}
                  </AppText>
                </View>
              ) : null}
              {drive.endTs ? (
                <AppText style={styles.routeEnd} variant="caption">
                  {`🏁 ${t('driveDetail.end', 'End')}: ${formatTime(drive.endTs)}`}
                </AppText>
              ) : null}
            </View>
          </>
        ) : (
          <View style={styles.mapEmpty}>
            <Glyph style={styles.mapEmptyGlyph}>📍</Glyph>
            <AppText tone="muted" variant="caption">
              {t('driveDetail.noRouteData', 'No route data available for this drive')}
            </AppText>
          </View>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── ChartEmpty (shared chart empty state) ────────────────────── */
function ChartEmpty({ message }: { message: string }) {
  return (
    <View style={styles.chartEmpty}>
      <Glyph style={styles.chartEmptyGlyph}>📊</Glyph>
      <AppText tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ─── DriveOverviewChart (drive-detail/DriveOverviewChart) ─────── */
// Recharts JSX is reproduced via the native charts barrel (RN-safe
// placeholders). The synced cursor + brush use the reused native sync store.
function DriveOverviewChart({ chartData }: { drive: DriveDetail; chartData: ChartDataPoint[] }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const distanceUnit = unitPrefs.distance;
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  return (
    <FadeIn>
      <ChartContainer
        title={t('driveDetail.driveChart', 'Drive Overview')}
        ariaLabel={t(
          'driveDetail.driveChart.aria',
          'Drive overview composed chart of speed, range, SOC and power over time',
        )}
        height={360}
      >
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              syncId={syncProps.syncId}
              syncMethod={syncProps.syncMethod}
              onMouseMove={syncProps.onMouseMove}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis yAxisId="power" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} unit=" kW" />
              <YAxis yAxisId="speed" hide />
              <Tooltip content={<ChartTooltip />} />
              {areaGradient('driveOverviewSpeed', '#3b82f6', 0.08)}
              <ReferenceLine yAxisId="power" y={0} stroke="rgba(255,255,255,0.1)" />
              <Area
                {...AREA_DEFAULTS}
                yAxisId="speed"
                dataKey="speed"
                stroke="#3b82f6"
                fill="url(#driveOverviewSpeed)"
                strokeWidth={1.5}
                name={`${t('driveDetail.speed', 'Speed')} (${speedUnit})`}
              />
              {chartData.some((d) => d.idealRange !== null) ? (
                <Line
                  {...AREA_DEFAULTS}
                  yAxisId="speed"
                  dataKey="idealRange"
                  stroke="#c084fc"
                  strokeWidth={1}
                  name={`${t('driveDetail.rangeIdeal', 'Range ideal')} (${distanceUnit})`}
                  strokeDasharray="4 2"
                />
              ) : null}
              {chartData.some((d) => d.estRange !== null || d.ratedRange !== null) ? (
                <Line
                  {...AREA_DEFAULTS}
                  yAxisId="speed"
                  dataKey={chartData.some((d) => d.estRange !== null) ? 'estRange' : 'ratedRange'}
                  stroke="#a855f7"
                  strokeWidth={1}
                  name={`${t('driveDetail.rangeEst', 'Range est.')} (${distanceUnit})`}
                  strokeDasharray="4 2"
                />
              ) : null}
              <Line
                {...AREA_DEFAULTS}
                yAxisId="speed"
                dataKey="battery"
                stroke="#84cc16"
                strokeWidth={1.5}
                name={`${t('driveDetail.soc', 'SOC')} %`}
              />
              {chartData.some((d) => d.usableSoc !== null) ? (
                <Line
                  {...AREA_DEFAULTS}
                  yAxisId="speed"
                  dataKey="usableSoc"
                  stroke="#22d3ee"
                  strokeWidth={1}
                  name={`${t('driveDetail.usableSoc', 'Usable SOC')} %`}
                />
              ) : null}
              <Line
                {...AREA_DEFAULTS}
                yAxisId="power"
                dataKey="power"
                stroke="#f59e0b"
                name={`${t('driveDetail.power', 'Power')} kW`}
              />
              {syncedX != null ? (
                <ReferenceLine
                  yAxisId="power"
                  x={syncedX}
                  stroke={chartTokens.cursor.stroke}
                  strokeWidth={chartTokens.cursor.strokeWidth}
                  strokeDasharray={chartTokens.cursor.strokeDasharray}
                  ifOverflow="hidden"
                  isFront
                />
              ) : null}
              <ChartBrush dataKey="time" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty message={t('driveDetail.noChartData', 'No telemetry data available')} />
        )}
      </ChartContainer>
      {chartData.length > 1 ? <ChartLegend chartData={chartData} /> : null}
    </FadeIn>
  );
}

function ChartLegend({ chartData }: { chartData: ChartDataPoint[] }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const distanceUnit = unitPrefs.distance;

  const statFn = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x != null);
    if (v.length === 0) {
      return null;
    }
    return { mean: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v), min: Math.min(...v) };
  };

  const speedS = statFn(chartData.map((d) => d.speed));
  const idealRangeS = statFn(chartData.map((d) => d.idealRange));
  const estRangeS = statFn(chartData.map((d) => d.estRange ?? d.ratedRange));
  const powerS = statFn(chartData.map((d) => d.power));
  const socS = statFn(chartData.map((d) => (d.battery > 0 ? d.battery : null)));
  const usableSocS = statFn(chartData.map((d) => d.usableSoc));

  type LegendItem = { color: string; dash?: boolean; label: string; mean: string; max: string; min: string };
  const items: LegendItem[] = [];
  if (speedS) {
    items.push({
      color: '#3b82f6',
      label: t('driveDetail.speed', 'Speed'),
      mean: `${fmtNumber(speedS.mean)} ${speedUnit}`,
      max: `${fmtNumber(speedS.max)} ${speedUnit}`,
      min: `${fmtInt(speedS.min)} ${speedUnit}`,
    });
  }
  if (idealRangeS) {
    items.push({
      color: '#c084fc',
      dash: true,
      label: t('driveDetail.rangeIdeal', 'Range (ideal)'),
      mean: `${fmtInt(idealRangeS.mean)} ${distanceUnit}`,
      max: `${fmtInt(idealRangeS.max)} ${distanceUnit}`,
      min: `${fmtInt(idealRangeS.min)} ${distanceUnit}`,
    });
  }
  if (estRangeS) {
    items.push({
      color: '#a855f7',
      dash: true,
      label: t('driveDetail.rangeEst', 'Range (est.)'),
      mean: `${fmtInt(estRangeS.mean)} ${distanceUnit}`,
      max: `${fmtInt(estRangeS.max)} ${distanceUnit}`,
      min: `${fmtInt(estRangeS.min)} ${distanceUnit}`,
    });
  }
  if (socS) {
    items.push({
      color: '#84cc16',
      label: t('driveDetail.soc', 'SOC'),
      mean: fmtPercent(socS.mean),
      max: fmtPercent(socS.max),
      min: fmtPercent(socS.min),
    });
  }
  if (usableSocS) {
    items.push({
      color: '#22d3ee',
      label: t('driveDetail.usableSoc', 'Usable SOC'),
      mean: fmtPercent(usableSocS.mean),
      max: fmtPercent(usableSocS.max),
      min: fmtPercent(usableSocS.min),
    });
  }
  if (powerS) {
    items.push({
      color: '#f59e0b',
      label: t('driveDetail.power', 'Power'),
      mean: fmtWithUnit(powerS.mean, 'kW'),
      max: fmtWithUnit(powerS.max, 'kW'),
      min: fmtWithUnit(powerS.min, 'kW'),
    });
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={styles.legendStats}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendStatItem}>
          <View style={[styles.legendStatSwatch, { borderColor: item.color }]} />
          <AppText style={[styles.legendStatLabel, { color: item.color }]} weight="bold" variant="caption">
            {item.label}
          </AppText>
          <AppText tone="muted" variant="caption">{`Mean: ${item.mean}`}</AppText>
          <AppText tone="muted" variant="caption">{`Max: ${item.max}`}</AppText>
          <AppText tone="muted" variant="caption">{`Min: ${item.min}`}</AppText>
        </View>
      ))}
    </View>
  );
}

/* ─── SocChart (drive-detail/SocChart) ─────────────────────────── */
function SocChart({ chartData }: { chartData: ChartDataPoint[] }) {
  const { t } = useTranslation();
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  return (
    <FadeIn>
      <ChartContainer
        title={t('driveDetail.socOverTime', 'SOC % Over Time')}
        ariaLabel={t('driveDetail.socOverTime.aria', 'State of charge percent over time area chart')}
        height={220}
      >
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              syncId={syncProps.syncId}
              syncMethod={syncProps.syncMethod}
              onMouseMove={syncProps.onMouseMove}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              {areaGradient('socGrad', '#10b981')}
              <Area
                {...AREA_DEFAULTS}
                dataKey="battery"
                stroke="#10b981"
                fill="url(#socGrad)"
                name={`${t('driveDetail.soc', 'SOC')} %`}
              />
              {syncedX != null ? (
                <ReferenceLine
                  x={syncedX}
                  stroke={chartTokens.cursor.stroke}
                  strokeWidth={chartTokens.cursor.strokeWidth}
                  strokeDasharray={chartTokens.cursor.strokeDasharray}
                  ifOverflow="hidden"
                  isFront
                />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty message={t('driveDetail.noChartData', 'No telemetry data available')} />
        )}
      </ChartContainer>
    </FadeIn>
  );
}

/* ─── ElevationChart (drive-detail/ElevationChart) ─────────────── */
function ElevationChart({ chartData, stats }: { chartData: ChartDataPoint[]; stats: DriveStats }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  return (
    <FadeIn>
      <ChartContainer
        title={t('driveDetail.elevProfile', 'Elevation Profile')}
        ariaLabel={t('driveDetail.elevProfile.aria', 'Elevation and speed area+line chart over the drive timeline')}
        height={220}
      >
        {chartData.length > 1 ? (
          <>
            <View style={styles.chartStatsRow}>
              <AppText style={styles.chartStatGain} variant="caption">
                {`↗ ${fmtNumber(stats.elevGain)} m ${t('driveDetail.gain', 'gain')}`}
              </AppText>
              <AppText style={styles.chartStatLoss} variant="caption">
                {`↘ ${fmtNumber(stats.elevLoss)} m ${t('driveDetail.loss', 'loss')}`}
              </AppText>
              <AppText tone="muted" variant="caption">
                {`${t('driveDetail.net', 'Net')}: ${fmtNumber(stats.elevGain - stats.elevLoss)} m`}
              </AppText>
            </View>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                syncId={syncProps.syncId}
                syncMethod={syncProps.syncMethod}
                onMouseMove={syncProps.onMouseMove}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis yAxisId="elev" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis yAxisId="speed" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Area
                  yAxisId="elev"
                  type="monotone"
                  dataKey="elevation"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.2}
                  strokeWidth={2}
                  name={`${t('driveDetail.elevation', 'Elevation')} (m)`}
                />
                <Line
                  yAxisId="speed"
                  type="monotone"
                  dataKey="speed"
                  stroke="#a855f7"
                  strokeWidth={1.5}
                  dot={false}
                  name={`${t('driveDetail.speed', 'Speed')} (${speedUnit})`}
                  strokeOpacity={0.6}
                />
                {syncedX != null ? (
                  <ReferenceLine
                    yAxisId="elev"
                    x={syncedX}
                    stroke={chartTokens.cursor.stroke}
                    strokeWidth={chartTokens.cursor.strokeWidth}
                    strokeDasharray={chartTokens.cursor.strokeDasharray}
                    ifOverflow="hidden"
                    isFront
                  />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </>
        ) : (
          <ChartEmpty message={t('driveDetail.noChartData', 'No telemetry data available')} />
        )}
      </ChartContainer>
    </FadeIn>
  );
}

/* ─── TemperatureSection (drive-detail/TemperatureSection) ─────── */
function TemperatureSection({ chartData, stats }: { chartData: ChartDataPoint[]; stats: DriveStats }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  const driverAvg =
    stats.driverTemps.length > 0
      ? stats.driverTemps.reduce((a, b) => a + b, 0) / stats.driverTemps.length
      : null;
  const passengerAvg =
    stats.passengerTemps.length > 0
      ? stats.passengerTemps.reduce((a, b) => a + b, 0) / stats.passengerTemps.length
      : null;

  return (
    <FadeIn>
      <ChartContainer
        title={t('driveDetail.temperatures', 'Temperatures')}
        ariaLabel={t(
          'driveDetail.temperatures.aria',
          'Inside, outside, driver and passenger temperature lines over the drive timeline',
        )}
        height={310}
      >
        {chartData.length > 1 && stats.hasAnyTemp ? (
          <>
            <View style={styles.tempTiles}>
              {stats.avgOutsideTemp != null ? (
                <View style={styles.tempTile}>
                  <AppText tone="muted" variant="caption">
                    {t('driveDetail.outsideTemp', 'Outside Temperature')}
                  </AppText>
                  <AppText style={[styles.tempTileValue, { color: '#3b82f6' }]} weight="bold">
                    {`${fmtNumber(stats.avgOutsideTemp)}${tempUnit}`}
                  </AppText>
                </View>
              ) : null}
              {stats.avgInsideTemp != null ? (
                <View style={styles.tempTile}>
                  <AppText tone="muted" variant="caption">
                    {t('driveDetail.insideTemp', 'Inside Temperature')}
                  </AppText>
                  <AppText style={[styles.tempTileValue, { color: '#fb923c' }]} weight="bold">
                    {`${fmtNumber(stats.avgInsideTemp)}${tempUnit}`}
                  </AppText>
                </View>
              ) : null}
              {driverAvg != null ? (
                <View style={styles.tempTile}>
                  <AppText tone="muted" variant="caption">
                    {t('driveDetail.driverTemp', 'Driver Temperature')}
                  </AppText>
                  <AppText style={[styles.tempTileValue, { color: '#fb7185' }]} weight="bold">
                    {`${fmtNumber(driverAvg)}${tempUnit}`}
                  </AppText>
                </View>
              ) : null}
              {passengerAvg != null ? (
                <View style={styles.tempTile}>
                  <AppText tone="muted" variant="caption">
                    {t('driveDetail.passengerTemp', 'Passenger Temperature')}
                  </AppText>
                  <AppText style={[styles.tempTileValue, { color: '#a855f7' }]} weight="bold">
                    {`${fmtNumber(passengerAvg)}${tempUnit}`}
                  </AppText>
                </View>
              ) : null}
              {stats.climateStatus != null ? (
                <View style={styles.tempTile}>
                  <AppText tone="muted" variant="caption">
                    {t('driveDetail.climate', 'Climate')}
                  </AppText>
                  <AppText
                    style={[
                      styles.tempTileValue,
                      { color: stats.climateStatus === 'On' ? '#10b981' : colors.textMuted },
                    ]}
                    weight="bold"
                  >
                    {stats.climateStatus}
                  </AppText>
                </View>
              ) : null}
              {stats.maxFanSpeed != null ? (
                <View style={styles.tempTile}>
                  <AppText tone="muted" variant="caption">
                    {t('driveDetail.fanStatus', 'Fan Status')}
                  </AppText>
                  <AppText style={[styles.tempTileValue, { color: '#22d3ee' }]} weight="bold">
                    {`${t('driveDetail.avg', 'Avg')} ${fmtInt(stats.avgFanSpeed)} · Max ${stats.maxFanSpeed}`}
                  </AppText>
                </View>
              ) : null}
            </View>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={chartData}
                syncId={syncProps.syncId}
                syncMethod={syncProps.syncMethod}
                onMouseMove={syncProps.onMouseMove}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                {stats.outsideTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="outsideTemp" stroke="#3b82f6" name={`${t('driveDetail.outside', 'Outside')} ${tempUnit}`} />
                ) : null}
                {stats.insideTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="insideTemp" stroke="#f97316" name={`${t('driveDetail.inside', 'Inside')} ${tempUnit}`} />
                ) : null}
                {stats.driverTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="driverTemp" stroke="#fb7185" name={`${t('driveDetail.driver', 'Driver')} ${tempUnit}`} />
                ) : null}
                {stats.passengerTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="passengerTemp" stroke="#a855f7" name={`${t('driveDetail.passenger', 'Passenger')} ${tempUnit}`} />
                ) : null}
                {syncedX != null ? (
                  <ReferenceLine
                    x={syncedX}
                    stroke={chartTokens.cursor.stroke}
                    strokeWidth={chartTokens.cursor.strokeWidth}
                    strokeDasharray={chartTokens.cursor.strokeDasharray}
                    ifOverflow="hidden"
                    isFront
                  />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : (
          <ChartEmpty
            message={t('driveDetail.noTemperatureData', 'No temperature telemetry is available for this drive.')}
          />
        )}
      </ChartContainer>
    </FadeIn>
  );
}

/* ─── SpeedHistogramChart (drive-detail/SpeedHistogramChart) ───── */
function SpeedHistogramChart({ speedHistData }: { speedHistData: SpeedHistogramBucket[] }) {
  const { t } = useTranslation();

  return (
    <FadeIn>
      <ChartContainer
        title={t('driveDetail.speedHistogram', 'Speed Histogram')}
        ariaLabel={t('driveDetail.speedHistogram.aria', 'Speed-bucket distribution histogram')}
        data={speedHistData.map((b) => ({ range: b.range, pct: b.pct }))}
        dataColumns={[
          { key: 'range', label: t('driveDetail.col.range', 'Speed range') },
          { key: 'pct', label: t('driveDetail.col.pct', '% of drive') },
        ]}
        height={220}
      >
        {speedHistData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={speedHistData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="pct" fill="#a855f7" name={`% ${t('driveDetail.ofDrive', 'of drive')}`} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty message={t('driveDetail.noChartData', 'No telemetry data available')} />
        )}
      </ChartContainer>
    </FadeIn>
  );
}

/* ─── PowerProfileChart (drive-detail/PowerProfileChart) ───────── */
function PowerProfileChart({ chartData, stats }: { chartData: ChartDataPoint[]; stats: DriveStats }) {
  const { t } = useTranslation();
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  return (
    <FadeIn>
      <ChartContainer
        title={t('driveDetail.powerProfile', 'Power Profile')}
        ariaLabel={t('driveDetail.powerProfile.aria', 'Drive power profile area chart over time')}
        height={220}
      >
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              syncId={syncProps.syncId}
              syncMethod={syncProps.syncMethod}
              onMouseMove={syncProps.onMouseMove}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
              {areaGradient('powerGrad', '#f59e0b')}
              <Area
                {...AREA_DEFAULTS}
                dataKey="power"
                stroke="#f59e0b"
                fill="url(#powerGrad)"
                name={`${t('driveDetail.power', 'Power')} kW`}
              />
              {syncedX != null ? (
                <ReferenceLine
                  x={syncedX}
                  stroke={chartTokens.cursor.stroke}
                  strokeWidth={chartTokens.cursor.strokeWidth}
                  strokeDasharray={chartTokens.cursor.strokeDasharray}
                  ifOverflow="hidden"
                  isFront
                />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty message={t('driveDetail.noChartData', 'No telemetry data available')} />
        )}
      </ChartContainer>
      {chartData.length > 1 ? (
        <View style={styles.powerStatsRow}>
          <AppText tone="secondary" variant="caption">
            {`${t('driveDetail.maxPower', 'Max Power')}: `}
            <AppText style={styles.powerStatAmber} weight="bold" variant="caption">{`${fmtInt(stats.powerMax)} kW`}</AppText>
          </AppText>
          <AppText tone="secondary" variant="caption">
            {`${t('driveDetail.maxRegen', 'Max Regen')}: `}
            <AppText style={styles.powerStatCyan} weight="bold" variant="caption">{`${fmtInt(stats.powerMin)} kW`}</AppText>
          </AppText>
          <AppText tone="secondary" variant="caption">
            {`${t('driveDetail.avgLabel', 'Avg')}: `}
            <AppText weight="bold" variant="caption">{`${fmtNumber(stats.avgPower)} kW`}</AppText>
          </AppText>
        </View>
      ) : null}
    </FadeIn>
  );
}

/* ─── TirePressureSection (drive-detail/TirePressureSection) ───── */
function TirePressureSection({ chartData, stats }: { chartData: ChartDataPoint[]; stats: DriveStats }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const pressureUnit = unitPrefs.pressure;

  const tpVals = (key: 'tireFl' | 'tireFr' | 'tireRl' | 'tireRr') => {
    const vals = chartData.map((d) => d[key]).filter((v): v is number => v != null && v > 0);
    return {
      min: vals.length > 0 ? Math.min(...vals) : null,
      max: vals.length > 0 ? Math.max(...vals) : null,
    };
  };
  const fl = tpVals('tireFl');
  const fr = tpVals('tireFr');
  const rl = tpVals('tireRl');
  const rr = tpVals('tireRr');
  const tpStats = [
    { label: t('driveDetail.frontLeft', 'Front Left'), color: '#3b82f6', ...fl },
    { label: t('driveDetail.frontRight', 'Front Right'), color: '#10b981', ...fr },
    { label: t('driveDetail.rearLeft', 'Rear Left'), color: '#f59e0b', ...rl },
    { label: t('driveDetail.rearRight', 'Rear Right'), color: '#ef4444', ...rr },
  ];

  return (
    <FadeIn>
      <ChartContainer
        title={t('driveDetail.tirePressure', 'Tire Pressure During Drive')}
        ariaLabel={t('driveDetail.tirePressure.aria', 'Front and rear tire pressure lines over the drive timeline')}
        height={310}
      >
        {stats.hasTirePressure ? (
          <>
            <View style={styles.tempTiles}>
              {tpStats.map((tp) => (
                <View key={tp.label} style={styles.tempTile}>
                  <AppText tone="muted" variant="caption">
                    {tp.label}
                  </AppText>
                  <AppText style={[styles.tempTileValue, { color: tp.color }]} weight="bold">
                    {tp.min != null ? `${fmtNumber(tp.min)}–${fmtNumber(tp.max!)} ${pressureUnit}` : '—'}
                  </AppText>
                </View>
              ))}
            </View>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                {chartData.some((d) => d.tireFl !== null) ? (
                  <Line {...AREA_DEFAULTS} dataKey="tireFl" stroke="#3b82f6" name={`FL (${pressureUnit})`} />
                ) : null}
                {chartData.some((d) => d.tireFr !== null) ? (
                  <Line {...AREA_DEFAULTS} dataKey="tireFr" stroke="#10b981" name={`FR (${pressureUnit})`} />
                ) : null}
                {chartData.some((d) => d.tireRl !== null) ? (
                  <Line {...AREA_DEFAULTS} dataKey="tireRl" stroke="#f59e0b" name={`RL (${pressureUnit})`} />
                ) : null}
                {chartData.some((d) => d.tireRr !== null) ? (
                  <Line {...AREA_DEFAULTS} dataKey="tireRr" stroke="#ef4444" name={`RR (${pressureUnit})`} />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : (
          <ChartEmpty message={t('driveDetail.noChartData', 'No telemetry data available')} />
        )}
      </ChartContainer>
    </FadeIn>
  );
}

/* ─── WhyEndedPanel (drive-detail/WhyEndedPanel) ───────────────── */
// Lazy diagnostic: collapsed by default; the `useDriveWhyEnded` query only
// fires when expanded. The web DataTable -> a simple native table; the web
// Timeline -> a vertical list; the web Select -> Pressable window chips. State
// names (`expanded`, `windowSel`) + the `/drives/{id}/why-ended` path preserved.
const WHY_ENDED_WINDOWS: DriveDiagnosticWindow[] = ['30s', '60s', '5m', '15m'];

function WhyEndedPanel({ driveId }: { driveId: string | number }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [windowSel, setWindowSel] = useState<DriveDiagnosticWindow>('60s');

  const why = useDriveWhyEnded(driveId, windowSel, expanded);

  const transitions: DriveDiagnosticTransition[] = why.data?.fsm_transitions ?? [];
  const signals: DriveDiagnosticSignal[] = why.data?.signal_window ?? [];

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.whyHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          hitSlop={8}
          onPress={() => setExpanded((p) => !p)}
          style={styles.whyToggle}
        >
          <Glyph style={styles.whyChevron}>{expanded ? '▾' : '▸'}</Glyph>
          <AppText style={styles.panelHeading} weight="semibold">
            {t('driveDetail.whyEnded.title', 'Why did this drive end?')}
          </AppText>
        </Pressable>
        {expanded ? (
          <View style={styles.whyWindowRow}>
            {WHY_ENDED_WINDOWS.map((w) => (
              <Pressable
                key={w}
                accessibilityRole="button"
                accessibilityState={{ selected: windowSel === w }}
                onPress={() => setWindowSel(w)}
                style={[styles.whyChip, windowSel === w ? styles.whyChipActive : null]}
              >
                <AppText
                  style={windowSel === w ? styles.whyChipTextActive : styles.whyChipText}
                  variant="caption"
                  weight="semibold"
                >
                  {t(`driveDetail.whyEnded.windowOption.${w}`, w)}
                </AppText>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {expanded ? (
        <View style={styles.whyBody}>
          {why.isLoading ? (
            <View style={styles.whyLoading}>
              <Spinner />
            </View>
          ) : why.error ? (
            <View style={styles.whyError}>
              <AppText weight="semibold">
                {t('driveDetail.whyEnded.error.title', 'Could not load diagnostic')}
              </AppText>
              <AppText tone="muted" variant="caption">
                {why.error instanceof Error
                  ? why.error.message
                  : t('driveDetail.whyEnded.error.message', 'Try a different window or reload the page.')}
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => why.refetch()}
                style={styles.whyRetry}
              >
                <AppText style={styles.whyRetryText} variant="caption" weight="semibold">
                  {t('common.retry', 'Retry')}
                </AppText>
              </Pressable>
            </View>
          ) : (
            <>
              <View>
                <View style={styles.whySectionHead}>
                  <Glyph style={styles.whySectionIcon}>🌿</Glyph>
                  <AppText weight="semibold">
                    {t('driveDetail.whyEnded.fsmTitle', 'FSM transitions')}
                  </AppText>
                </View>
                {transitions.length === 0 ? (
                  <View style={styles.whyEmpty}>
                    <AppText weight="semibold">
                      {t('driveDetail.whyEnded.fsmEmpty.title', 'No transitions in window')}
                    </AppText>
                    <AppText tone="muted" variant="caption">
                      {t(
                        'driveDetail.whyEnded.fsmEmpty.message',
                        'No FSM state changes recorded near the drive end. Try a wider window.',
                      )}
                    </AppText>
                  </View>
                ) : (
                  <View style={styles.timeline}>
                    {transitions.map((tx) => (
                      <View key={tx.id} style={styles.timelineItem}>
                        <View style={styles.timelineDot} />
                        <View style={styles.timelineContent}>
                          <AppText style={styles.mono} variant="caption">
                            {`${tx.fsm_name}: ${tx.from_state} → ${tx.to_state}`}
                          </AppText>
                          <AppText tone="muted" variant="caption">
                            {t('driveDetail.whyEnded.trigger', 'trigger: {{trigger}}', {
                              trigger: tx.trigger || '—',
                            })}
                          </AppText>
                          <AppText tone="muted" variant="caption">
                            {new Date(tx.ts).toLocaleString()}
                          </AppText>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View>
                <View style={styles.whySectionHead}>
                  <Glyph style={styles.whySectionIcon}>📡</Glyph>
                  <AppText weight="semibold">
                    {t('driveDetail.whyEnded.signalTitle', 'Signal window')}
                  </AppText>
                </View>
                {signals.length === 0 ? (
                  <View style={styles.whyEmpty}>
                    <AppText tone="muted" variant="caption">
                      {t(
                        'driveDetail.whyEnded.signalEmpty',
                        'No signals in this window for the default whitelist.',
                      )}
                    </AppText>
                  </View>
                ) : (
                  <View style={styles.signalTable}>
                    <View style={[styles.signalRow, styles.signalHeadRow]}>
                      <AppText style={styles.signalColTs} tone="muted" variant="caption" weight="semibold">
                        {t('driveDetail.whyEnded.signal.cols.ts', 'Timestamp')}
                      </AppText>
                      <AppText style={styles.signalColField} tone="muted" variant="caption" weight="semibold">
                        {t('driveDetail.whyEnded.signal.cols.field', 'Field')}
                      </AppText>
                      <AppText style={styles.signalColValue} tone="muted" variant="caption" weight="semibold">
                        {t('driveDetail.whyEnded.signal.cols.value', 'Value')}
                      </AppText>
                    </View>
                    {signals.map((s, idx) => (
                      <View key={`${s.ts}-${s.field}-${idx}`} style={styles.signalRow}>
                        <AppText style={styles.signalColTs} variant="caption">
                          {formatDateTime(s.ts)}
                        </AppText>
                        <AppText style={[styles.signalColField, styles.mono]} variant="caption">
                          {s.field}
                        </AppText>
                        <AppText style={[styles.signalColValue, styles.mono]} tone="muted" variant="caption">
                          {s.value}
                        </AppText>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}
        </View>
      ) : null}
    </GlassPanel>
  );
}

/* ─── ShareDriveDialog (../components/ShareDriveDialog) ─────────── */
// Web Modal/Toggle/Input/Select/CopyButton -> RN Modal/Switch/TextInput +
// Pressable chips. `window.location.origin` is unavailable on native, so the
// generated link is the path-only `/s/{token}` (documented). Clipboard copy is
// UNAVAILABLE (no clipboard binding) -> the affordance surfaces an explicit
// hint; "open" uses Linking.openURL. State names + the useSharing hooks +
// mutation payload are preserved verbatim.
const SHARE_EXPIRY_OPTIONS: { value: string; key: string; fallback: string }[] = [
  { value: '7', key: 'share.expiry7d', fallback: '7 days' },
  { value: '30', key: 'share.expiry30d', fallback: '30 days' },
  { value: '90', key: 'share.expiry90d', fallback: '90 days' },
  { value: '0', key: 'share.expiryNever', fallback: 'Never' },
];

function ShareDriveDialog({
  driveId,
  open,
  onClose,
}: {
  driveId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createShare = useCreateShareLink(driveId);
  const { data: existingShares, isLoading: sharesLoading } = useShareLinks(driveId);
  const revokeShare = useRevokeShareLink(driveId);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [includeSpeed, setIncludeSpeed] = useState(true);
  const [includeTelemetry, setIncludeTelemetry] = useState(false);
  const [expiryDays, setExpiryDays] = useState('30');
  const [title, setTitle] = useState('');
  const [copyNotified, setCopyNotified] = useState(false);

  const handleCreate = async () => {
    const result = await createShare.mutateAsync({
      title: title || undefined,
      include_speed: includeSpeed,
      include_telemetry: includeTelemetry,
      expires_in_days: Number(expiryDays) || undefined,
    });
    // window.location.origin is unavailable on native -> path-only share link.
    setShareUrl(`/s/${result.token}`);
  };

  const handleRevoke = async (token: string) => {
    await revokeShare.mutateAsync(token);
  };

  const handleClose = () => {
    setShareUrl(null);
    setTitle('');
    setCopyNotified(false);
    onClose();
  };

  const shares = existingShares ?? [];

  return (
    <Modal animationType="slide" onRequestClose={handleClose} transparent visible={open}>
      <View style={styles.modalBackdrop}>
        <GlassPanel style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <AppText variant="title" weight="bold">
              {t('share.title', 'Share Drive')}
            </AppText>
            <Pressable accessibilityLabel={t('common.close', 'Close')} accessibilityRole="button" hitSlop={8} onPress={handleClose}>
              <Glyph style={styles.modalClose}>✕</Glyph>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {!shareUrl ? (
              <View style={styles.shareForm}>
                <AppText tone="secondary" variant="caption">
                  {t(
                    'share.description',
                    'Generate a public link to share this drive report. Anyone with the link can view the map, stats, and charts — no login required.',
                  )}
                </AppText>
                <TextInput
                  onChangeText={setTitle}
                  placeholder={t('share.titlePlaceholder', 'Optional title (e.g., "SF to LA Road Trip")')}
                  placeholderTextColor={colors.textMuted}
                  style={styles.textInput}
                  value={title}
                />
                <View style={styles.toggleRow}>
                  <AppText style={styles.toggleLabel}>{t('share.includeSpeed', 'Include speed data')}</AppText>
                  <Switch onValueChange={setIncludeSpeed} value={includeSpeed} />
                </View>
                <View style={styles.toggleRow}>
                  <AppText style={styles.toggleLabel}>
                    {t('share.includeTelemetry', 'Include detailed telemetry (battery, power)')}
                  </AppText>
                  <Switch onValueChange={setIncludeTelemetry} value={includeTelemetry} />
                </View>
                <AppText tone="muted" variant="caption">
                  {t('share.expiry', 'Link expires after')}
                </AppText>
                <View style={styles.shareExpiryRow}>
                  {SHARE_EXPIRY_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: expiryDays === opt.value }}
                      onPress={() => setExpiryDays(opt.value)}
                      style={[styles.whyChip, expiryDays === opt.value ? styles.whyChipActive : null]}
                    >
                      <AppText
                        style={expiryDays === opt.value ? styles.whyChipTextActive : styles.whyChipText}
                        variant="caption"
                        weight="semibold"
                      >
                        {t(opt.key, opt.fallback)}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={createShare.isPending}
                  onPress={handleCreate}
                  style={[styles.primaryButton, createShare.isPending ? styles.primaryButtonDisabled : null]}
                >
                  <AppText style={styles.primaryButtonText} weight="semibold">
                    {createShare.isPending
                      ? t('common.loading', 'Loading…')
                      : `🔗 ${t('share.generate', 'Generate Link')}`}
                  </AppText>
                </Pressable>
              </View>
            ) : (
              <View style={styles.shareForm}>
                <AppText style={styles.shareCreated} weight="semibold">
                  {t('share.created', 'Share link created!')}
                </AppText>
                <TextInput editable={false} style={styles.textInput} value={shareUrl} />
                <View style={styles.shareActionRow}>
                  <Pressable
                    accessibilityHint={
                      copyNotified
                        ? t('common.copyLink.unavailable', 'Link sharing is unavailable on this device')
                        : undefined
                    }
                    accessibilityRole="button"
                    onPress={() => setCopyNotified(true)}
                    style={[styles.primaryButton, styles.shareActionFlex]}
                  >
                    <AppText style={styles.primaryButtonText} weight="semibold">
                      {t('share.copy', 'Copy Link')}
                    </AppText>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={t('share.open', 'Open link')}
                    accessibilityRole="button"
                    onPress={() => Linking.openURL(shareUrl).catch(() => undefined)}
                    style={styles.outlineButton}
                  >
                    <Glyph style={styles.outlineButtonIcon}>↗</Glyph>
                  </Pressable>
                </View>
                {copyNotified ? (
                  <AppText accessibilityLiveRegion="polite" tone="muted" variant="caption">
                    {t('common.copyLink.unavailable', 'Link sharing is unavailable on this device')}
                  </AppText>
                ) : null}
                <Pressable accessibilityRole="button" onPress={() => setShareUrl(null)} style={styles.ghostFullButton}>
                  <AppText style={styles.ghostButtonText} weight="semibold">
                    {t('share.createAnother', 'Create another link')}
                  </AppText>
                </Pressable>
              </View>
            )}

            {shares.length > 0 ? (
              <View style={styles.shareExisting}>
                <AppText style={styles.shareExistingHead} tone="secondary" weight="semibold">
                  {t('share.existing', 'Active Share Links')}
                </AppText>
                {shares.map((share) => {
                  const isExpired = share.expires_at ? new Date(share.expires_at) < new Date() : false;
                  return (
                    <GlassPanel key={share.id} style={styles.shareItem}>
                      <View style={styles.shareItemInfo}>
                        <AppText numberOfLines={1} weight="semibold">
                          {share.title ?? t('share.untitled', 'Untitled share')}
                        </AppText>
                        <View style={styles.shareItemMeta}>
                          <AppText tone="muted" variant="caption">
                            {`👁 ${share.views} ${t('share.views', 'views')}`}
                          </AppText>
                          <AppText tone="muted" variant="caption">
                            {isExpired
                              ? t('share.expired', 'Expired')
                              : share.expires_at
                                ? t('share.expiresOn', 'Expires {{date}}', {
                                    date: formatDate(share.expires_at),
                                  })
                                : t('share.noExpiry', 'No expiry')}
                          </AppText>
                        </View>
                      </View>
                      <Pressable
                        accessibilityLabel={t('share.revoke', 'Revoke')}
                        accessibilityRole="button"
                        hitSlop={8}
                        onPress={() => handleRevoke(share.token)}
                      >
                        <Glyph style={styles.shareRevoke}>🗑</Glyph>
                      </Pressable>
                    </GlassPanel>
                  );
                })}
              </View>
            ) : null}

            {sharesLoading ? (
              <View style={styles.whyLoading}>
                <Spinner />
              </View>
            ) : null}
          </ScrollView>
        </GlassPanel>
      </View>
    </Modal>
  );
}

/* ─── main page (DriveDetailPage) ──────────────────────────────── */
interface DriveDetailPageProps {
  /** Drive id a native navigator passes in place of the DOM `:id` route param. */
  id?: string;
}

export default function DriveDetailPage({ id: idProp }: DriveDetailPageProps = {}) {
  const { id } = useParams(idProp);
  const { t } = useTranslation();
  usePageTitle(t('driveDetail.title', 'Drive Detail'));

  const {
    drive,
    vehicle,
    isLoading,
    error,
    chartData,
    stats,
    trail,
    startPos,
    endPos,
    centerPos,
    speedSegments,
    speedHistData,
  } = useDriveDetailData(id ?? '');

  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  if (isLoading) {
    return <DriveDetailSkeleton />;
  }

  // A drive can be persisted with all-zero aggregate fields when the underlying
  // signal_log slice contained only gear transitions. Detect that envelope and
  // replace the four numeric-summary panels with a single explanatory banner.
  const hasTelemetryRows =
    (drive?.telemetry?.length ?? 0) > 0 || (drive?.positions?.length ?? 0) > 0;
  const hasMeaningfulDriveStats =
    !!drive &&
    ((drive.distanceM ?? 0) > 0 ||
      (stats?.maxSpd ?? 0) > 0 ||
      (stats?.energyWh ?? 0) > 0 ||
      hasTelemetryRows);

  return (
    <PageContainer
      title={t('driveDetail.title', 'Drive Detail')}
      error={error as Error | null}
      breadcrumbLabels={{
        '/drives/:id': drive
          ? `${drive.startAddress ?? t('driveDetail.title', 'Drive')} → ${drive.endAddress ?? ''}`
          : `Drive #${id}`,
      }}
      actions={
        <View style={styles.actions}>
          <PrintButton />
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.body}>
        {drive && stats ? (
          <>
            <SectionErrorBoundary
              name="drive-detail:header"
              fallbackTitle={t('driveDetail.section.headerFailed', 'Drive header failed to load')}
            >
              <DriveDetailHeader
                drive={drive}
                driveId={id ?? ''}
                vehicleName={vehicle?.display_name || t('driveDetail.vehicle', 'Vehicle')}
                onShare={() => setShareDialogOpen(true)}
              />
            </SectionErrorBoundary>
            {!hasMeaningfulDriveStats ? (
              <AlertBanner
                variant="info"
                title={t('driveDetail.noTelemetryTitle', 'No telemetry recorded for this drive')}
              >
                {t(
                  'driveDetail.noTelemetryBody',
                  'Only the start/end timestamps and battery levels are available. Distance, speed, energy and route data require live telemetry samples — none were captured during this drive.',
                )}
              </AlertBanner>
            ) : null}
            {hasMeaningfulDriveStats ? (
              <SectionErrorBoundary
                name="drive-detail:hero-gauges"
                fallbackTitle={t('driveDetail.section.heroGaugesFailed', 'Hero gauges failed to load')}
              >
                <HeroGauges drive={drive} stats={stats} />
              </SectionErrorBoundary>
            ) : null}
            <SectionErrorBoundary
              name="drive-detail:timeline"
              fallbackTitle={t('driveDetail.section.timelineFailed', 'Drive timeline failed to load')}
            >
              <DriveTimeline drive={drive} />
            </SectionErrorBoundary>
            {hasMeaningfulDriveStats ? (
              <SectionErrorBoundary
                name="drive-detail:stat-cards"
                fallbackTitle={t('driveDetail.section.statCardsFailed', 'Drive stats failed to load')}
              >
                <DriveStatCards drive={drive} stats={stats} />
              </SectionErrorBoundary>
            ) : null}
            {/*
              Per-drive coaching narrative (AI, opt-in). Wrapped in
              withAiFeature('drive-coaching', …) so it renders ONLY when
              ai_mode != 'off' AND the drive-coaching toggle is on. When AI is
              off the wrapper returns null and the surrounding sections are
              unaffected.
            */}
            <SectionErrorBoundary
              name="drive-detail:ai-coaching"
              fallbackTitle={t('driveDetail.section.aiCoachingFailed', 'Helix drive coaching failed to load')}
            >
              <AIDriveCoaching driveId={id} />
            </SectionErrorBoundary>
            {hasMeaningfulDriveStats ? (
              <SectionErrorBoundary
                name="drive-detail:more-details"
                fallbackTitle={t('driveDetail.section.moreDetailsFailed', 'More details failed to load')}
              >
                <MoreDetailsPanel drive={drive} stats={stats} />
              </SectionErrorBoundary>
            ) : null}
            {hasMeaningfulDriveStats ? (
              <SectionErrorBoundary
                name="drive-detail:energy-summary"
                fallbackTitle={t('driveDetail.section.energySummaryFailed', 'Energy summary failed to load')}
              >
                <EnergySummaryPanel drive={drive} stats={stats} />
              </SectionErrorBoundary>
            ) : null}
            {stats.energyWh > 0 ? (
              <SectionErrorBoundary
                name="drive-detail:cost-savings"
                fallbackTitle={t('driveDetail.section.costSavingsFailed', 'Cost savings panel failed to load')}
              >
                <CostSavingsPanel drive={drive} stats={stats} />
              </SectionErrorBoundary>
            ) : null}
            <SectionErrorBoundary
              name="drive-detail:route-map"
              fallbackTitle={t('driveDetail.section.routeMapFailed', 'Route map failed to load')}
            >
              <RouteMapSection
                drive={drive}
                trail={trail}
                startPos={startPos}
                endPos={endPos}
                centerPos={centerPos}
                speedSegments={speedSegments}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary
              name="drive-detail:journey-details"
              fallbackTitle={t('driveDetail.section.journeyDetailsFailed', 'Journey details failed to load')}
            >
              <JourneyDetailsPanel drive={drive} />
            </SectionErrorBoundary>
            {/*
              Every chart in this block reads `chartData` from the same source,
              so they share row indices. ChartTimeRangeProvider lets the synced
              cursor mirror across all charts; the brush in DriveOverviewChart
              zooms every synced chart simultaneously.
            */}
            <ChartTimeRangeProvider syncId="drive-detail">
              <SectionErrorBoundary
                name="drive-detail:overview-chart"
                fallbackTitle={t('driveDetail.section.overviewChartFailed', 'Drive overview chart failed to load')}
              >
                <DriveOverviewChart drive={drive} chartData={chartData} />
              </SectionErrorBoundary>
              <View style={styles.chartGrid}>
                <View style={styles.chartGridItem}>
                  <SectionErrorBoundary
                    name="drive-detail:soc-chart"
                    fallbackTitle={t('driveDetail.section.socChartFailed', 'SOC chart failed to load')}
                  >
                    <SocChart chartData={chartData} />
                  </SectionErrorBoundary>
                </View>
                <View style={styles.chartGridItem}>
                  <SectionErrorBoundary
                    name="drive-detail:elevation-chart"
                    fallbackTitle={t('driveDetail.section.elevationChartFailed', 'Elevation chart failed to load')}
                  >
                    <ElevationChart chartData={chartData} stats={stats} />
                  </SectionErrorBoundary>
                </View>
              </View>
              <View style={styles.chartGrid}>
                <View style={styles.chartGridItem}>
                  <SectionErrorBoundary
                    name="drive-detail:temperature"
                    fallbackTitle={t('driveDetail.section.temperatureFailed', 'Temperature section failed to load')}
                  >
                    <TemperatureSection chartData={chartData} stats={stats} />
                  </SectionErrorBoundary>
                </View>
                <View style={styles.chartGridItem}>
                  <SectionErrorBoundary
                    name="drive-detail:speed-histogram"
                    fallbackTitle={t('driveDetail.section.speedHistogramFailed', 'Speed histogram failed to load')}
                  >
                    <SpeedHistogramChart speedHistData={speedHistData} />
                  </SectionErrorBoundary>
                </View>
              </View>
              <SectionErrorBoundary
                name="drive-detail:ai-speed-profile-insights"
                fallbackTitle={t(
                  'driveDetail.section.aiSpeedProfileInsightsFailed',
                  'Helix speed-profile insights failed to load',
                )}
              >
                <AISpeedProfileInsights driveId={id} />
              </SectionErrorBoundary>
              <SectionErrorBoundary
                name="drive-detail:power-profile"
                fallbackTitle={t('driveDetail.section.powerProfileFailed', 'Power profile chart failed to load')}
              >
                <PowerProfileChart chartData={chartData} stats={stats} />
              </SectionErrorBoundary>
            </ChartTimeRangeProvider>
            <SectionErrorBoundary
              name="drive-detail:tire-pressure"
              fallbackTitle={t('driveDetail.section.tirePressureFailed', 'Tire pressure section failed to load')}
            >
              <TirePressureSection chartData={chartData} stats={stats} />
            </SectionErrorBoundary>
            {id ? (
              <SectionErrorBoundary
                name="drive-detail:why-ended"
                fallbackTitle={t('driveDetail.section.whyEndedFailed', 'Why-ended diagnostic failed to load')}
              >
                <WhyEndedPanel driveId={id} />
              </SectionErrorBoundary>
            ) : null}
          </>
        ) : null}
        {id ? (
          <ShareDriveDialog
            driveId={id}
            open={shareDialogOpen}
            onClose={() => setShareDialogOpen(false)}
          />
        ) : null}
      </ScrollView>
    </PageContainer>
  );
}

DriveDetailPage.displayName = 'DriveDetailPage';

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  alertBanner: {
    borderLeftWidth: 3,
    gap: spacing.xs,
    padding: spacing.md,
  },
  alertBody: {
    lineHeight: 20,
  },
  alertGlyph: {
    fontSize: 14,
  },
  alertHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  alertIcon: {
    marginRight: spacing.xs,
  },
  alertTitle: {
    flexShrink: 1,
  },
  backButton: {
    borderRadius: 12,
    padding: spacing.sm,
  },
  backIcon: {
    color: colors.textMuted,
    fontSize: 20,
  },
  body: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  chartEmpty: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  chartEmptyGlyph: {
    fontSize: 28,
    opacity: 0.3,
  },
  chartGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  chartGridItem: {
    flexBasis: '100%',
    flexGrow: 1,
    minWidth: 280,
  },
  chartStatGain: {
    color: '#10b981',
  },
  chartStatLoss: {
    color: '#ef4444',
  },
  chartStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  ghostButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  ghostButtonIcon: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  ghostButtonText: {
    color: colors.textPrimary,
  },
  ghostFullButton: {
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: spacing.sm,
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
  },
  headerTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  headerTitleBlock: {
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 160,
  },
  headerTitleIcon: {
    color: '#22d3ee',
    fontSize: 18,
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerVehicle: {
    fontSize: 13,
  },
  heroPanel: {
    overflow: 'hidden',
    padding: spacing.lg,
  },
  heroRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    justifyContent: 'center',
  },
  iconStatCard: {
    alignItems: 'center',
    flexBasis: '22%',
    flexGrow: 1,
    gap: 2,
    minWidth: 120,
    padding: spacing.md,
  },
  iconStatIcon: {
    fontSize: 14,
    marginBottom: 2,
  },
  iconStatLabel: {
    fontSize: 10,
    textAlign: 'center',
  },
  iconStatValue: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  journeyAddress: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  journeyCell: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    minWidth: 180,
  },
  journeyDateTime: {
    color: colors.textMuted,
    fontSize: 12,
  },
  journeyEndLabel: {
    color: '#ef4444',
  },
  journeyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  journeyHeadRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: 2,
  },
  journeyIconEnd: {
    color: '#ef4444',
    fontSize: 14,
  },
  journeyIconStart: {
    color: '#10b981',
    fontSize: 14,
  },
  journeyStartLabel: {
    color: '#10b981',
  },
  legendStatItem: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  legendStatLabel: {
    fontSize: 11,
  },
  legendStats: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  legendStatSwatch: {
    borderTopWidth: 2,
    width: 16,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendSwatch: {
    borderRadius: 2,
    height: 4,
    width: 12,
  },
  mapBanner: {
    marginTop: spacing.md,
    width: '100%',
  },
  mapEmpty: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  mapEmptyGlyph: {
    fontSize: 32,
    opacity: 0.3,
  },
  mapGlyph: {
    fontSize: 32,
    opacity: 0.4,
  },
  mapPlaceholder: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  mapPlaceholderText: {
    textAlign: 'center',
  },
  metricCell: {
    alignItems: 'center',
    flexBasis: '30%',
    flexGrow: 1,
    gap: 2,
    minWidth: 120,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricLabel: {
    fontSize: 10,
    textAlign: 'center',
  },
  metricSub: {
    fontSize: 11,
    textAlign: 'center',
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 17,
    textAlign: 'center',
  },
  metricValueSm: {
    fontSize: 14,
    textAlign: 'center',
  },
  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBody: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  modalCard: {
    maxHeight: '88%',
    paddingTop: spacing.md,
  },
  modalClose: {
    color: colors.textMuted,
    fontSize: 18,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  mono: {
    fontFamily: 'monospace',
  },
  outlineButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  outlineButtonIcon: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelDivider: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: spacing.xs,
  },
  panelHeading: {
    color: colors.textPrimary,
    fontSize: 15,
  },
  panelHeadingIcon: {
    fontSize: 14,
  },
  panelHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  powerStatAmber: {
    color: '#f59e0b',
  },
  powerStatCyan: {
    color: '#22d3ee',
  },
  powerStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: spacing.sm,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.accent,
  },
  routeEnd: {
    color: '#ef4444',
  },
  routeFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  routeLegend: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  routeStart: {
    color: '#10b981',
  },
  sectionError: {
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  sectionErrorTitle: {
    color: colors.textPrimary,
  },
  shareActionFlex: {
    flexGrow: 1,
  },
  shareActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  shareCreated: {
    color: '#10b981',
  },
  shareExisting: {
    gap: spacing.sm,
  },
  shareExistingHead: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  shareExpiryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  shareForm: {
    gap: spacing.md,
  },
  shareItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  shareItemInfo: {
    flexShrink: 1,
    gap: 2,
  },
  shareItemMeta: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  shareRevoke: {
    color: colors.danger,
    fontSize: 16,
  },
  signalColField: {
    flexBasis: '34%',
    flexGrow: 1,
  },
  signalColTs: {
    flexBasis: '34%',
    flexGrow: 1,
  },
  signalColValue: {
    flexBasis: '24%',
    flexGrow: 1,
  },
  signalHeadRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  signalRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  signalTable: {
    gap: 2,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
  },
  skelCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexBasis: '22%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 120,
    padding: spacing.md,
  },
  skelCardValue: {
    marginTop: spacing.xs,
  },
  skelChart: {
    gap: spacing.sm,
  },
  skelChartBody: {
    marginTop: spacing.xs,
  },
  skelHeader: {
    gap: spacing.sm,
  },
  textInput: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tempTile: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexBasis: '30%',
    flexGrow: 1,
    gap: 2,
    minWidth: 100,
    padding: spacing.sm,
  },
  tempTileValue: {
    fontSize: 14,
  },
  tempTiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  timeline: {
    gap: spacing.md,
  },
  timelineBarFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: '100%',
    width: '100%',
  },
  timelineBarTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 12,
    overflow: 'hidden',
  },
  timelineContent: {
    flexShrink: 1,
    gap: 2,
  },
  timelineDot: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: 10,
    marginTop: 4,
    width: 10,
  },
  timelineEnd: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  timelineEndText: {
    color: '#ef4444',
  },
  timelineFlagEnd: {
    color: '#ef4444',
    fontSize: 12,
  },
  timelineFlagStart: {
    color: '#10b981',
    fontSize: 12,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timelinePanel: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  timelineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timelineStartText: {
    color: '#10b981',
  },
  toggleLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    paddingRight: spacing.md,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  whyBody: {
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  whyChevron: {
    color: colors.textMuted,
    fontSize: 14,
  },
  whyChip: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  whyChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  whyChipText: {
    color: colors.textSecondary,
  },
  whyChipTextActive: {
    color: colors.accent,
  },
  whyEmpty: {
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  whyError: {
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  whyHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  whyLoading: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  whyRetry: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  whyRetryText: {
    color: colors.textPrimary,
  },
  whySectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  whySectionIcon: {
    color: colors.textMuted,
    fontSize: 14,
  },
  whyToggle: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.xs,
  },
  whyWindowRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
});
