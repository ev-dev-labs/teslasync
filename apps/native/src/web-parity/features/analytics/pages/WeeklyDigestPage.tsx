// WeeklyDigestPage — native parity port of
// web/src/features/analytics/pages/WeeklyDigestPage.tsx.
//
// The weekly digest: a vehicle picker in the header, then (once a vehicle's
// drives/charging/alerts load) a WeekSelector, a SummaryHeroCards strip, and the
// Driving / Charging / Battery-Health / Alerts / Week-over-Week sections, capped
// by the AI digest narration. All of it is driven by the `useWeeklyDigest` hook
// which fans out three queries (/drives, /charging, /alerts), buckets them into
// the selected week vs. the previous week, and derives the `metrics` /
// `dailyDistanceData` / `dailyEnergyData` / `alertPieData` / `funFact` shapes the
// sections consume.
//
// This page orchestrates ~10 sibling pieces from the web `weekly-digest` barrel.
// Only `AlertsSection` + `HighlightCard` exist as standalone native parity files
// today, so — to keep this single-file conversion self-contained and pass the
// project-wide typecheck/lint gates without depending on unconverted siblings —
// the data engine (`useWeeklyDigest` + its helpers/constants/types) and the
// remaining presentational sections (WeekSelector, SummaryHeroCards,
// DrivingSection, ChargingSection, BatteryHealthSection, WeekOverWeekSummary,
// DigestSkeleton, MiniStat, BatteryPill, StatCard) are ported inline. The already
// converted `AlertsSection` + `HighlightCard` are imported and reused (no
// duplication), and the converted `AIDigestNarration` is rendered verbatim.
//
// Native adaptations (conversion-contract rules 4-7), behavior/state/keys/API
// intent preserved:
//   - react-i18next `useTranslation` (web L1/24) -> a native-safe t(key, fallback,
//     options?) shim preserving every analytics.weeklyDigest.* key, the English
//     fallback, and {{times}}/{{from}}/{{to}} interpolation.
//   - lucide-react icons (Calendar/Chevron/Car/Activity/Zap/Fuel/Leaf/MapPin/
//     BarChart3/Clock/TrendingUp/TrendingDown/Battery) -> SemanticIcon glyphs
//     rendered inline via GlyphIcon; lucide-react is browser-only.
//   - `@/components/layout` PageContainer (web L4/56-62) -> an inline RN
//     PageScaffold reproducing the web header (title/subtitle/actions) +
//     loading(spinner)/error(banner)/children(PageErrorBoundary) gating. Web
//     PageContainer short-circuits to a Spinner when `loading`, so the page's
//     own `isLoading ? <DigestSkeleton/>` branch is visually superseded — the
//     same is reproduced here (DigestSkeleton is ported but, like web, is
//     superseded by the scaffold spinner).
//   - `@/components/ui` Select (web L5/46-52) -> an inline RN Modal-based
//     VehicleSelect (options/value/onChange/placeholder preserved; the DOM
//     `<select>` change event `e.target.value` becomes a direct value callback).
//   - `@/components/feedback` EmptyState (web L6/66-73) -> an inline icon+title+
//     message empty state (the native shared EmptyState has no icon slot, so the
//     Calendar icon is preserved inline).
//   - `@/components/motion` FadeIn (web L7/75) -> a structural wrapper (the
//     section entrance animation is a non-essential web flourish; the deferred
//     reduced-motion FadeIn already shipped in AlertsSection covers the in-panel
//     case). The `space-y-8` rhythm becomes a vertical-gap stack.
//   - `@/components/ai/AIDigestNarration` (web L8/95-97) -> the native converted
//     AIDigestNarration (already withAiFeature-wrapped), rendered with the same
//     `vehicleId` expression.
//   - `@/hooks/usePageTitle` (web L9/25) -> a native-safe no-op (RN has no
//     document title); the call site + argument are preserved.
//   - `useWeeklyDigest` (web L12/27-43) + its helpers.ts/constants.ts/types.ts
//     and `@/hooks/useFormatting` formatCurrency -> ported inline. The three
//     queries keep their exact paths (`/drives?vehicle_id=`,
//     `/charging?vehicle_id=`, `/alerts`), query keys, `enabled` guards, all
//     metric math, the Mon..Sun daily bins, the alert pie, the city-pair fun
//     fact, and the week-navigation callbacks. formatCurrency is the no-settings
//     `$` + en-US fmtNumber(amount, 2) (native has no useSettings wired, matching
//     the existing AlertsSection en-US posture).
//   - the Recharts bar charts (DrivingSection/ChargingSection) -> a native-safe
//     DigestBarChart (per-day horizontal bars + formatted value), because RN has
//     no SVG Recharts backend / hover tooltip.
//
// No DOM/Recharts/Leaflet/react-i18next/framer-motion/lucide/old web-UI imports
// reach the native output — only react, react-native primitives, the canonical
// AppText + GlassPanel + SemanticIcon + theme tokens, the native chartUtils
// parity (CHART_COLORS, safe), the native request client + useVehicles hook, and
// the converted AlertsSection / HighlightCard / AIDigestNarration.
// See the .parity.json sidecar for the line-by-line source map.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {CHART_COLORS, safe} from '../../../components/charts/chartUtils';
import {AIDigestNarration} from '../../../components/ai/AIDigestNarration';
import {request} from '../../../api/client';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {AlertsSection} from '../components/weekly-digest/AlertsSection';
import {HighlightCard} from '../components/weekly-digest/HighlightCard';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
}

// ---- Native-safe usePageTitle (web @/hooks/usePageTitle) --------------------

/**
 * Web `usePageTitle` writes `"{title} — TeslaSync"` to `document.title`. React
 * Native has no browser tab / document title, so this is a no-op that preserves
 * the call site + argument (the `title` dep mirrors the web hook).
 */
function usePageTitle(title: string): void {
  useEffect(() => {
    // Intentional no-op: RN has no document.title to write.
  }, [title]);
}

// ---- Ported number/date formatting (web @/lib/numberFormat + dateFormat) -----
// en-US locale (native has no useSettings global precision/locale wired), the
// chartUtils `safe` guard, and the web "—" placeholder for unrenderable dates.

const DEFAULT_LOCALE = 'en-US';
const DATE_FALLBACK = '—';

function fmtNumber(value: unknown, decimals = 2): string {
  try {
    return safe(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safe(value).toFixed(decimals);
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

/** web @/hooks/useFormatting formatCurrency — no-settings `$` + fmtNumber. */
function formatCurrency(amount: number, decimals = 2): string {
  return `$${fmtNumber(amount, decimals)}`;
}

/** web @/lib/dateFormat formatDateShort — "Apr 4". */
function formatDateShort(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return DATE_FALLBACK;
  }
  return d.toLocaleDateString(DEFAULT_LOCALE, {month: 'short', day: 'numeric'});
}

/** web @/lib/dateFormat formatDate — "Apr 4, 2026". */
function formatDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return DATE_FALLBACK;
  }
  return d.toLocaleDateString(DEFAULT_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---- Ported colours (web @/lib/colors STATUS_COLORS + neon header tints) ----

const STATUS_COLORS = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
} as const;

// web `text-neon-cyan` / `text-neon-green` / `text-neon-purple` section heads.
const NEON_CYAN = '#22d3ee';
const NEON_GREEN = '#4ade80';
const NEON_PURPLE = '#c084fc';
// web change/trend `text-emerald-400` / `text-red-400`.
const EMERALD_400 = '#34d399';
const RED_400 = '#f87171';

// ---- Icon glyphs (web lucide-react) -----------------------------------------

const GLYPH = {
  calendar: getSemanticIconDefinition('calendar').glyph,
  chevronLeft: getSemanticIconDefinition('previous').glyph,
  chevronRight: getSemanticIconDefinition('next').glyph,
  car: getSemanticIconDefinition('vehicle').glyph,
  activity: getSemanticIconDefinition('activity').glyph,
  zap: getSemanticIconDefinition('bolt').glyph,
  fuel: getSemanticIconDefinition('fuel').glyph,
  leaf: getSemanticIconDefinition('leaf').glyph,
  mapPin: getSemanticIconDefinition('mapPinned').glyph,
  barChart: getSemanticIconDefinition('analytics').glyph,
  clock: getSemanticIconDefinition('clock').glyph,
  trendUp: getSemanticIconDefinition('trendUp').glyph,
  trendDown: getSemanticIconDefinition('trendDown').glyph,
  battery: getSemanticIconDefinition('battery').glyph,
} as const;

function GlyphIcon({
  glyph,
  color,
  size,
}: {
  glyph: string;
  color: string;
  size: number;
}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.glyph,
        {color, fontSize: Math.round(size * 0.6), width: size, lineHeight: size},
      ]}>
      {glyph}
    </AppText>
  );
}

// ---- Native Badge (web @/components/ui/Badge) -------------------------------

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}): React.ReactElement {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText style={[styles.badgeText, badgeTextColorStyles[variant]]}>
        {children}
      </AppText>
    </View>
  );
}

// ---- Ported types (web ./types.ts) ------------------------------------------

interface Drive {
  id: number;
  start_date: string;
  distance: number;
  duration_min: number;
  efficiency_wh_km: number;
  energy_used: number;
}

interface ChargingSession {
  id: number;
  start_ts: string;
  total_energy_added_wh: number;
  cost: number;
  duration_min: number;
  start_battery_pct: number;
  end_battery_pct: number;
}

interface Alert {
  id: number;
  severity: string;
  created_at: string;
}

interface DigestMetrics {
  totalDistance: number;
  prevDistance: number;
  totalDrives: number;
  prevDriveCount: number;
  energyUsed: number;
  prevEnergy: number;
  chargingCost: number;
  prevChargingCost: number;
  co2Saved: number;
  prevCo2: number;
  avgEfficiency: number;
  prevAvgEfficiency: number;
  totalDuration: number;
  topDrive: Drive | undefined;
  chargeEnergyAdded: number;
  prevChargeEnergy: number;
  avgChargeRate: number;
  chargingSessionCount: number;
  batteryStart: number;
  batteryEnd: number;
  alertsByType: Record<string, number>;
  alertTotal: number;
}

interface FunFact {
  from: string;
  to: string;
  times: string;
}

interface DailyDistanceEntry {
  day: string;
  distance: number;
}

interface DailyEnergyEntry {
  day: string;
  energy: number;
}

interface AlertPieEntry {
  name: string;
  value: number;
  color: string;
}

interface VehicleOption {
  value: string;
  label: string;
}

// ---- Ported constants (web ./constants.ts) ----------------------------------

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const CITY_PAIRS = [
  {from: 'New York', to: 'Boston', km: 350},
  {from: 'LA', to: 'San Francisco', km: 615},
  {from: 'London', to: 'Paris', km: 460},
  {from: 'Berlin', to: 'Munich', km: 585},
  {from: 'Sydney', to: 'Melbourne', km: 880},
  {from: 'Tokyo', to: 'Osaka', km: 515},
] as const;

const ALERT_SEVERITY_COLORS: Record<string, string> = {
  info: CHART_COLORS[0],
  warning: STATUS_COLORS.warning,
  critical: STATUS_COLORS.critical,
};

const CO2_PER_KWH_GASOLINE_KG = 0.21;

// ---- Ported helpers (web ./helpers.ts) --------------------------------------

function getWeekRange(offset: number): [Date, Date] {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + 1 + offset * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return [start, end];
}

function isInRange(dateStr: string, start: Date, end: Date): boolean {
  const d = new Date(dateStr);
  return d >= start && d <= end;
}

function dayOfWeekIndex(dateStr: string): number {
  const d = new Date(dateStr);
  const day = d.getDay();
  return day === 0 ? 6 : day - 1; // Mon=0 ... Sun=6
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

interface Trend {
  direction: 'up' | 'down' | 'flat';
  value: string;
  positive: boolean;
}

function trendFor(
  current: number,
  previous: number,
  invertPositive = false,
): Trend {
  const diff = current - previous;
  const pct = pctChange(current, previous);
  if (Math.abs(diff) < 0.01) {
    return {direction: 'flat', value: '0%', positive: true};
  }
  const isUp = diff > 0;
  return {
    direction: isUp ? 'up' : 'down',
    value: `${isUp ? '+' : ''}${fmtNumber(pct, 1)}%`,
    positive: invertPositive ? !isUp : isUp,
  };
}

function findCityPair(
  distanceKm: number,
): (typeof CITY_PAIRS)[number] | undefined {
  let best: (typeof CITY_PAIRS)[number] | undefined;
  let bestDiff = Infinity;
  for (const pair of CITY_PAIRS) {
    const diff = Math.abs(pair.km - distanceKm);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = pair;
    }
  }
  return best;
}

// ---- Ported data engine (web ./useWeeklyDigest.ts) --------------------------

interface UseWeeklyDigestResult {
  weekLabel: string;
  isCurrentWeek: boolean;
  isLoading: boolean;
  error: Error | null;
  hasData: boolean;
  metrics: DigestMetrics;
  dailyDistanceData: DailyDistanceEntry[];
  dailyEnergyData: DailyEnergyEntry[];
  alertPieData: AlertPieEntry[];
  funFact: FunFact | undefined;
  goToPrevWeek: () => void;
  goToNextWeek: () => void;
  vehicleOptions: VehicleOption[];
  selectedVehicleId: string;
  setVehicleId: (id: string) => void;
}

function useWeeklyDigest(): UseWeeklyDigestResult {
  const [weekOffset, setWeekOffset] = useState(0);
  const [vehicleId, setVehicleId] = useState<string>('');

  const [weekStart, weekEnd] = useMemo(
    () => getWeekRange(weekOffset),
    [weekOffset],
  );
  const [prevStart, prevEnd] = useMemo(
    () => getWeekRange(weekOffset - 1),
    [weekOffset],
  );

  const weekLabel = useMemo(
    () => `${formatDateShort(weekStart)} – ${formatDateShort(weekEnd)}`,
    [weekStart, weekEnd],
  );

  const isCurrentWeek = weekOffset === 0;

  /* ── Vehicle query ── */
  const {data: vehicles} = useVehicles();

  const vehicleOptions = useMemo<VehicleOption[]>(
    () =>
      (vehicles ?? []).map(v => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const selectedVehicleId = vehicleId || String(vehicles?.[0]?.id ?? '');

  /* ── Data queries ── */
  const {
    data: drives,
    isLoading: drivesLoading,
    error: drivesError,
  } = useQuery({
    queryKey: ['drives', selectedVehicleId],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${selectedVehicleId}`),
    enabled: !!selectedVehicleId,
  });

  const {
    data: chargingSessions,
    isLoading: chargingLoading,
    error: chargingError,
  } = useQuery({
    queryKey: ['charging', selectedVehicleId],
    queryFn: () =>
      request<ChargingSession[]>(`/charging?vehicle_id=${selectedVehicleId}`),
    enabled: !!selectedVehicleId,
  });

  const {
    data: alerts,
    isLoading: alertsLoading,
    error: alertsError,
  } = useQuery({
    queryKey: ['alerts', selectedVehicleId],
    queryFn: () => request<Alert[]>('/alerts'),
    enabled: !!selectedVehicleId,
  });

  const isLoading = drivesLoading || chargingLoading || alertsLoading;
  const error = drivesError || chargingError || alertsError;

  /* ── Filter data by week ── */
  const weekDrives = useMemo(
    () => (drives ?? []).filter(d => isInRange(d.start_date, weekStart, weekEnd)),
    [drives, weekStart, weekEnd],
  );

  const prevWeekDrives = useMemo(
    () => (drives ?? []).filter(d => isInRange(d.start_date, prevStart, prevEnd)),
    [drives, prevStart, prevEnd],
  );

  const weekCharging = useMemo(
    () =>
      (chargingSessions ?? []).filter(c =>
        isInRange(c.start_ts, weekStart, weekEnd),
      ),
    [chargingSessions, weekStart, weekEnd],
  );

  const prevWeekCharging = useMemo(
    () =>
      (chargingSessions ?? []).filter(c =>
        isInRange(c.start_ts, prevStart, prevEnd),
      ),
    [chargingSessions, prevStart, prevEnd],
  );

  const weekAlerts = useMemo(
    () => (alerts ?? []).filter(a => isInRange(a.created_at, weekStart, weekEnd)),
    [alerts, weekStart, weekEnd],
  );

  /* ── Aggregated metrics ── */
  const metrics: DigestMetrics = useMemo(() => {
    const totalDistance = weekDrives.reduce((s, d) => s + d.distance, 0);
    const prevDistance = prevWeekDrives.reduce((s, d) => s + d.distance, 0);
    const totalDrives = weekDrives.length;
    const prevDriveCount = prevWeekDrives.length;
    const energyUsed = weekDrives.reduce((s, d) => s + d.energy_used, 0);
    const prevEnergy = prevWeekDrives.reduce((s, d) => s + d.energy_used, 0);
    const chargingCost = weekCharging.reduce((s, c) => s + c.cost, 0);
    const prevChargingCost = prevWeekCharging.reduce((s, c) => s + c.cost, 0);
    const co2Saved = energyUsed * CO2_PER_KWH_GASOLINE_KG;
    const prevCo2 = prevEnergy * CO2_PER_KWH_GASOLINE_KG;
    const avgEfficiency =
      totalDrives > 0
        ? weekDrives.reduce((s, d) => s + d.efficiency_wh_km, 0) / totalDrives
        : 0;
    const prevAvgEfficiency =
      prevDriveCount > 0
        ? prevWeekDrives.reduce((s, d) => s + d.efficiency_wh_km, 0) /
          prevDriveCount
        : 0;
    const totalDuration = weekDrives.reduce((s, d) => s + d.duration_min, 0);
    const topDrive =
      weekDrives.length > 0
        ? weekDrives.reduce((best, d) => (d.distance > best.distance ? d : best))
        : undefined;
    const chargeEnergyAdded = weekCharging.reduce(
      (s, c) => s + c.total_energy_added_wh,
      0,
    );
    const prevChargeEnergy = prevWeekCharging.reduce(
      (s, c) => s + c.total_energy_added_wh,
      0,
    );
    const avgChargeRate =
      weekCharging.length > 0
        ? weekCharging.reduce(
            (s, c) =>
              s +
              (c.duration_min > 0
                ? (c.total_energy_added_wh / c.duration_min) * 60
                : 0),
            0,
          ) / weekCharging.length
        : 0;
    const batteryStart =
      weekCharging.length > 0
        ? weekCharging.reduce((s, c) => s + c.start_battery_pct, 0) /
          weekCharging.length
        : 0;
    const batteryEnd =
      weekCharging.length > 0
        ? weekCharging.reduce((s, c) => s + c.end_battery_pct, 0) /
          weekCharging.length
        : 0;

    const alertsByType: Record<string, number> = {};
    for (const a of weekAlerts) {
      alertsByType[a.severity] = (alertsByType[a.severity] ?? 0) + 1;
    }

    return {
      totalDistance,
      prevDistance,
      totalDrives,
      prevDriveCount,
      energyUsed,
      prevEnergy,
      chargingCost,
      prevChargingCost,
      co2Saved,
      prevCo2,
      avgEfficiency,
      prevAvgEfficiency,
      totalDuration,
      topDrive,
      chargeEnergyAdded,
      prevChargeEnergy,
      avgChargeRate,
      chargingSessionCount: weekCharging.length,
      batteryStart,
      batteryEnd,
      alertsByType,
      alertTotal: weekAlerts.length,
    };
  }, [weekDrives, prevWeekDrives, weekCharging, prevWeekCharging, weekAlerts]);

  /* ── Daily distance chart data ── */
  const dailyDistanceData: DailyDistanceEntry[] = useMemo(() => {
    const bins = DAY_LABELS.map(label => ({day: label as string, distance: 0}));
    for (const d of weekDrives) {
      const idx = dayOfWeekIndex(d.start_date);
      bins[idx].distance += d.distance;
    }
    return bins;
  }, [weekDrives]);

  /* ── Daily energy added chart data ── */
  const dailyEnergyData: DailyEnergyEntry[] = useMemo(() => {
    const bins = DAY_LABELS.map(label => ({day: label as string, energy: 0}));
    for (const c of weekCharging) {
      const idx = dayOfWeekIndex(c.start_ts);
      bins[idx].energy += c.total_energy_added_wh;
    }
    return bins;
  }, [weekCharging]);

  /* ── Alert pie data ── */
  const alertPieData: AlertPieEntry[] = useMemo(() => {
    return Object.entries(metrics.alertsByType).map(([severity, count]) => ({
      name: severity.charAt(0).toUpperCase() + severity.slice(1),
      value: count,
      color: ALERT_SEVERITY_COLORS[severity] ?? CHART_COLORS[4],
    }));
  }, [metrics.alertsByType]);

  /* ── Fun fact ── */
  const funFact: FunFact | undefined = useMemo(() => {
    if (metrics.totalDistance < 10) {
      return undefined;
    }
    const pair = findCityPair(metrics.totalDistance);
    if (!pair) {
      return undefined;
    }
    const times = metrics.totalDistance / pair.km;
    if (times >= 0.8) {
      return {from: pair.from, to: pair.to, times: fmtNumber(times, 1)};
    }
    return {from: pair.from, to: pair.to, times: fmtNumber(times, 1)};
  }, [metrics.totalDistance]);

  /* ── Navigation callbacks ── */
  const goToPrevWeek = useCallback(() => setWeekOffset(o => o - 1), []);
  const goToNextWeek = useCallback(() => {
    if (!isCurrentWeek) {
      setWeekOffset(o => o + 1);
    }
  }, [isCurrentWeek]);

  const hasData = weekDrives.length > 0 || weekCharging.length > 0;

  return {
    weekLabel,
    isCurrentWeek,
    isLoading,
    error: (error as Error | null) ?? null,
    hasData,
    metrics,
    dailyDistanceData,
    dailyEnergyData,
    alertPieData,
    funFact,
    goToPrevWeek,
    goToNextWeek,
    vehicleOptions,
    selectedVehicleId,
    setVehicleId,
  };
}

// ---- Shared inline UI atoms -------------------------------------------------

/** web ./MiniStat.tsx — icon + (label / value) row. */
function MiniStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.miniStat}>
      {icon ? <View style={styles.miniStatIcon}>{icon}</View> : null}
      <View style={styles.miniStatText}>
        <AppText tone="secondary" style={styles.miniStatLabel}>
          {label}
        </AppText>
        <AppText style={styles.miniStatValue}>{String(value)}</AppText>
      </View>
    </GlassPanel>
  );
}

/** web ./BatteryPill.tsx — battery icon + level + a fill track, coloured by level. */
function BatteryPill({
  level,
  label,
}: {
  level: number;
  label: string;
}): React.ReactElement {
  const color =
    level >= 60
      ? STATUS_COLORS.good
      : level >= 30
        ? STATUS_COLORS.warning
        : STATUS_COLORS.critical;

  return (
    <GlassPanel style={styles.batteryPill}>
      <GlyphIcon glyph={GLYPH.battery} color={color} size={20} />
      <View style={styles.miniStatText}>
        <AppText tone="secondary" style={styles.miniStatLabel}>
          {label}
        </AppText>
        <AppText style={[styles.batteryLevel, {color}]}>{fmtInt(level)}%</AppText>
      </View>
      <View style={styles.batteryTrack}>
        <View
          style={[
            styles.batteryFill,
            {width: `${Math.min(level, 100)}%`, backgroundColor: color},
          ]}
        />
      </View>
    </GlassPanel>
  );
}

/** web @/components/data-display StatCard (the subset WeekOverWeekSummary uses). */
function StatCard({
  label,
  value,
  unit,
  icon,
  trend,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: ReactNode;
  trend: Trend;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.statCard}>
      <View style={styles.statCardHead}>
        <View style={styles.statCardIcon}>{icon}</View>
        <AppText tone="secondary" style={styles.miniStatLabel}>
          {label}
        </AppText>
      </View>
      <View style={styles.statCardValueRow}>
        <AppText style={styles.statCardValue}>{value}</AppText>
        {unit ? (
          <AppText tone="muted" style={styles.statCardUnit}>
            {unit}
          </AppText>
        ) : null}
      </View>
      {trend.direction !== 'flat' ? (
        <View style={styles.statCardTrend}>
          <GlyphIcon
            glyph={trend.positive ? GLYPH.trendUp : GLYPH.trendDown}
            color={trend.positive ? EMERALD_400 : RED_400}
            size={14}
          />
          <AppText
            style={[
              styles.statCardTrendText,
              {color: trend.positive ? EMERALD_400 : RED_400},
            ]}>
            {trend.value}
          </AppText>
        </View>
      ) : null}
    </GlassPanel>
  );
}

/** Recharts BarChart -> native-safe per-day horizontal bars + formatted value. */
function DigestBarChart({
  title,
  data,
  color,
  formatValue,
  emptyMessage,
}: {
  title: string;
  data: Array<{day: string; value: number}>;
  color: string;
  formatValue: (value: number) => string;
  emptyMessage: string;
}): React.ReactElement {
  const max = Math.max(...data.map(item => safe(item.value)), 1);

  return (
    <GlassPanel style={styles.chartPanel}>
      <AppText tone="secondary" style={styles.chartTitle}>
        {title}
      </AppText>
      {data.length > 0 ? (
        <View style={styles.chartBars}>
          {data.map(item => (
            <View key={item.day} style={styles.chartRow}>
              <AppText variant="caption" style={styles.chartDay}>
                {item.day}
              </AppText>
              <View style={styles.chartTrack}>
                <View
                  style={[
                    styles.chartFill,
                    {
                      width: `${Math.max((safe(item.value) / max) * 100, 2)}%`,
                      backgroundColor: color,
                    },
                  ]}
                />
              </View>
              <AppText variant="caption" style={styles.chartValue}>
                {formatValue(safe(item.value))}
              </AppText>
            </View>
          ))}
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <AppText tone="muted" style={styles.chartEmpty}>
          {emptyMessage}
        </AppText>
      )}
    </GlassPanel>
  );
}

// ---- Sections (web ./*.tsx) -------------------------------------------------

/** web ./WeekSelector.tsx */
function WeekSelector({
  weekLabel,
  isCurrentWeek,
  onPrevWeek,
  onNextWeek,
  t,
}: {
  weekLabel: string;
  isCurrentWeek: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  t: NativeTFunction;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.weekSelector}>
      <Pressable
        accessibilityRole="button"
        onPress={onPrevWeek}
        style={({pressed}) => [styles.ghostButton, pressed && styles.pressed]}>
        <GlyphIcon
          glyph={GLYPH.chevronLeft}
          color={colors.textSecondary}
          size={16}
        />
        <AppText style={styles.ghostButtonLabel} variant="caption">
          {t('analytics.weeklyDigest.prevWeek', 'Previous')}
        </AppText>
      </Pressable>

      <View style={styles.weekLabelWrap}>
        <GlyphIcon
          glyph={GLYPH.calendar}
          color={colors.textSecondary}
          size={16}
        />
        <AppText weight="semibold" style={styles.weekLabel}>
          {weekLabel}
        </AppText>
        {isCurrentWeek ? (
          <Badge variant="info">
            {t('analytics.weeklyDigest.current', 'Current')}
          </Badge>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{disabled: isCurrentWeek}}
        disabled={isCurrentWeek}
        onPress={onNextWeek}
        style={({pressed}) => [
          styles.ghostButton,
          isCurrentWeek && styles.ghostButtonDisabled,
          pressed && styles.pressed,
        ]}>
        <GlyphIcon
          glyph={GLYPH.chevronRight}
          color={colors.textSecondary}
          size={16}
        />
        <AppText style={styles.ghostButtonLabel} variant="caption">
          {t('analytics.weeklyDigest.nextWeek', 'Next')}
        </AppText>
      </Pressable>
    </GlassPanel>
  );
}

/** web ./SummaryHeroCards.tsx — reuses the converted HighlightCard. */
function SummaryHeroCards({
  metrics,
  funFact,
  t,
}: {
  metrics: DigestMetrics;
  funFact: FunFact | undefined;
  t: NativeTFunction;
}): React.ReactElement {
  const iconColor = colors.textSecondary;
  return (
    <GlassPanel style={styles.sectionPanel}>
      <AppText weight="bold" style={styles.sectionTitle}>
        {t('analytics.weeklyDigest.weekSummary', 'Week Summary')}
      </AppText>
      <View style={styles.heroGrid}>
        <HighlightCard
          icon={<GlyphIcon glyph={GLYPH.car} color={iconColor} size={20} />}
          label={t('analytics.weeklyDigest.totalDistance', 'Total Distance')}
          value={`${fmtNumber(metrics.totalDistance, 1)} km`}
          change={trendFor(metrics.totalDistance, metrics.prevDistance)}
          color="cyan"
        />
        <HighlightCard
          icon={<GlyphIcon glyph={GLYPH.activity} color={iconColor} size={20} />}
          label={t('analytics.weeklyDigest.totalDrives', 'Total Drives')}
          value={fmtInt(metrics.totalDrives)}
          change={trendFor(metrics.totalDrives, metrics.prevDriveCount)}
          color="green"
        />
        <HighlightCard
          icon={<GlyphIcon glyph={GLYPH.zap} color={iconColor} size={20} />}
          label={t('analytics.weeklyDigest.energyUsed', 'Energy Used')}
          value={`${fmtNumber(metrics.energyUsed, 1)} kWh`}
          change={trendFor(metrics.energyUsed, metrics.prevEnergy, true)}
          color="purple"
        />
        <HighlightCard
          icon={<GlyphIcon glyph={GLYPH.fuel} color={iconColor} size={20} />}
          label={t('analytics.weeklyDigest.chargingCost', 'Charging Cost')}
          value={formatCurrency(metrics.chargingCost, 2)}
          change={trendFor(metrics.chargingCost, metrics.prevChargingCost, true)}
          color="amber"
        />
        <HighlightCard
          icon={<GlyphIcon glyph={GLYPH.leaf} color={iconColor} size={20} />}
          label={t('analytics.weeklyDigest.co2Saved', 'CO₂ Saved')}
          value={`${fmtNumber(metrics.co2Saved, 1)} kg`}
          change={trendFor(metrics.co2Saved, metrics.prevCo2)}
          color="green"
        />
        {funFact ? (
          <HighlightCard
            icon={<GlyphIcon glyph={GLYPH.mapPin} color={iconColor} size={20} />}
            label={t('analytics.weeklyDigest.funFact', 'Fun Fact')}
            value={`${funFact.times}×`}
            subtitle={t(
              'analytics.weeklyDigest.funFactDesc',
              '≈ {{times}}× {{from}} → {{to}}',
              {times: funFact.times, from: funFact.from, to: funFact.to},
            )}
            color="cyan"
          />
        ) : null}
      </View>
    </GlassPanel>
  );
}

/** web ./DrivingSection.tsx */
function DrivingSection({
  metrics,
  dailyDistanceData,
  t,
}: {
  metrics: DigestMetrics;
  dailyDistanceData: DailyDistanceEntry[];
  t: NativeTFunction;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.sectionPanel}>
      <View style={styles.sectionHead}>
        <GlyphIcon glyph={GLYPH.car} color={NEON_CYAN} size={20} />
        <AppText weight="bold" style={styles.sectionTitle}>
          {t('analytics.weeklyDigest.drivingSection', 'Driving')}
        </AppText>
      </View>

      <DigestBarChart
        title={t('analytics.weeklyDigest.dailyDistance', 'Daily Distance (km)')}
        data={dailyDistanceData.map(d => ({day: d.day, value: d.distance}))}
        color={CHART_COLORS[0]}
        formatValue={v => fmtInt(v)}
        emptyMessage={t(
          'analytics.weeklyDigest.noDailyDistance',
          'No driving distance data is available for this week.',
        )}
      />

      <View style={styles.statGrid}>
        <MiniStat
          label={t('analytics.weeklyDigest.avgEfficiency', 'Avg Efficiency')}
          value={`${fmtNumber(metrics.avgEfficiency, 1)} Wh/km`}
          icon={
            <GlyphIcon glyph={GLYPH.barChart} color={colors.textMuted} size={16} />
          }
        />
        <MiniStat
          label={t(
            'analytics.weeklyDigest.totalDrivingTime',
            'Total Driving Time',
          )}
          value={`${fmtInt(Math.floor(metrics.totalDuration / 60))}h ${fmtInt(
            metrics.totalDuration % 60,
          )}m`}
          icon={
            <GlyphIcon glyph={GLYPH.clock} color={colors.textMuted} size={16} />
          }
        />
        <MiniStat
          label={t(
            'analytics.weeklyDigest.efficiencyChange',
            'Efficiency Change',
          )}
          value={
            metrics.prevAvgEfficiency > 0
              ? `${fmtNumber(
                  pctChange(metrics.avgEfficiency, metrics.prevAvgEfficiency),
                  1,
                )}%`
              : '—'
          }
          icon={
            <GlyphIcon
              glyph={
                metrics.avgEfficiency <= metrics.prevAvgEfficiency
                  ? GLYPH.trendDown
                  : GLYPH.trendUp
              }
              color={
                metrics.avgEfficiency <= metrics.prevAvgEfficiency
                  ? EMERALD_400
                  : RED_400
              }
              size={16}
            />
          }
        />
        <MiniStat
          label={t('analytics.weeklyDigest.drivesCount', 'Drives')}
          value={fmtInt(metrics.totalDrives)}
          icon={
            <GlyphIcon glyph={GLYPH.activity} color={colors.textMuted} size={16} />
          }
        />
      </View>

      <GlassPanel style={styles.topDrivePanel}>
        {metrics.topDrive ? (
          <View style={styles.topDriveBody}>
            <Badge variant="success">
              {t('analytics.weeklyDigest.topDrive', 'Top Drive')}
            </Badge>
            <View style={styles.topDriveGrid}>
              <View style={styles.topDriveCell}>
                <AppText tone="secondary" style={styles.topDriveLabel}>
                  {t('analytics.weeklyDigest.date', 'Date')}
                </AppText>
                <AppText weight="semibold" style={styles.topDriveValue}>
                  {formatDate(metrics.topDrive.start_date)}
                </AppText>
              </View>
              <View style={styles.topDriveCell}>
                <AppText tone="secondary" style={styles.topDriveLabel}>
                  {t('analytics.weeklyDigest.distance', 'Distance')}
                </AppText>
                <AppText weight="semibold" style={styles.topDriveValue}>
                  {fmtNumber(metrics.topDrive.distance, 1)} km
                </AppText>
              </View>
              <View style={styles.topDriveCell}>
                <AppText tone="secondary" style={styles.topDriveLabel}>
                  {t('analytics.weeklyDigest.duration', 'Duration')}
                </AppText>
                <AppText weight="semibold" style={styles.topDriveValue}>
                  {fmtInt(metrics.topDrive.duration_min)} min
                </AppText>
              </View>
              <View style={styles.topDriveCell}>
                <AppText tone="secondary" style={styles.topDriveLabel}>
                  {t('analytics.weeklyDigest.efficiency', 'Efficiency')}
                </AppText>
                <AppText weight="semibold" style={styles.topDriveValue}>
                  {fmtNumber(metrics.topDrive.efficiency_wh_km, 1)} Wh/km
                </AppText>
              </View>
            </View>
          </View>
        ) : (
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available.
          <AppText tone="muted" style={styles.chartEmpty}>
            {t(
              'analytics.weeklyDigest.noTopDrive',
              'No top drive is available for this week yet.',
            )}
          </AppText>
        )}
      </GlassPanel>
    </GlassPanel>
  );
}

/** web ./ChargingSection.tsx */
function ChargingSection({
  metrics,
  dailyEnergyData,
  t,
}: {
  metrics: DigestMetrics;
  dailyEnergyData: DailyEnergyEntry[];
  t: NativeTFunction;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.sectionPanel}>
      <View style={styles.sectionHead}>
        <GlyphIcon glyph={GLYPH.zap} color={NEON_GREEN} size={20} />
        <AppText weight="bold" style={styles.sectionTitle}>
          {t('analytics.weeklyDigest.chargingSection', 'Charging')}
        </AppText>
      </View>

      <DigestBarChart
        title={t(
          'analytics.weeklyDigest.dailyEnergyAdded',
          'Daily Energy Added (kWh)',
        )}
        data={dailyEnergyData.map(d => ({day: d.day, value: d.energy}))}
        color={CHART_COLORS[1]}
        formatValue={v => fmtNumber(v, 1)}
        emptyMessage={t(
          'analytics.weeklyDigest.dailyEnergyAdded',
          'Daily Energy Added (kWh)',
        )}
      />

      <View style={styles.statGrid}>
        <MiniStat
          label={t('analytics.weeklyDigest.sessions', 'Sessions')}
          value={fmtInt(metrics.chargingSessionCount)}
          icon={<GlyphIcon glyph={GLYPH.zap} color={colors.textMuted} size={16} />}
        />
        <MiniStat
          label={t('analytics.weeklyDigest.totalEnergyAdded', 'Total Energy Added')}
          value={`${fmtNumber(metrics.chargeEnergyAdded, 1)} kWh`}
          icon={<GlyphIcon glyph={GLYPH.zap} color={colors.textMuted} size={16} />}
        />
        <MiniStat
          label={t('analytics.weeklyDigest.avgChargeRate', 'Avg Charge Rate')}
          value={`${fmtNumber(metrics.avgChargeRate, 1)} kW`}
          icon={
            <GlyphIcon glyph={GLYPH.activity} color={colors.textMuted} size={16} />
          }
        />
        <MiniStat
          label={t('analytics.weeklyDigest.totalCost', 'Total Cost')}
          value={formatCurrency(metrics.chargingCost, 2)}
          icon={<GlyphIcon glyph={GLYPH.fuel} color={colors.textMuted} size={16} />}
        />
      </View>

      <GlassPanel style={styles.energyVsRow}>
        <AppText tone="secondary" style={styles.topDriveLabel}>
          {t('analytics.weeklyDigest.energyVsLastWeek', 'Energy vs. Last Week')}
        </AppText>
        <Badge
          variant={
            metrics.chargeEnergyAdded >= metrics.prevChargeEnergy
              ? 'success'
              : 'warning'
          }>
          {metrics.prevChargeEnergy > 0
            ? `${fmtNumber(
                pctChange(metrics.chargeEnergyAdded, metrics.prevChargeEnergy),
                1,
              )}%`
            : '—'}
        </Badge>
      </GlassPanel>
    </GlassPanel>
  );
}

/** web ./BatteryHealthSection.tsx */
function BatteryHealthSection({
  metrics,
  t,
}: {
  metrics: DigestMetrics;
  t: NativeTFunction;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.sectionPanel}>
      <View style={styles.sectionHead}>
        <GlyphIcon glyph={GLYPH.battery} color={NEON_PURPLE} size={20} />
        <AppText weight="bold" style={styles.sectionTitle}>
          {t('analytics.weeklyDigest.batteryHealth', 'Battery Health')}
        </AppText>
      </View>

      <View style={styles.pillGrid}>
        <BatteryPill
          level={Math.round(metrics.batteryStart)}
          label={t(
            'analytics.weeklyDigest.avgBatteryStart',
            'Avg Battery at Charge Start',
          )}
        />
        <BatteryPill
          level={Math.round(metrics.batteryEnd)}
          label={t(
            'analytics.weeklyDigest.avgBatteryEnd',
            'Avg Battery at Charge End',
          )}
        />
      </View>

      <View style={styles.statGrid}>
        <MiniStat
          label={t('analytics.weeklyDigest.avgChargeGain', 'Avg Charge Gain')}
          value={`${fmtNumber(metrics.batteryEnd - metrics.batteryStart, 1)}%`}
          icon={
            <GlyphIcon glyph={GLYPH.trendUp} color={colors.textMuted} size={16} />
          }
        />
        <MiniStat
          label={t('analytics.weeklyDigest.chargeSessions', 'Charge Sessions')}
          value={fmtInt(metrics.chargingSessionCount)}
          icon={<GlyphIcon glyph={GLYPH.zap} color={colors.textMuted} size={16} />}
        />
        <MiniStat
          label={t('analytics.weeklyDigest.estRangeAdded', 'Est. Range Added')}
          value={`${fmtNumber(metrics.chargeEnergyAdded * 5.5, 0)} km`}
          icon={
            <GlyphIcon glyph={GLYPH.mapPin} color={colors.textMuted} size={16} />
          }
        />
      </View>
    </GlassPanel>
  );
}

/** web ./WeekOverWeekSummary.tsx */
function WeekOverWeekSummary({
  metrics,
  t,
}: {
  metrics: DigestMetrics;
  t: NativeTFunction;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.sectionPanel}>
      <AppText weight="bold" style={styles.sectionTitle}>
        {t('analytics.weeklyDigest.weekOverWeek', 'Week-over-Week Comparison')}
      </AppText>
      <View style={styles.heroGrid}>
        <StatCard
          label={t('analytics.weeklyDigest.distance', 'Distance')}
          value={fmtNumber(metrics.totalDistance, 1)}
          unit="km"
          icon={<GlyphIcon glyph={GLYPH.car} color={colors.textMuted} size={16} />}
          trend={trendFor(metrics.totalDistance, metrics.prevDistance)}
        />
        <StatCard
          label={t('analytics.weeklyDigest.drives', 'Drives')}
          value={fmtInt(metrics.totalDrives)}
          icon={
            <GlyphIcon glyph={GLYPH.activity} color={colors.textMuted} size={16} />
          }
          trend={trendFor(metrics.totalDrives, metrics.prevDriveCount)}
        />
        <StatCard
          label={t('analytics.weeklyDigest.energy', 'Energy')}
          value={fmtNumber(metrics.energyUsed, 1)}
          unit="kWh"
          icon={<GlyphIcon glyph={GLYPH.zap} color={colors.textMuted} size={16} />}
          trend={trendFor(metrics.energyUsed, metrics.prevEnergy, true)}
        />
        <StatCard
          label={t('analytics.weeklyDigest.cost', 'Cost')}
          value={formatCurrency(metrics.chargingCost, 2)}
          icon={<GlyphIcon glyph={GLYPH.fuel} color={colors.textMuted} size={16} />}
          trend={trendFor(metrics.chargingCost, metrics.prevChargingCost, true)}
        />
        <StatCard
          label={t('analytics.weeklyDigest.efficiency', 'Efficiency')}
          value={fmtNumber(metrics.avgEfficiency, 1)}
          unit="Wh/km"
          icon={
            <GlyphIcon glyph={GLYPH.barChart} color={colors.textMuted} size={16} />
          }
          trend={trendFor(metrics.avgEfficiency, metrics.prevAvgEfficiency, true)}
        />
        <StatCard
          label={t('analytics.weeklyDigest.co2', 'CO₂ Saved')}
          value={fmtNumber(metrics.co2Saved, 1)}
          unit="kg"
          icon={<GlyphIcon glyph={GLYPH.leaf} color={colors.textMuted} size={16} />}
          trend={trendFor(metrics.co2Saved, metrics.prevCo2)}
        />
      </View>
    </GlassPanel>
  );
}

/** web ./DigestSkeleton.tsx — superseded by the scaffold spinner (see header). */
function DigestSkeleton(): React.ReactElement {
  return (
    <View style={styles.skeletonStack}>
      <GlassPanel style={styles.skeletonPanel}>
        <View style={[styles.skeletonBar, styles.skeletonBarWide]} />
        <View style={[styles.skeletonBar, styles.skeletonBarNarrow]} />
      </GlassPanel>
      <GlassPanel style={styles.skeletonGrid}>
        {Array.from({length: 6}).map((_, i) => (
          <View key={i} style={styles.skeletonTile} />
        ))}
      </GlassPanel>
      <GlassPanel style={styles.skeletonPanel}>
        <View style={styles.skeletonChart} />
      </GlassPanel>
    </View>
  );
}

// ---- Vehicle Select (web @/components/ui Select) ----------------------------

function VehicleSelect({
  options,
  value,
  onChange,
  placeholder,
  t,
}: {
  options: VehicleOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  t: NativeTFunction;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const triggerLabel = selected ? selected.label : placeholder;

  return (
    <>
      <Pressable
        accessibilityLabel={t('analytics.weeklyDigest.selectVehicle', 'Select vehicle')}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={styles.selectTrigger}>
        <AppText numberOfLines={1} style={styles.selectTriggerText} variant="caption">
          {triggerLabel}
        </AppText>
        <AppText style={styles.selectChevron}>▾</AppText>
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel={t('common.dismiss', 'Dismiss')}
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View style={styles.modalCard}>
            <AppText style={styles.modalTitle} weight="semibold">
              {placeholder}
            </AppText>
            {options.length > 0 ? (
              options.map(option => {
                const isSelected = option.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{selected: isSelected}}
                    key={option.value}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    style={({pressed}) => [
                      styles.optionRow,
                      isSelected && styles.optionRowActive,
                      pressed && styles.pressed,
                    ]}>
                    <AppText
                      numberOfLines={1}
                      style={
                        isSelected ? styles.optionLabelActive : styles.optionLabel
                      }>
                      {option.label}
                    </AppText>
                    {isSelected ? (
                      <AppText style={styles.optionCheck}>✓</AppText>
                    ) : null}
                  </Pressable>
                );
              })
            ) : (
              <AppText tone="muted" style={styles.optionLabel}>
                {t('analytics.weeklyDigest.noData', 'No Data')}
              </AppText>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

// ---- Inline PageErrorBoundary (web feedback PageErrorBoundary) ---------------

class PageErrorBoundary extends React.Component<
  {pageName: string; children: ReactNode},
  {hasError: boolean}
> {
  state = {hasError: false};

  static getDerivedStateFromError() {
    return {hasError: true};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:page:${this.props.pageName}]`, {
      error: error.message,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <View accessibilityRole="alert" style={styles.pageError}>
        <AppText style={styles.pageErrorText} variant="caption">
          This page failed to render.
        </AppText>
      </View>
    );
  }
}

// ---- Page scaffold (web @/components/layout PageContainer) -------------------

function PageScaffold({
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
}): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} style={styles.scroll}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View accessibilityRole="alert" style={styles.errorBox}>
          <AppText style={styles.errorText} variant="caption">
            {error.message}
          </AppText>
        </View>
      ) : (
        <PageErrorBoundary pageName={title}>{children}</PageErrorBoundary>
      )}
    </ScrollView>
  );
}

// ---- Page --------------------------------------------------------------------

export default function WeeklyDigestPage(): React.ReactElement {
  const t = useNativeTranslationFallback();
  usePageTitle(t('analytics.weeklyDigest.title', 'Weekly Digest'));

  const {
    weekLabel,
    isCurrentWeek,
    isLoading,
    error,
    hasData,
    metrics,
    dailyDistanceData,
    dailyEnergyData,
    alertPieData,
    funFact,
    goToPrevWeek,
    goToNextWeek,
    vehicleOptions,
    selectedVehicleId,
    setVehicleId,
  } = useWeeklyDigest();

  const actions = (
    <VehicleSelect
      options={vehicleOptions}
      value={selectedVehicleId}
      onChange={value => setVehicleId(value)}
      placeholder={t('analytics.weeklyDigest.selectVehicle', 'Select vehicle')}
      t={t}
    />
  );

  return (
    <PageScaffold
      title={t('analytics.weeklyDigest.title', 'Weekly Digest')}
      subtitle={t(
        'analytics.weeklyDigest.subtitle',
        'Your driving and charging summary for the week',
      )}
      actions={actions}
      loading={isLoading}
      error={error}>
      {isLoading ? (
        <DigestSkeleton />
      ) : !hasData ? (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <View style={styles.emptyState}>
          <GlyphIcon glyph={GLYPH.calendar} color={colors.textMuted} size={40} />
          <AppText weight="semibold" style={styles.emptyTitle}>
            {t('analytics.weeklyDigest.noData', 'No Data')}
          </AppText>
          <AppText tone="muted" style={styles.emptyMessage}>
            {t(
              'analytics.weeklyDigest.noDataMessage',
              'No driving or charging data found for this week.',
            )}
          </AppText>
        </View>
      ) : (
        <View style={styles.sectionStack}>
          <WeekSelector
            weekLabel={weekLabel}
            isCurrentWeek={isCurrentWeek}
            onPrevWeek={goToPrevWeek}
            onNextWeek={goToNextWeek}
            t={t}
          />
          <SummaryHeroCards metrics={metrics} funFact={funFact} t={t} />
          <DrivingSection
            metrics={metrics}
            dailyDistanceData={dailyDistanceData}
            t={t}
          />
          <ChargingSection
            metrics={metrics}
            dailyEnergyData={dailyEnergyData}
            t={t}
          />
          <BatteryHealthSection metrics={metrics} t={t} />
          <AlertsSection metrics={metrics} alertPieData={alertPieData} />
          <WeekOverWeekSummary metrics={metrics} t={t} />
          {/*
            Weekly digest narration is wrapped by withAiFeature('digest-narration', …)
            so it renders as a no-op when ai_mode='off' OR the per-feature toggle is
            off (ADR-015 §I5 + §I6 + §I7). The deterministic template digest above is
            unchanged and remains the canonical baseline for every user.
          */}
          <AIDigestNarration
            vehicleId={selectedVehicleId ? Number(selectedVehicleId) : undefined}
          />
        </View>
      )}
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  // web lucide glyphs rendered as centred bold text.
  glyph: {
    textAlign: 'center',
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ---- scaffold (web PageContainer) ----
  scroll: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pageHeaderText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 180,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pageSubtitle: {
    maxWidth: 520,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  errorBox: {
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: colors.dangerSurface,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  pageError: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xl,
  },
  pageErrorText: {
    color: colors.textMuted,
  },

  // ---- section rhythm (web FadeIn space-y-8) ----
  sectionStack: {
    gap: spacing.xl,
  },
  sectionPanel: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },

  // ---- WeekSelector ----
  weekSelector: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  ghostButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  ghostButtonDisabled: {
    opacity: 0.4,
  },
  ghostButtonLabel: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  weekLabelWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  weekLabel: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  pressed: {
    opacity: 0.65,
  },

  // ---- hero / stat grids ----
  heroGrid: {
    gap: spacing.md,
  },
  statGrid: {
    gap: spacing.sm,
  },
  pillGrid: {
    gap: spacing.md,
  },

  // ---- MiniStat ----
  miniStat: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  miniStatIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniStatText: {
    flex: 1,
    gap: 2,
  },
  miniStatLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  miniStatValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },

  // ---- BatteryPill ----
  batteryPill: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  batteryLevel: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  batteryTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
    width: 64,
  },
  batteryFill: {
    borderRadius: 999,
    height: '100%',
  },

  // ---- StatCard ----
  statCard: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  statCardHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCardIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statCardValueRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statCardValue: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 28,
  },
  statCardUnit: {
    fontSize: 12,
    lineHeight: 18,
  },
  statCardTrend: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statCardTrendText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },

  // ---- DigestBarChart ----
  chartPanel: {
    gap: spacing.md,
    padding: spacing.md,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  chartBars: {
    gap: spacing.sm,
  },
  chartRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chartDay: {
    color: colors.textSecondary,
    width: 40,
  },
  chartTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flex: 1,
    height: 10,
    overflow: 'hidden',
  },
  chartFill: {
    borderRadius: 999,
    height: '100%',
  },
  chartValue: {
    color: colors.textPrimary,
    minWidth: 48,
    textAlign: 'right',
  },
  chartEmpty: {
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },

  // ---- top drive ----
  topDrivePanel: {
    padding: spacing.md,
  },
  topDriveBody: {
    gap: spacing.md,
  },
  topDriveGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  topDriveCell: {
    flexBasis: '45%',
    flexGrow: 1,
    gap: 2,
  },
  topDriveLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  topDriveValue: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },

  // ---- charging energy-vs-last-week ----
  energyVsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },

  // ---- Badge ----
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },

  // ---- DigestSkeleton ----
  skeletonStack: {
    gap: spacing.lg,
  },
  skeletonPanel: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  skeletonBar: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 14,
  },
  skeletonBarWide: {
    width: '60%',
  },
  skeletonBarNarrow: {
    width: '40%',
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    padding: spacing.lg,
  },
  skeletonTile: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexBasis: '30%',
    flexGrow: 1,
    height: 80,
  },
  skeletonChart: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    height: 220,
  },

  // ---- empty state (web feedback EmptyState) ----
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  emptyMessage: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },

  // ---- VehicleSelect ----
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    maxWidth: 200,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectTriggerText: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontWeight: '600',
  },
  selectChevron: {
    color: colors.textMuted,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  modalTitle: {
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  optionRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  optionRowActive: {
    backgroundColor: colors.surfaceSelected,
  },
  optionLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
  optionLabelActive: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontWeight: '600',
  },
  optionCheck: {
    color: colors.accent,
  },
});

// web Badge dark-mode backgrounds (bg-*-900 / bg-gray-700).
const badgeVariantStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {backgroundColor: '#1e3a8a'},
  success: {backgroundColor: '#14532d'},
  warning: {backgroundColor: '#713f12'},
  danger: {backgroundColor: '#7f1d1d'},
  neutral: {backgroundColor: '#374151'},
});

// web Badge dark-mode text (text-*-200 / text-gray-200).
const badgeTextColorStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  info: {color: '#bfdbfe'},
  success: {color: '#bbf7d0'},
  warning: {color: '#fef08a'},
  danger: {color: '#fecaca'},
  neutral: {color: '#e5e7eb'},
});
