// Native parity port of
// web/src/features/analytics/components/weekly-digest/useWeeklyDigest.ts.
//
// The web module is a non-visual data hook (rule 6: port the logic/types
// faithfully). It owns the Weekly Digest screen's week-offset + vehicle state,
// runs the drives / charging / alerts queries, and derives all aggregated
// metrics, the daily distance/energy bins, the alert-severity pie data, the
// "fun fact", and the prev/next-week navigation callbacks. There is no DOM,
// Recharts, Leaflet, framer-motion, or web UI-kit surface to translate — the
// return shape and every computation are preserved 1:1.
//
// Module mapping (rules 4/5), documented in the parity sidecar:
//   • @tanstack/react-query useQuery                -> same package (RN-safe).
//   • @/api/client request                          -> the already-ported
//     native api client (../../../../api/client).
//   • @/api/hooks/useVehicles useVehicles           -> the already-ported
//     native hook (../../../../api/hooks/useVehicles); its Vehicle carries the
//     same id / display_name / vin fields the web hook reads.
//   • @/components/charts CHART_COLORS              -> the already-ported native
//     charts barrel (../../../../components/charts); the same 8-entry CB-safe
//     palette, so CHART_COLORS[0] / [4] resolve identically.
//   • ./types, ./constants, ./helpers              -> inlined below verbatim
//     because those sibling modules are not yet ported to native; inlining
//     keeps this a single-file conversion (the established native precedent for
//     unported local dependencies) instead of pre-empting their own loop steps.
//   • @/lib/dateFormat formatDateShort             -> inlined; the web helper
//     renders {month:'short',day:'numeric'} in the host-default locale when
//     called with no options (as the web hook does), so the native inline
//     passes `undefined` to toLocaleDateString to use the device locale.
//   • @/lib/numberFormat fmtNumber                 -> inlined; the web helper
//     reads the settings-derived global locale singleton, so the native inline
//     reads the locale from the already-ported useSettings (default 'en-US')
//     and applies the same fixed-decimal, non-finite->0 formatting.
//   • @/lib/colors STATUS_COLORS (pulled in by ./constants) -> the three
//     traffic-light hexes inlined verbatim.
// No DOM elements, Tailwind classes, Recharts, Leaflet, framer-motion,
// react-dom, or web UI-kit modules are imported into the native output.

import {useCallback, useMemo, useState} from 'react';

import {useQuery} from '@tanstack/react-query';

import {request} from '../../../../api/client';
import {useSettings} from '../../../../api/hooks/useSettings';
import {useVehicles} from '../../../../api/hooks/useVehicles';
import {CHART_COLORS} from '../../../../components/charts';

/* ─── inlined ./types ─────────────────────────────────────────────────── */

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

/* ─── inlined ./constants ─────────────────────────────────────────────── */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const CITY_PAIRS = [
  {from: 'New York', to: 'Boston', km: 350},
  {from: 'LA', to: 'San Francisco', km: 615},
  {from: 'London', to: 'Paris', km: 460},
  {from: 'Berlin', to: 'Munich', km: 585},
  {from: 'Sydney', to: 'Melbourne', km: 880},
  {from: 'Tokyo', to: 'Osaka', km: 515},
] as const;

// Inlined from @/lib/colors STATUS_COLORS (traffic-light indicators).
const STATUS_COLORS = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
} as const;

const ALERT_SEVERITY_COLORS: Record<string, string> = {
  info: CHART_COLORS[0],
  warning: STATUS_COLORS.warning,
  critical: STATUS_COLORS.critical,
};

const CO2_PER_KWH_GASOLINE_KG = 0.21;

/* ─── inlined ./helpers ───────────────────────────────────────────────── */

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

/* ─── inlined @/lib/dateFormat formatDateShort + @/lib/numberFormat fmtNumber ─ */

const EM_DASH = '—';

// web @/lib/numberFormat safeNumber: nullish / non-finite inputs coerce to 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber(value, decimals): locale-aware fixed-decimal formatting with
// non-finite inputs coerced to 0; a bad locale tag falls back to en-US so a
// string is always produced. The web global locale comes from settings, which
// the native port reads from useSettings (see deriveLocale).
function fmtNumber(v: unknown, decimals: number, locale: string): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

// web @/lib/dateFormat formatDateShort with no options: "Apr 4" in the host's
// default locale; nullish / invalid inputs render the universal "—".
function formatDateShort(value: Date | string | null | undefined): string {
  if (!value) {
    return EM_DASH;
  }
  const d = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return EM_DASH;
  }
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

// web fmtNumber reads a settings-derived global locale (default 'en-US'); empty
// / whitespace-only tags fall back to 'en-US' to keep Intl from throwing.
function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : 'en-US';
}

export function useWeeklyDigest() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [vehicleId, setVehicleId] = useState<string>('');

  const [weekStart, weekEnd] = useMemo(() => getWeekRange(weekOffset), [weekOffset]);
  const [prevStart, prevEnd] = useMemo(() => getWeekRange(weekOffset - 1), [weekOffset]);

  const weekLabel = useMemo(
    () => `${formatDateShort(weekStart)} – ${formatDateShort(weekEnd)}`,
    [weekStart, weekEnd],
  );

  const isCurrentWeek = weekOffset === 0;

  /* ── Locale (settings-derived global locale equivalent) ── */
  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);

  /* ── Vehicle query ── */
  const {data: vehicles} = useVehicles();

  const vehicleOptions = useMemo(
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
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${selectedVehicleId}`),
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
    () => (chargingSessions ?? []).filter(c => isInRange(c.start_ts, weekStart, weekEnd)),
    [chargingSessions, weekStart, weekEnd],
  );

  const prevWeekCharging = useMemo(
    () => (chargingSessions ?? []).filter(c => isInRange(c.start_ts, prevStart, prevEnd)),
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
        ? prevWeekDrives.reduce((s, d) => s + d.efficiency_wh_km, 0) / prevDriveCount
        : 0;
    const totalDuration = weekDrives.reduce((s, d) => s + d.duration_min, 0);
    const topDrive =
      weekDrives.length > 0
        ? weekDrives.reduce((best, d) => (d.distance > best.distance ? d : best))
        : undefined;
    const chargeEnergyAdded = weekCharging.reduce((s, c) => s + c.total_energy_added_wh, 0);
    const prevChargeEnergy = prevWeekCharging.reduce((s, c) => s + c.total_energy_added_wh, 0);
    const avgChargeRate =
      weekCharging.length > 0
        ? weekCharging.reduce(
            (s, c) => s + (c.duration_min > 0 ? (c.total_energy_added_wh / c.duration_min) * 60 : 0),
            0,
          ) / weekCharging.length
        : 0;
    const batteryStart =
      weekCharging.length > 0
        ? weekCharging.reduce((s, c) => s + c.start_battery_pct, 0) / weekCharging.length
        : 0;
    const batteryEnd =
      weekCharging.length > 0
        ? weekCharging.reduce((s, c) => s + c.end_battery_pct, 0) / weekCharging.length
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
      return {from: pair.from, to: pair.to, times: fmtNumber(times, 1, locale)};
    }
    return {from: pair.from, to: pair.to, times: fmtNumber(times, 1, locale)};
  }, [metrics.totalDistance, locale]);

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
  };
}
