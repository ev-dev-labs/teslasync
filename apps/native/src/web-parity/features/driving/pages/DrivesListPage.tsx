import {Glyph} from '../../../../components/icons/Glyph';
// DrivesListPage — native parity port of
// web/src/features/driving/pages/DrivesListPage.tsx.
//
// The Drive History hub: a sticky summary bar, an opt-in natural-language drive
// search (Helix), a structured search box (score:/from:/distance: kv-tokens plus
// free text over addresses + display-unit distance), active filter chips, a
// 6-KPI overview card with prior-period deltas, a metric-switcher trend chart
// (drives/distance/score/efficiency/cost), collection pills
// (all/anomalies/notable/commutes/tagged), a sort + CSV/JSON export controls bar,
// a bulk-select toolbar, the date-grouped drive list (per-drive DriveCard with
// score badge, distance/status badges, route, avg/max speed, battery delta,
// efficiency, energy cost), and pagination. Every state name, API path, SI
// unit handling (metres / m·s⁻¹ / Wh-per-km efficiency), filter/sort/pagination
// math, i18n key + English fallback, grade thresholds, and collection rule is
// preserved verbatim from the web source.
//
// Most web dependencies are unconverted siblings (lib/drivesAggregation,
// lib/searchQuery, lib/numberFormat, lib/dateFormat, lib/datePresets,
// lib/unitConversion, and the shared row components HistoryListRow / RouteDisplay
// / ScoreBadge / BatteryDelta / InlineMetric / DriveCard). Following the
// established self-contained convention (see ChargingListPage.tsx), native-safe
// equivalents of each are ported inline here; their canonical standalone native
// files remain owned by their own conversion turns. The one already-converted
// sibling — components/ai/AINLDriveSearch — is imported directly (matching
// BatteryHealthPage / WeeklyDigestPage / LiveLogsPage). Native adaptations vs.
// the web source (behaviour / state / keys / units kept):
//   - react-i18next useTranslation (web L2) -> native-safe t(key, fallback,
//     options?) with {{var}} interpolation (no i18n runtime in RN).
//   - lucide-react icons (web L4-7) -> emoji/text glyphs (lucide is browser-only).
//   - @/components/layout PageContainer + PageHeaderSticky (web L8-9) -> inline RN
//     PageContainer (single ScrollView + RefreshControl) + a non-floating sticky
//     summary header row (RN has no IntersectionObserver scroll-spy).
//   - @/components/ui GlassPanel/Badge/Button/Checkbox/Pagination (web L10-14) ->
//     inline RN equivalents.
//   - @/components/data-display SavedViewMenu/BulkActionsToolbar/DataFreshnessAuto/
//     KpiOverviewCard/MetricCard/DateGroupedList/HistoryListRow/ScoreBadge/
//     BatteryDelta/RouteDisplay/InlineMetric (web L15-23) -> inline RN equivalents.
//     SavedViewMenu (URL/localStorage-backed) is router-only and omitted.
//   - @/components/charts MetricSwitcherChart (web L22) -> inline RN
//     MetricSwitcherChart (metric pills + height-scaled native bars; recharts is
//     browser-only SVG). getValue point transforms are applied at the edge.
//   - @/components/feedback Skeleton/EmptyState/InlineCallout (web L24-26) ->
//     inline RN equivalents.
//   - @/components/forms RangePicker/VehicleSelect/PillFilterBar/SearchInput/
//     FilterBar/ActiveFilterChips (web L27-30) -> inline RN equivalents. The DOM
//     <a download> export is replaced with React Native Share.share of the same
//     /api/v1/export/drives URL (rule 7); the SearchInput history dropdown is
//     omitted (historyScope kept for parity).
//   - @/hooks useSavedViewUrl/useUrlState (web L21,31) -> the saved-view hook is
//     dropped (router-only); URL state collapses to one in-memory params store
//     (no react-router in RN) exposing the same get/setBatch semantics and
//     preserving every state name.
//   - @/components/motion FadeIn/StaggerContainer/StaggerItem (web L33-35) ->
//     passthrough Views (no framer-motion entrance primitive in this layer).
//   - @/api/hooks/useDriving useDrives/useBulkDeleteDrives (web L36) -> native
//     ../../../api/hooks/useDriving (identical args + /drives, /drives/bulk paths).
//   - @/hooks useFormatting/useUnits/usePageTitle/useSelectedVehicle +
//     @/lib/timezone useTimezone (web L37-41) -> inline native shims (useUnits/
//     useFormatting read the native useSettings; usePageTitle no-op; vehicle from
//     native useVehicles; timezone falls back to device-local day bucketing).
//   - @/features/onboarding NoVehicleSelected (web L42) -> inline RN version.
//   - @/components/mobile PullToRefresh (web L43) -> folded into PageContainer's
//     RefreshControl (the native idiom).
//   - @/components/ai/AINLDriveSearch (web L44) -> imported from the converted
//     native sibling (renders null unless AI is enabled, matching web).
//   - lib helpers (web L45-56) -> ported inline (only the transitively-used fns).
//
// No DOM/Recharts/Leaflet/react-router/react-i18next/framer-motion/lucide/old
// web-UI import reaches the native output — only react, react-native primitives,
// the canonical AppText/GlassPanel + theme tokens, the native driving/settings/
// vehicles hooks, and the already-native AINLDriveSearch.

import React, {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {AINLDriveSearch} from '../../../components/ai/AINLDriveSearch';
import {apiUrl} from '../../../api/client';
import {
  useBulkDeleteDrives,
  useDrives,
  type Drive,
} from '../../../api/hooks/useDriving';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';

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

function useTranslation(): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
  return {t};
}

// ---- Native-safe usePageTitle (web @/hooks/usePageTitle) --------------------

function usePageTitle(title: string): void {
  useEffect(() => {
    // React Native has no browser tab / document.title to write; no-op. The
    // title dependency mirrors the web hook so the effect re-runs on changes.
  }, [title]);
}

// ---- Accent palette (web @/lib/tokens neon colours, toned for body) ---------

type Accent = 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'blue';

const ACCENT_HEX: Record<Accent, string> = {
  cyan: '#22d3ee',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#a855f7',
  blue: '#3b82f6',
};

// ---- numberFormat (web @/lib/numberFormat), en-US, no settings precision ----

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// Web fmtCompact uses Intl `notation: 'compact'`, which is not in this project's
// TS lib set; a manual K/M/B compaction reproduces the en-US "12K"/"1.2M"/"1.2B"
// output and the `< threshold` verbatim-int passthrough.
function fmtCompact(v: unknown, threshold = 10_000): string {
  const n = safeNumber(v);
  if (Math.abs(n) < threshold) {
    return fmtInt(n);
  }
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const trim = (x: number): string => {
    const s = x.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  };
  if (abs >= 1e9) {
    return `${sign}${trim(abs / 1e9)}B`;
  }
  if (abs >= 1e6) {
    return `${sign}${trim(abs / 1e6)}M`;
  }
  return `${sign}${trim(abs / 1e3)}K`;
}

// ---- dateFormat (web @/lib/dateFormat) — subset this page uses --------------

const FALLBACK = '—';

function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function ymdInTz(d: Date, tz?: string): string | null {
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  if (!tz) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(d);
    const get = (type: string): string | undefined =>
      parts.find(p => p.type === type)?.value;
    const y = get('year');
    const m = get('month');
    const day = get('day');
    if (!y || !m || !day) {
      return null;
    }
    return `${y}-${m}-${day}`;
  } catch {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

function parseYmdToUtcMillis(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) {
    return null;
  }
  const [, ys, ms, ds] = m;
  return Date.UTC(Number(ys), Number(ms) - 1, Number(ds));
}

function daysBetweenYmd(target: string, today: string): number {
  const a = parseYmdToUtcMillis(target);
  const b = parseYmdToUtcMillis(today);
  if (a == null || b == null) {
    return 0;
  }
  return Math.round((b - a) / 86_400_000);
}

function formatRelativeDays(
  iso: string | Date | null | undefined,
  opts?: {tz?: string},
): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  const targetKey = ymdInTz(d, opts?.tz);
  const todayKey = ymdInTz(new Date(), opts?.tz);
  if (!targetKey || !todayKey) {
    return FALLBACK;
  }
  const diffDays = daysBetweenYmd(targetKey, todayKey);
  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 0) {
    return `in ${Math.abs(diffDays)}d`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  if (diffDays < 30) {
    return `${Math.floor(diffDays / 7)}w ago`;
  }
  if (diffDays < 365) {
    return `${Math.floor(diffDays / 30)}mo ago`;
  }
  return `${Math.floor(diffDays / 365)}y ago`;
}

function formatDayKey(key: string, opts?: {style?: 'short' | 'long'}): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) {
    return FALLBACK;
  }
  const [, ys, ms, ds] = m;
  const year = Number(ys);
  const month = Number(ms);
  const day = Number(ds);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return FALLBACK;
  }
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const style = opts?.style ?? 'long';
  const fmtOpts: Intl.DateTimeFormatOptions =
    style === 'short'
      ? {timeZone: 'UTC', month: 'short', day: 'numeric'}
      : {timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric'};
  return new Intl.DateTimeFormat('en-US', fmtOpts).format(noon);
}

function formatDurationMinutes(
  minutes: number | null | undefined,
  options: {subMinuteLabel?: string} = {},
): string {
  if (!isFiniteNumber(minutes) || minutes < 0) {
    return FALLBACK;
  }
  if (options.subMinuteLabel && minutes < 1) {
    return options.subMinuteLabel;
  }
  const h = Math.floor(minutes / 60);
  const m = formatRoundedInt(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Time-of-day only ("11:30 PM"); honours the active vehicle tz when present.
function formatTime(
  iso: string | Date | null | undefined,
  opts?: {tz?: string},
): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  const fmtOpts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  };
  if (opts?.tz) {
    fmtOpts.timeZone = opts.tz;
  }
  return d.toLocaleTimeString('en-US', fmtOpts);
}

// Full date + time ("Apr 4, 2026, 11:30 PM"); used for the select-drive aria.
function formatDateTime(
  iso: string | Date | null | undefined,
  opts?: {tz?: string},
): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  const fmtOpts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  if (opts?.tz) {
    fmtOpts.timeZone = opts.tz;
  }
  return d.toLocaleString('en-US', fmtOpts);
}

// ---- datePresets (web @/lib/datePresets) — subset this page uses -----------

interface DatePresetRange {
  start: string;
  end: string;
}

interface DatePreset {
  id: string;
  i18nKey: string;
  fallback: string;
  resolve: (now?: Date) => DatePresetRange;
}

function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DATE_PRESETS: DatePreset[] = [
  {
    id: 'today',
    i18nKey: 'date.preset.today',
    fallback: 'Today',
    resolve: (now = new Date()) => ({start: isoLocal(now), end: isoLocal(now)}),
  },
  {
    id: 'yesterday',
    i18nKey: 'date.preset.yesterday',
    fallback: 'Yesterday',
    resolve: (now = new Date()) => {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return {start: isoLocal(y), end: isoLocal(y)};
    },
  },
  {
    id: '7d',
    i18nKey: 'date.preset.last7',
    fallback: 'Last 7 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return {start: isoLocal(s), end: isoLocal(now)};
    },
  },
  {
    id: '30d',
    i18nKey: 'date.preset.last30',
    fallback: 'Last 30 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return {start: isoLocal(s), end: isoLocal(now)};
    },
  },
  {
    id: '90d',
    i18nKey: 'date.preset.last90',
    fallback: 'Last 90 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 89);
      return {start: isoLocal(s), end: isoLocal(now)};
    },
  },
  {
    id: 'mtd',
    i18nKey: 'date.preset.mtd',
    fallback: 'Month to date',
    resolve: (now = new Date()) => ({
      start: isoLocal(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: isoLocal(now),
    }),
  },
  {
    id: 'ytd',
    i18nKey: 'date.preset.ytd',
    fallback: 'Year to date',
    resolve: (now = new Date()) => ({
      start: isoLocal(new Date(now.getFullYear(), 0, 1)),
      end: isoLocal(now),
    }),
  },
  {
    id: '1y',
    i18nKey: 'date.preset.last1y',
    fallback: 'Last year',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setFullYear(s.getFullYear() - 1);
      return {start: isoLocal(s), end: isoLocal(now)};
    },
  },
  {
    id: 'all',
    i18nKey: 'date.preset.all',
    fallback: 'All time',
    resolve: (now = new Date()) => ({start: '2015-01-01', end: isoLocal(now)}),
  },
];

function getDatePreset(id: string): DatePreset | undefined {
  return DATE_PRESETS.find(p => p.id === id);
}

function matchPresetId(
  start: string,
  end: string,
  now?: Date,
): string | undefined {
  for (const preset of DATE_PRESETS) {
    const r = preset.resolve(now);
    if (r.start === start && r.end === end) {
      return preset.id;
    }
  }
  return undefined;
}

// ---- unitConversion (web @/lib/unitConversion, SI → display) ---------------

type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const SECONDS_PER_HOUR = 3600;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
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

// ---- drivesAggregation (web @/lib/drivesAggregation) -----------------------

type GradeLabel = 'A+' | 'A' | 'B' | 'C' | 'D' | '—';

interface Grade {
  label: GradeLabel;
  color: string;
  numeric: number | null;
}

const GRADE_PALETTE: Record<GradeLabel, {color: string; numeric: number | null}> =
  {
    'A+': {color: '#10b981', numeric: 4.5},
    A: {color: '#10b981', numeric: 4.0},
    B: {color: '#00f0ff', numeric: 3.0},
    C: {color: '#f59e0b', numeric: 2.0},
    D: {color: '#ef4444', numeric: 1.0},
    '—': {color: '#6b7280', numeric: null},
  };

function getEfficiency(drive: Drive): number | null {
  const batteryUsed = (drive.startBatteryPct ?? 0) - (drive.endBatteryPct ?? 0);
  if (drive.distanceM > 0 && batteryUsed > 0) {
    return (batteryUsed * 0.75 * 1000) / (drive.distanceM / 1000);
  }
  return null;
}

function gradeFromEfficiency(eff: number | null): Grade {
  if (eff == null) {
    return {label: '—', ...GRADE_PALETTE['—']};
  }
  let label: GradeLabel;
  if (eff < 130) {
    label = 'A+';
  } else if (eff < 160) {
    label = 'A';
  } else if (eff < 190) {
    label = 'B';
  } else if (eff < 220) {
    label = 'C';
  } else {
    label = 'D';
  }
  return {label, ...GRADE_PALETTE[label]};
}

function gradeFromNumeric(numeric: number | null): Grade {
  if (numeric == null || !Number.isFinite(numeric)) {
    return {label: '—', ...GRADE_PALETTE['—']};
  }
  let label: GradeLabel;
  if (numeric >= 4.25) {
    label = 'A+';
  } else if (numeric >= 3.5) {
    label = 'A';
  } else if (numeric >= 2.5) {
    label = 'B';
  } else if (numeric >= 1.5) {
    label = 'C';
  } else {
    label = 'D';
  }
  return {label, ...GRADE_PALETTE[label]};
}

interface PeriodStats {
  count: number;
  totalDistanceM: number;
  totalDurationS: number;
  avgEfficiencyWhKm: number | null;
  bestEfficiencyWhKm: number | null;
  topSpeedMps: number;
  longest: Drive | null;
  avgGradeNumeric: number | null;
  totalEnergyKwh: number;
}

function inDateRange(
  d: Drive,
  startDate?: string,
  endDate?: string,
  tz?: string,
): boolean {
  const day = localDayKey(d.startTs, tz);
  if (!day) {
    return true;
  }
  if (startDate && day < startDate) {
    return false;
  }
  if (endDate && day > endDate) {
    return false;
  }
  return true;
}

function computePeriodStats(
  drives: readonly Drive[],
  startDate?: string,
  endDate?: string,
  tz?: string,
): PeriodStats {
  let count = 0;
  let totalDistanceM = 0;
  let totalDurationS = 0;
  let topSpeedMps = 0;
  let longest: Drive | null = null;
  let effSum = 0;
  let effN = 0;
  let bestEff: number | null = null;
  let gradeSum = 0;
  let gradeN = 0;
  let totalEnergyKwh = 0;

  for (const d of drives) {
    if (!inDateRange(d, startDate, endDate, tz)) {
      continue;
    }
    count += 1;
    totalDistanceM += d.distanceM;
    totalDurationS += d.durationS;
    if ((d.maxSpeedMps ?? 0) > topSpeedMps) {
      topSpeedMps = d.maxSpeedMps ?? 0;
    }
    if (longest == null || d.distanceM > longest.distanceM) {
      longest = d;
    }

    const eff = getEfficiency(d);
    if (eff != null) {
      effSum += eff;
      effN += 1;
      if (bestEff == null || eff < bestEff) {
        bestEff = eff;
      }
    }

    const grade = gradeFromEfficiency(eff);
    if (grade.numeric != null) {
      gradeSum += grade.numeric;
      gradeN += 1;
    }

    if (
      d.startBatteryPct != null &&
      d.endBatteryPct != null &&
      d.startBatteryPct > d.endBatteryPct
    ) {
      totalEnergyKwh += (d.startBatteryPct - d.endBatteryPct) * 0.75;
    }
  }

  return {
    count,
    totalDistanceM,
    totalDurationS,
    topSpeedMps,
    longest,
    avgEfficiencyWhKm: effN > 0 ? effSum / effN : null,
    bestEfficiencyWhKm: bestEff,
    avgGradeNumeric: gradeN > 0 ? gradeSum / gradeN : null,
    totalEnergyKwh,
  };
}

function ymdToUtcMillis(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) {
    return null;
  }
  const [, ys, ms, ds] = m;
  return Date.UTC(Number(ys), Number(ms) - 1, Number(ds));
}

function utcMillisToYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function priorPeriod(
  startDate: string | undefined,
  endDate: string | undefined,
): {start: string; end: string} | null {
  if (!startDate || !endDate) {
    return null;
  }
  const startMs = ymdToUtcMillis(startDate);
  const endMs = ymdToUtcMillis(endDate);
  if (startMs == null || endMs == null) {
    return null;
  }
  const lengthDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
  const priorEndMs = startMs - 86_400_000;
  const priorStartMs = priorEndMs - (lengthDays - 1) * 86_400_000;
  return {
    start: utcMillisToYmd(priorStartMs),
    end: utcMillisToYmd(priorEndMs),
  };
}

function detectAnomalies(drives: readonly Drive[]): Drive[] {
  return drives.filter(
    d => gradeFromEfficiency(getEfficiency(d)).label === 'D',
  );
}

function detectNotable(drives: readonly Drive[]): Drive[] {
  if (drives.length === 0) {
    return [];
  }
  const sorted = [...drives].sort((a, b) => b.distanceM - a.distanceM);
  const cutoffIdx = Math.min(50, Math.max(1, Math.ceil(drives.length * 0.1)));
  const longTrips = new Set(sorted.slice(0, cutoffIdx).map(d => d.id));
  const result: Drive[] = [];
  const seen = new Set<number>();
  for (const d of drives) {
    const isAplus = gradeFromEfficiency(getEfficiency(d)).label === 'A+';
    if ((longTrips.has(d.id) || isAplus) && !seen.has(d.id)) {
      result.push(d);
      seen.add(d.id);
    }
  }
  return result;
}

function normaliseAddress(addr: string | null): string | null {
  if (!addr) {
    return null;
  }
  return addr.trim().toLowerCase().replace(/\s+/g, ' ');
}

function detectCommutes(
  drives: readonly Drive[],
  minOccurrences = 3,
): Drive[] {
  const counts = new Map<string, number>();
  for (const d of drives) {
    const a = normaliseAddress(d.startAddress);
    const b = normaliseAddress(d.endAddress);
    if (!a || !b) {
      continue;
    }
    const key = a < b ? `${a}::${b}` : `${b}::${a}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return drives.filter(d => {
    const a = normaliseAddress(d.startAddress);
    const b = normaliseAddress(d.endAddress);
    if (!a || !b) {
      return false;
    }
    const key = a < b ? `${a}::${b}` : `${b}::${a}`;
    return (counts.get(key) ?? 0) >= minOccurrences;
  });
}

interface DateGroup<T> {
  dateKey: string;
  items: T[];
}

function localDayKey(iso: string | null | undefined, tz?: string): string | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return ymdInTz(d, tz);
}

function groupByDate<T>(
  items: readonly T[],
  getDateKey: (item: T) => string | null,
): DateGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = getDateKey(item);
    if (!key) {
      continue;
    }
    const day = key.split('T')[0];
    const list = buckets.get(day) ?? [];
    list.push(item);
    buckets.set(day, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([dateKey, list]) => ({dateKey, items: list}));
}

type TrendMetric = 'drives' | 'distance' | 'score' | 'efficiency' | 'cost';

interface TrendPoint {
  date: string;
  value: number;
}

function dailyTrend(
  drives: readonly Drive[],
  metric: TrendMetric,
  tz?: string,
): TrendPoint[] {
  const buckets = new Map<
    string,
    {sum: number; count: number; best: number | null}
  >();
  for (const d of drives) {
    const day = localDayKey(d.startTs, tz);
    if (!day) {
      continue;
    }
    const b = buckets.get(day) ?? {sum: 0, count: 0, best: null};

    switch (metric) {
      case 'drives':
        b.sum += 1;
        break;
      case 'distance':
        b.sum += d.distanceM;
        break;
      case 'efficiency': {
        const eff = getEfficiency(d);
        if (eff != null) {
          b.sum += eff;
          b.count += 1;
        }
        break;
      }
      case 'score': {
        const g = gradeFromEfficiency(getEfficiency(d));
        if (g.numeric != null) {
          b.sum += g.numeric;
          b.count += 1;
        }
        break;
      }
      case 'cost':
        if (
          d.startBatteryPct != null &&
          d.endBatteryPct != null &&
          d.startBatteryPct > d.endBatteryPct
        ) {
          b.sum += (d.startBatteryPct - d.endBatteryPct) * 0.75;
        }
        break;
    }
    buckets.set(day, b);
  }

  const points: TrendPoint[] = Array.from(buckets.entries()).map(([date, b]) => {
    let value = 0;
    if (metric === 'efficiency' || metric === 'score') {
      value = b.count > 0 ? b.sum / b.count : 0;
    } else {
      value = b.sum;
    }
    return {date, value};
  });
  return points.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---- searchQuery (web @/lib/searchQuery) -----------------------------------

type CompareOp = '=' | '>' | '>=' | '<' | '<=';

interface KvToken {
  kind: 'kv';
  key: string;
  op: CompareOp;
  value: string;
}

interface TextToken {
  kind: 'text';
  value: string;
}

type SearchToken = KvToken | TextToken;

const TOKEN_RE = /(?:[^\s"]+|"[^"]*")+/g;
const KV_RE = /^([a-z][a-z0-9_-]*):(>=|<=|=|>|<)?(.*)$/i;

function parseSearchQuery(input: string): SearchToken[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }
  const out: SearchToken[] = [];
  const matches = trimmed.match(TOKEN_RE) ?? [];
  for (const raw of matches) {
    const unquoted =
      raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2
        ? raw.slice(1, -1)
        : raw;
    if (!unquoted) {
      continue;
    }
    const kv = KV_RE.exec(unquoted);
    if (kv) {
      const [, key, op, value] = kv;
      out.push({
        kind: 'kv',
        key: key.toLowerCase(),
        op: (op as CompareOp | undefined) ?? '=',
        value: value ?? '',
      });
    } else {
      out.push({kind: 'text', value: unquoted.toLowerCase()});
    }
  }
  return out;
}

type KvHandler<T> = (item: T, token: KvToken) => boolean | null;

interface MatchOptions<T> {
  text: (item: T) => Array<string | null | undefined>;
  kv?: Record<string, KvHandler<T>>;
}

function matchesTokens<T>(
  item: T,
  tokens: readonly SearchToken[],
  opts: MatchOptions<T>,
): boolean {
  if (tokens.length === 0) {
    return true;
  }
  const fields = opts.text(item).map(s => String(s ?? '').toLowerCase());
  for (const token of tokens) {
    if (token.kind === 'text') {
      if (!fields.some(f => f.includes(token.value))) {
        return false;
      }
      continue;
    }
    const handler = opts.kv?.[token.key];
    if (handler) {
      const verdict = handler(item, token);
      if (verdict === false) {
        return false;
      }
      if (verdict === true) {
        continue;
      }
    }
    const literal = `${token.key}:${token.value}`.toLowerCase();
    if (!fields.some(f => f.includes(literal))) {
      return false;
    }
  }
  return true;
}

function compareNumeric(value: number, op: CompareOp, target: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(target)) {
    return false;
  }
  switch (op) {
    case '>':
      return value > target;
    case '>=':
      return value >= target;
    case '<':
      return value < target;
    case '<=':
      return value <= target;
    case '=':
    default:
      return Math.abs(value - target) < 1e-9;
  }
}

// ---- App-hook native shims --------------------------------------------------

interface UnitPrefsLite {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefsLite} {
  const {data} = useSettings();
  const distance: DistanceUnitPref = data?.unit_of_length === 'mi' ? 'mi' : 'km';
  const speed: SpeedUnitPref = data?.unit_of_length === 'mi' ? 'mph' : 'km/h';
  const unitPrefs = useMemo<UnitPrefsLite>(
    () => ({distance, speed}),
    [distance, speed],
  );
  return {unitPrefs};
}

interface UseFormattingResult {
  costPerKwh: number;
  formatEnergyCost: (kwh: number) => string;
  formatCurrency: (amount: number, decimals?: number) => string;
}

function useFormatting(): UseFormattingResult {
  const {data} = useSettings();
  const costPerKwh = data?.base_cost_per_kwh ?? 0.12;
  const currencySymbol =
    data?.currency_symbol && data.currency_symbol.trim()
      ? data.currency_symbol
      : '$';
  const userPrecision =
    typeof data?.decimal_precision === 'number' &&
    Number.isFinite(data.decimal_precision) &&
    data.decimal_precision >= 0
      ? Math.floor(data.decimal_precision)
      : 2;
  const formatEnergyCost = useCallback(
    (kwh: number): string =>
      `${currencySymbol}${fmtNumber(kwh * costPerKwh, userPrecision)}`,
    [costPerKwh, currencySymbol, userPrecision],
  );
  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );
  return useMemo(
    () => ({costPerKwh, formatEnergyCost, formatCurrency}),
    [costPerKwh, formatEnergyCost, formatCurrency],
  );
}

function useSelectedVehicle(): {vehicleId: number | null} {
  const {data} = useVehicles();
  const vehicleId = data && data.length > 0 ? data[0].id : null;
  return {vehicleId};
}

// Web resolves the vehicle's IANA tz (or the browser tz for 'local'); native has
// no such provider wired here, so day-bucketing falls back to the device local
// calendar for both modes. The `mode` is preserved for call-site parity.
function useTimezone(_mode: 'vehicle' | 'local'): string | undefined {
  return undefined;
}

// ---- Small shared primitives ------------------------------------------------

function GlyphLegacyUnused({
  glyph,
  color,
  size = 13,
}: {
  glyph: string;
  color?: string;
  size?: number;
}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.glyph, {fontSize: size, color: color ?? colors.textMuted}]}>
      {glyph}
    </AppText>
  );
}

interface ChipButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  accentHex?: string;
  count?: number;
  glyph?: string;
  onPress?: () => void;
  testID?: string;
}

function ChipButton({
  label,
  active,
  disabled,
  accentHex,
  count,
  glyph,
  onPress,
  testID,
}: ChipButtonProps): React.ReactElement {
  const accent = accentHex ?? colors.accent;
  return (
    <Pressable
      disabled={disabled || !onPress}
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{selected: !!active, disabled: !!disabled}}
      style={[
        styles.chip,
        active && {borderColor: accent, backgroundColor: `${accent}22`},
        disabled && styles.chipDisabled,
      ]}>
      {glyph ? <Glyph glyph={glyph} color={active ? accent : undefined} /> : null}
      <AppText
        variant="caption"
        weight={active ? 'semibold' : 'regular'}
        style={[styles.chipLabel, active && {color: accent}]}>
        {label}
      </AppText>
      {count != null ? (
        <AppText variant="caption" tone="muted" style={styles.chipCount}>
          {fmtCompact(count)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

// ---- Badge (web @/components/ui Badge) -------------------------------------

type BadgeVariant = 'info' | 'warning' | 'success' | 'danger';

const BADGE_ACCENT: Record<BadgeVariant, Accent> = {
  info: 'cyan',
  warning: 'amber',
  success: 'green',
  danger: 'red',
};

function Badge({
  variant,
  glyph,
  children,
}: {
  variant: BadgeVariant;
  glyph?: string;
  children: ReactNode;
}): React.ReactElement {
  const hex = ACCENT_HEX[BADGE_ACCENT[variant]];
  return (
    <View style={[styles.badge, {borderColor: `${hex}55`, backgroundColor: `${hex}1a`}]}>
      {glyph ? <Glyph glyph={glyph} color={hex} size={11} /> : null}
      <AppText variant="caption" weight="semibold" style={{color: hex}}>
        {children}
      </AppText>
    </View>
  );
}

// ---- Button (web @/components/ui Button) -----------------------------------

function Button({
  variant = 'secondary',
  onPress,
  glyph,
  active,
  children,
  accessibilityLabel,
  testID,
}: {
  variant?: 'ghost' | 'secondary';
  onPress?: () => void;
  glyph?: string;
  active?: boolean;
  children: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{selected: !!active}}
      testID={testID}
      style={[
        styles.button,
        variant === 'ghost' && styles.buttonGhost,
        active && styles.buttonActive,
      ]}>
      {glyph ? (
        <Glyph glyph={glyph} color={active ? ACCENT_HEX.cyan : undefined} />
      ) : null}
      <AppText
        variant="caption"
        weight="semibold"
        style={active ? styles.buttonActiveText : undefined}>
        {children}
      </AppText>
    </Pressable>
  );
}

// ---- Checkbox (web @/components/ui Checkbox) -------------------------------

function Checkbox({
  checked,
  onChange,
  accessibilityLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  accessibilityLabel?: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{checked}}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={[styles.checkbox, checked && styles.checkboxOn]}>
      {checked ? <AppText style={styles.checkboxMark}>✓</AppText> : null}
    </Pressable>
  );
}

// ---- PageContainer (web @/components/layout PageContainer + PullToRefresh) ---

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  error?: Error | null;
  onRetry?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  children?: ReactNode;
}

function PageContainer({
  title,
  subtitle,
  actions,
  error,
  onRetry,
  refreshing,
  onRefresh,
  children,
}: PageContainerProps): React.ReactElement {
  return (
    <ScrollView
      style={styles.pageRoot}
      contentContainerStyle={styles.pageContent}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        ) : undefined
      }>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="secondary">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      {error ? <QueryError error={error} onRetry={onRetry ?? (() => {})} /> : null}
      {children}
    </ScrollView>
  );
}

// ---- FadeIn / Stagger (web @/components/motion) — passthrough Views ----------

function FadeIn({children}: {children: ReactNode; delay?: number}): React.ReactElement {
  return <View style={styles.section}>{children}</View>;
}

function StaggerContainer({children}: {children: ReactNode}): React.ReactElement {
  return <View>{children}</View>;
}

function StaggerItem({children}: {children: ReactNode}): React.ReactElement {
  return <View>{children}</View>;
}

// ---- feedback (web @/components/feedback) -----------------------------------

function Skeleton({height = 80}: {height?: number}): React.ReactElement {
  return <View style={[styles.skeleton, {height}]} />;
}

interface EmptyStateProps {
  message: string;
  title?: string;
  glyph?: string;
  action?: {label: string; onPress: () => void};
}

function EmptyState({
  message,
  title,
  glyph,
  action,
}: EmptyStateProps): React.ReactElement {
  return (
    <View style={styles.emptyState}>
      {glyph ? <Glyph glyph={glyph} size={26} /> : null}
      {title ? (
        <AppText weight="semibold" style={styles.emptyTitle}>
          {title}
        </AppText>
      ) : null}
      <AppText tone="muted" variant="caption" style={styles.emptyMessage}>
        {message}
      </AppText>
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          style={styles.emptyAction}>
          <AppText variant="caption" weight="semibold" style={styles.emptyActionText}>
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

type CalloutVariant = 'warning' | 'success' | 'info';

function InlineCallout({
  variant,
  glyph,
  action,
  children,
}: {
  variant: CalloutVariant;
  glyph?: string;
  action?: {label: string; onPress: () => void};
  children: ReactNode;
}): React.ReactElement {
  const accent =
    variant === 'warning'
      ? ACCENT_HEX.amber
      : variant === 'success'
      ? ACCENT_HEX.green
      : ACCENT_HEX.cyan;
  return (
    <View style={[styles.callout, {borderColor: `${accent}55`, backgroundColor: `${accent}14`}]}>
      {glyph ? <Glyph glyph={glyph} color={accent} /> : null}
      <AppText variant="caption" style={styles.calloutText}>
        {children}
      </AppText>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button">
          <AppText variant="caption" weight="semibold" style={{color: accent}}>
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function QueryError({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry: () => void;
}): React.ReactElement | null {
  const {t} = useTranslation();
  if (!error) {
    return null;
  }
  return (
    <View style={[styles.callout, styles.errorCallout]}>
      <Glyph glyph="⚠" color={ACCENT_HEX.red} />
      <AppText variant="caption" style={styles.calloutText}>
        {error.message || t('common.error', 'Something went wrong')}
      </AppText>
      <Pressable onPress={onRetry} accessibilityRole="button">
        <AppText variant="caption" weight="semibold" style={{color: ACCENT_HEX.red}}>
          {t('common.retry', 'Retry')}
        </AppText>
      </Pressable>
    </View>
  );
}

// ---- VehicleSelect (web @/components/forms VehicleSelect) — read-only chip ---

function VehicleSelect(): React.ReactElement {
  const {data} = useVehicles();
  const current = data && data.length > 0 ? data[0] : null;
  return (
    <View style={styles.vehicleSelect}>
      <Glyph glyph="🚗" />
      <AppText variant="caption" weight="semibold" style={styles.vehicleSelectText}>
        {current?.display_name ?? '—'}
      </AppText>
    </View>
  );
}

// ---- NoVehicleSelected (web features/onboarding NoVehicleSelected) ----------

function NoVehicleSelected({pageTitle}: {pageTitle: string}): React.ReactElement {
  const {t} = useTranslation();
  return (
    <PageContainer title={pageTitle}>
      <GlassPanel style={styles.noVehicle}>
        <Glyph glyph="🔋" size={34} />
        <AppText tone="muted" style={styles.noVehicleText}>
          {t('onboarding.noVehicle', 'Select a vehicle to view this page.')}
        </AppText>
      </GlassPanel>
    </PageContainer>
  );
}

// ---- forms (web @/components/forms) ----------------------------------------

function FilterBar({children}: {children: ReactNode}): React.ReactElement {
  return <View style={styles.filterBar}>{children}</View>;
}

function SearchInput({
  value,
  onChange,
  placeholder,
  testID,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  historyScope?: string;
  testID?: string;
}): React.ReactElement {
  return (
    <View style={styles.searchInput}>
      <Glyph glyph="🔍" size={13} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        testID={testID}
        style={styles.searchTextInput}
      />
      {value ? (
        <Pressable
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}>
          <Glyph glyph="✕" size={13} />
        </Pressable>
      ) : null}
    </View>
  );
}

interface FilterChipDescriptor {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

function ActiveFilterChips({
  filters,
  onClearAll,
}: {
  filters: readonly FilterChipDescriptor[];
  onClearAll: () => void;
}): React.ReactElement | null {
  if (filters.length === 0) {
    return null;
  }
  return (
    <View style={styles.activeChips}>
      {filters.map(f => (
        <Pressable
          key={f.key}
          onPress={f.onRemove}
          accessibilityRole="button"
          style={styles.activeChip}>
          <AppText variant="caption" tone="muted">
            {f.label}:{' '}
          </AppText>
          <AppText variant="caption" weight="semibold">
            {f.value}
          </AppText>
          <Glyph glyph="✕" size={11} />
        </Pressable>
      ))}
      {filters.length > 1 ? (
        <Pressable onPress={onClearAll} accessibilityRole="button" style={styles.activeChip}>
          <AppText variant="caption" weight="semibold" style={{color: ACCENT_HEX.cyan}}>
            Clear all
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

interface PillItem {
  key: string;
  label: string;
  count?: number;
  accent?: Accent;
  glyph?: string;
  disabled?: boolean;
}

function PillFilterBar({
  items,
  activeKey,
  onChange,
  testID,
}: {
  items: PillItem[];
  activeKey: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
  testID?: string;
}): React.ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pillRow}
      testID={testID}>
      {items.map(item => (
        <ChipButton
          key={item.key}
          label={item.label}
          count={item.count}
          glyph={item.glyph}
          accentHex={item.accent ? ACCENT_HEX[item.accent] : undefined}
          active={item.key === activeKey}
          disabled={item.disabled}
          onPress={item.disabled ? undefined : () => onChange(item.key)}
        />
      ))}
    </ScrollView>
  );
}

function RangePicker({
  value,
  onChange,
  triggerTestId,
}: {
  value: {start: string; end: string};
  onChange: (r: {start: string; end: string}) => void;
  align?: 'start' | 'end';
  triggerTestId?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const activeId = matchPresetId(value.start, value.end);
  const presets = DATE_PRESETS.filter(p =>
    ['today', '7d', '30d', '90d', 'mtd', 'ytd', '1y', 'all'].includes(p.id),
  );
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        testID={triggerTestId}
        style={styles.rangeTrigger}>
        <Glyph glyph="📅" />
        <AppText variant="caption" weight="semibold">
          {activeId
            ? getDatePreset(activeId)?.fallback ?? `${value.start} – ${value.end}`
            : `${value.start} – ${value.end}`}
        </AppText>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <AppText weight="semibold" style={styles.modalTitle}>
              Date range
            </AppText>
            {presets.map(p => {
              const r = p.resolve();
              const isActive = r.start === value.start && r.end === value.end;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    setOpen(false);
                    onChange(r);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{selected: isActive}}
                  style={[styles.modalRow, isActive && styles.modalRowActive]}>
                  <AppText weight={isActive ? 'semibold' : 'regular'}>
                    {p.fallback}
                  </AppText>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

interface FreshnessQueryLike {
  isFetching: boolean;
  refetch: () => unknown;
}

function DataFreshnessAuto({query}: {query: FreshnessQueryLike}): React.ReactElement {
  const {t} = useTranslation();
  return (
    <Pressable
      onPress={() => query.refetch()}
      accessibilityRole="button"
      style={styles.freshness}>
      <View
        style={[
          styles.freshnessDot,
          {backgroundColor: query.isFetching ? ACCENT_HEX.amber : ACCENT_HEX.green},
        ]}
      />
      <AppText variant="caption" tone="muted">
        {query.isFetching
          ? t('common.updating', 'Updating…')
          : t('common.updated', 'Updated')}
      </AppText>
    </Pressable>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange?: (s: number) => void;
}): React.ReactElement | null {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) {
    return null;
  }
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <View style={styles.pagination}>
      <Pressable
        disabled={page <= 1}
        onPress={() => onPageChange(page - 1)}
        accessibilityRole="button"
        style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}>
        <AppText variant="caption" weight="semibold">
          ‹ Prev
        </AppText>
      </Pressable>
      <AppText variant="caption" tone="muted">
        {`${fmtCompact(first)}–${fmtCompact(last)} of ${fmtCompact(total)}`}
      </AppText>
      <Pressable
        disabled={page >= totalPages}
        onPress={() => onPageChange(page + 1)}
        accessibilityRole="button"
        style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}>
        <AppText variant="caption" weight="semibold">
          Next ›
        </AppText>
      </Pressable>
    </View>
  );
}

// ---- data-display (web @/components/data-display) --------------------------

function SectionTitle({
  glyph,
  glyphColor,
  children,
  trailing,
}: {
  glyph?: string;
  glyphColor?: string;
  children: ReactNode;
  trailing?: ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.sectionTitleRow}>
      {glyph ? <Glyph glyph={glyph} color={glyphColor} size={15} /> : null}
      <AppText weight="semibold" style={styles.sectionTitleText}>
        {children}
      </AppText>
      {trailing}
    </View>
  );
}

type DeltaMetric = string | {direction: 'neutral'};

interface MetricDelta {
  metric: DeltaMetric;
  previous: number | null;
  current: number | null;
  display: 'percent';
}

function Delta({metric, previous, current}: MetricDelta): React.ReactElement | null {
  if (previous == null || current == null) {
    return null;
  }
  const diff = current - previous;
  const pctChange = previous !== 0 ? (diff / Math.abs(previous)) * 100 : null;
  const neutral =
    (typeof metric === 'object' && metric.direction === 'neutral') || diff === 0;
  // For cost-like metrics a decrease is good; everything else: an increase is
  // good. Mirrors the web Delta direction semantics at the display boundary.
  const downIsGood = metric === 'cost' || metric === 'efficiency';
  let color: string = colors.textMuted;
  if (!neutral) {
    const isGood = downIsGood ? diff < 0 : diff > 0;
    color = isGood ? ACCENT_HEX.green : ACCENT_HEX.red;
  }
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '–';
  return (
    <AppText variant="caption" style={[styles.delta, {color}]}>
      {`${arrow} ${
        pctChange == null ? '—' : `${fmtNumber(Math.abs(pctChange), 1)}%`
      }`}
    </AppText>
  );
}

function MetricCard({
  label,
  value,
  color = 'cyan',
  delta,
}: {
  label: string;
  value: string | number;
  color?: Accent;
  delta?: MetricDelta;
}): React.ReactElement {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricAccent, {backgroundColor: ACCENT_HEX[color]}]} />
      <AppText variant="caption" tone="muted" style={styles.metricLabel} numberOfLines={1}>
        {label}
      </AppText>
      <AppText weight="bold" style={styles.metricValue} numberOfLines={1}>
        {value}
      </AppText>
      {delta ? <Delta {...delta} /> : null}
    </View>
  );
}

interface ComparisonHeader {
  title: string;
  currentLabel?: string;
  comparisonLabel?: string;
}

function KpiOverviewCard({
  header,
  kpis,
  secondary,
  footer,
  testId,
}: {
  header: ComparisonHeader;
  kpis: ReactNode;
  secondary?: ReactNode;
  footer?: ReactNode;
  id?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.kpiCard} testID={testId}>
      <View style={styles.kpiHeader}>
        <AppText weight="semibold">{header.title}</AppText>
        {header.currentLabel ? (
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {header.currentLabel}
          </AppText>
        ) : null}
        {header.comparisonLabel ? (
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {header.comparisonLabel}
          </AppText>
        ) : null}
      </View>
      <View style={styles.kpiGrid}>{kpis}</View>
      {secondary ? <View style={styles.kpiSecondary}>{secondary}</View> : null}
      {footer ? <View>{footer}</View> : null}
    </GlassPanel>
  );
}

interface DateGroupedListGroup<T> {
  dateKey: string;
  dateLabel: string;
  relativeLabel?: string;
  summary?: ReactNode;
  items: T[];
}

function DateGroupedList<T>({
  groups,
  renderItem,
  itemKey,
}: {
  groups: readonly DateGroupedListGroup<T>[];
  renderItem: (item: T, indexInGroup: number) => ReactNode;
  itemKey?: (item: T, indexInGroup: number) => string | number;
}): React.ReactElement {
  return (
    <View style={styles.groupList}>
      {groups.map(group => (
        <View key={group.dateKey} style={styles.group}>
          <View style={styles.groupHeader}>
            <AppText variant="caption" weight="semibold">
              {group.dateLabel}
            </AppText>
            {group.relativeLabel ? (
              <AppText variant="caption" tone="muted">
                {` · ${group.relativeLabel}`}
              </AppText>
            ) : null}
            <View style={styles.groupRule} />
            {group.summary ? (
              <AppText variant="caption" tone="muted">
                {group.summary}
              </AppText>
            ) : null}
          </View>
          <View style={styles.groupItems}>
            {group.items.map((item, idx) => (
              <View key={itemKey ? itemKey(item, idx) : idx}>
                {renderItem(item, idx)}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

interface BulkAction {
  id: string;
  label: string;
  glyph?: string;
  variant?: 'danger' | 'default';
  confirm?: {title: string; description?: string; confirmLabel?: string};
  onClick: (ids: Array<string | number>) => void | Promise<void>;
}

function BulkActionsToolbar({
  selectedIds,
  total,
  onClear,
  actions,
  itemNoun,
}: {
  selectedIds: Array<string | number>;
  total: number;
  onClear: () => void;
  actions: BulkAction[];
  itemNoun: {one: string; other: string};
}): React.ReactElement | null {
  if (selectedIds.length === 0) {
    return null;
  }
  const noun = selectedIds.length === 1 ? itemNoun.one : itemNoun.other;
  const run = (action: BulkAction): void => {
    if (action.confirm) {
      Alert.alert(
        action.confirm.title,
        action.confirm.description,
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: action.confirm.confirmLabel ?? action.label,
            style: action.variant === 'danger' ? 'destructive' : 'default',
            onPress: () => {
              action.onClick(selectedIds);
            },
          },
        ],
        {cancelable: true},
      );
      return;
    }
    action.onClick(selectedIds);
  };
  return (
    <View style={styles.bulkBar}>
      <AppText variant="caption" weight="semibold">
        {`${selectedIds.length} / ${total} ${noun}`}
      </AppText>
      <View style={styles.bulkActions}>
        {actions.map(action => (
          <Pressable
            key={action.id}
            onPress={() => run(action)}
            accessibilityRole="button"
            style={[
              styles.bulkActionBtn,
              action.variant === 'danger' && styles.bulkActionDanger,
            ]}>
            {action.glyph ? (
              <Glyph
                glyph={action.glyph}
                color={action.variant === 'danger' ? ACCENT_HEX.red : undefined}
              />
            ) : null}
            <AppText
              variant="caption"
              weight="semibold"
              style={action.variant === 'danger' ? {color: ACCENT_HEX.red} : undefined}>
              {action.label}
            </AppText>
          </Pressable>
        ))}
        <Pressable onPress={onClear} accessibilityRole="button" style={styles.bulkActionBtn}>
          <AppText variant="caption" tone="muted">
            Clear
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

// ---- row components (web @/components/data-display) ------------------------

function ScoreBadge({
  grade,
  color,
}: {
  grade: GradeLabel;
  color: string;
  ariaLabel?: string;
}): React.ReactElement {
  return (
    <AppText weight="bold" style={[styles.scoreBadge, {color}]}>
      {grade}
    </AppText>
  );
}

function BatteryDelta({
  startPct,
  endPct,
}: {
  startPct: number | null | undefined;
  endPct: number | null | undefined;
}): React.ReactElement {
  const hasData =
    startPct != null &&
    endPct != null &&
    Number.isFinite(startPct) &&
    Number.isFinite(endPct);
  if (!hasData) {
    return (
      <View style={styles.inlineMetric}>
        <Glyph glyph="🔋" size={12} />
        <AppText variant="caption" tone="muted">
          —
        </AppText>
      </View>
    );
  }
  const delta = endPct - startPct;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const magnitude = Math.abs(delta);
  const tone = delta > 0 ? ACCENT_HEX.green : delta < 0 ? ACCENT_HEX.amber : colors.textMuted;
  const visible = delta === 0 ? '—' : `${sign}${magnitude}%`;
  return (
    <View style={styles.inlineMetric}>
      <Glyph glyph="🔋" size={12} />
      <AppText variant="caption" style={{color: tone}}>
        {visible}
      </AppText>
    </View>
  );
}

interface RouteEndpoint {
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
}

function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function endpointLabel(endpoint: RouteEndpoint): string | null {
  const addr = endpoint.address?.trim();
  if (addr) {
    return addr;
  }
  if (endpoint.lat != null && endpoint.lon != null) {
    return `📍 ${endpoint.lat.toFixed(2)}, ${endpoint.lon.toFixed(2)}`;
  }
  return null;
}

function RouteDisplay({
  start,
  end,
  roundTripThresholdM = 100,
}: {
  start: RouteEndpoint;
  end?: RouteEndpoint;
  roundTripThresholdM?: number;
}): React.ReactElement {
  const {t} = useTranslation();
  const startLabel = endpointLabel(start);
  const endLabel = end ? endpointLabel(end) : null;
  const noLocation = t('route.noLocationData', 'No location data');
  const hasCoords = (
    e: RouteEndpoint | undefined,
  ): e is {lat: number; lon: number} => !!e && e.lat != null && e.lon != null;
  const addressesMatch = !!startLabel && !!endLabel && startLabel === endLabel;
  const coordsClose =
    hasCoords(start) &&
    hasCoords(end) &&
    haversineMeters(start.lat, start.lon, end.lat, end.lon) <
      roundTripThresholdM;
  const isExplicitSingle = !end;
  const isRoundTrip =
    !!startLabel &&
    (isExplicitSingle || addressesMatch || (coordsClose && !!startLabel));

  let body: React.ReactNode;
  if (!startLabel && !endLabel) {
    body = (
      <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.routeFade}>
        {noLocation}
      </AppText>
    );
  } else if (isRoundTrip) {
    body = (
      <AppText variant="caption" tone="secondary" numberOfLines={1} style={styles.routeText}>
        {startLabel}
        {!isExplicitSingle ? ` ↻ ${t('route.roundTrip', 'round trip')}` : ''}
      </AppText>
    );
  } else {
    body = (
      <AppText variant="caption" tone="secondary" numberOfLines={1} style={styles.routeText}>
        {`${startLabel ?? noLocation} → ${endLabel ?? noLocation}`}
      </AppText>
    );
  }

  return (
    <View style={styles.routeRow}>
      <Glyph glyph="📍" size={11} />
      {body}
    </View>
  );
}

function InlineMetric({
  glyph,
  value,
}: {
  glyph: string;
  value: string | number;
}): React.ReactElement {
  return (
    <View style={styles.inlineMetric}>
      <Glyph glyph={glyph} size={12} />
      <AppText variant="caption" tone="muted">
        {value}
      </AppText>
    </View>
  );
}

function HistoryListRow({
  checkbox,
  leading,
  primary,
  route,
  metrics,
  selected,
  testID,
}: {
  checkbox?: ReactNode;
  leading?: ReactNode;
  primary: ReactNode;
  route?: ReactNode;
  metrics?: ReactNode;
  selected?: boolean;
  testID?: string;
}): React.ReactElement {
  // Web wraps the body in a router <Link to={`/drives/:id`}>; native has no
  // router in this layer, so the row is a non-navigable card (drive-detail
  // navigation unavailable). The checkbox stays interactive for bulk select.
  return (
    <View style={styles.rowWrap} testID={testID}>
      {checkbox != null ? <View style={styles.rowCheckbox}>{checkbox}</View> : null}
      <GlassPanel style={[styles.rowBody, selected && styles.rowBodySelected]}>
        <View style={styles.rowInner}>
          {leading != null ? <View style={styles.rowLeading}>{leading}</View> : null}
          <View style={styles.rowMain}>
            <View style={styles.rowPrimary}>{primary}</View>
            {route ? <View style={styles.rowRoute}>{route}</View> : null}
            {metrics ? <View style={styles.rowMetrics}>{metrics}</View> : null}
          </View>
          <Glyph glyph="›" size={16} />
        </View>
      </GlassPanel>
    </View>
  );
}

// ---- charts (web @/components/charts MetricSwitcherChart) -------------------
// recharts is browser-only SVG; the native switcher keeps the metric pills and
// renders the active series as height-scaled native bars (line metrics included).
// `getValue` point transforms (distance/efficiency/cost) are applied at the edge.

interface MetricSwitcherMetric<P> {
  key: string;
  label: string;
  chart: 'bar' | 'line';
  color: string;
  accent: Accent;
  getValue?: (p: P) => number;
  formatValue: (v: number) => string;
  formatTick: (v: number) => string;
}

function MetricSwitcherChart({
  title,
  series,
  metrics,
  activeMetric,
  onMetricChange,
  formatXTick,
  emptyMessage,
  testId,
}: {
  title: string;
  ariaLabel?: string;
  series: Record<string, Array<{date: string; value: number}>>;
  metrics: MetricSwitcherMetric<{date: string; value: number}>[];
  activeMetric: string;
  onMetricChange: (key: string) => void;
  formatXTick: (key: string) => string;
  emptyMessage: string;
  testId?: string;
}): React.ReactElement {
  const active = metrics.find(m => m.key === activeMetric) ?? metrics[0];
  const rawPoints = series[activeMetric] ?? [];
  const points = rawPoints.map(p => ({
    date: p.date,
    value: active?.getValue ? active.getValue(p) : p.value,
  }));
  const values = points.map(p => p.value);
  const max = values.length > 0 ? Math.max(...values, 0) : 0;
  const hasData = points.length > 0 && max > 0;
  const labelEvery = Math.max(1, Math.floor(points.length / 4));
  return (
    <GlassPanel style={styles.chartCard} testID={testId}>
      <SectionTitle glyph="📈" glyphColor={active?.color}>
        {title}
      </SectionTitle>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}>
        {metrics.map(m => (
          <ChipButton
            key={m.key}
            label={m.label}
            accentHex={m.color}
            active={m.key === activeMetric}
            onPress={() => onMetricChange(m.key)}
          />
        ))}
      </ScrollView>
      {hasData ? (
        <>
          <View style={styles.chartBars}>
            {points.map((p, i) => {
              const h = Math.max(3, (p.value / max) * 96);
              return (
                <View key={`${p.date}-${i}`} style={styles.chartBarCol}>
                  <View
                    style={[
                      styles.chartBar,
                      {height: h, backgroundColor: active?.color ?? colors.accent},
                    ]}
                  />
                </View>
              );
            })}
          </View>
          <View style={styles.chartAxis}>
            {points.map((p, i) =>
              i % labelEvery === 0 ? (
                <AppText key={`${p.date}-x`} variant="caption" tone="muted" style={styles.chartTick}>
                  {formatXTick(p.date)}
                </AppText>
              ) : null,
            )}
          </View>
          <AppText variant="caption" tone="muted">
            {`Peak ${active?.formatValue(max) ?? fmtNumber(max)}`}
          </AppText>
        </>
      ) : (
        <EmptyState message={emptyMessage} />
      )}
    </GlassPanel>
  );
}

// ---- DriveCard (web ../components DriveCard) --------------------------------

interface DriveCardProps {
  drive: Drive;
  toDistanceDisplay: (v: number) => number;
  toSpeedDisplay: (v: number) => number;
  toEfficiencyDisplay: (v: number) => number;
  distanceUnit: string;
  speedUnit: string;
  efficiencyUnit: string;
  formatEnergyCost?: (kwh: number) => string;
  selected?: boolean;
  onToggleSelect?: (id: number, on: boolean) => void;
  tz?: string;
  isAnomaly?: boolean;
}

function DriveCardImpl({
  drive,
  toDistanceDisplay,
  toSpeedDisplay,
  toEfficiencyDisplay,
  distanceUnit,
  speedUnit,
  efficiencyUnit,
  formatEnergyCost,
  selected,
  onToggleSelect,
  tz,
  isAnomaly,
}: DriveCardProps): React.ReactElement {
  const {t} = useTranslation();
  const actualDistance = drive.distanceM;
  const isCompleted = drive.endTs != null;
  const hasData = actualDistance > 0 || drive.durationS > 0;
  const avgSpeed =
    drive.avgSpeedMps != null
      ? fmtInt(toSpeedDisplay(drive.avgSpeedMps))
      : drive.durationS > 0 && actualDistance > 0
      ? fmtInt(toSpeedDisplay(actualDistance / drive.durationS))
      : '—';
  const eff = getEfficiency(drive);
  const effConverted = eff ? toEfficiencyDisplay(eff) : null;
  const score = gradeFromEfficiency(eff);
  const hasBattery =
    drive.startBatteryPct !== null &&
    drive.endBatteryPct !== null &&
    !(
      drive.startBatteryPct === 0 &&
      drive.endBatteryPct === 0 &&
      isCompleted
    );

  const showCheckbox = typeof onToggleSelect === 'function';

  const checkbox = showCheckbox ? (
    <Checkbox
      checked={!!selected}
      onChange={next => onToggleSelect?.(drive.id, next)}
      accessibilityLabel={t('drives.selectDrive', 'Select drive on {{date}}', {
        date: formatDateTime(drive.startTs, {tz}),
      })}
    />
  ) : undefined;

  const primary = (
    <>
      <AppText weight="semibold" style={styles.driveTime}>
        {formatTime(drive.startTs, {tz})}
      </AppText>
      <AppText variant="caption" tone="muted">
        ·
      </AppText>
      <AppText variant="caption" tone="muted">
        {formatDurationMinutes(drive.durationS / 60)}
      </AppText>
      {hasData ? (
        <Badge variant="info">
          {`${fmtNumber(toDistanceDisplay(actualDistance))} ${distanceUnit}`}
        </Badge>
      ) : isCompleted ? (
        <Badge variant="warning">{t('drives.noTelemetry', 'No telemetry')}</Badge>
      ) : (
        <Badge variant="success">{t('drives.inProgress', 'In progress')}</Badge>
      )}
      {drive.maxSpeedMps !== null && drive.maxSpeedMps > 58.1152 ? (
        <Badge variant="danger">{t('drives.highSpeed', 'High speed')}</Badge>
      ) : null}
      {isAnomaly ? (
        <Badge variant="danger" glyph="⚠">
          {t('drives.lowEfficiencyBadge', 'Low efficiency')}
        </Badge>
      ) : null}
    </>
  );

  const route = (
    <RouteDisplay
      start={{address: drive.startAddress, lat: drive.startLat, lon: drive.startLon}}
      end={{address: drive.endAddress, lat: drive.endLat, lon: drive.endLon}}
    />
  );

  const metrics = (
    <>
      <InlineMetric glyph="⏱" value={`${t('drives.avg', 'Avg')} ${avgSpeed} ${speedUnit}`} />
      {drive.maxSpeedMps !== null ? (
        <InlineMetric
          glyph="📈"
          value={`${t('drives.max', 'Max')} ${fmtInt(toSpeedDisplay(drive.maxSpeedMps))} ${speedUnit}`}
        />
      ) : null}
      {hasBattery ? (
        <BatteryDelta startPct={drive.startBatteryPct} endPct={drive.endBatteryPct} />
      ) : null}
      {effConverted ? (
        <View style={styles.inlineMetric}>
          <Glyph glyph="⚡" size={12} color={score.color} />
          <AppText variant="caption" style={{color: score.color}}>
            {`${fmtInt(effConverted)} ${efficiencyUnit}`}
          </AppText>
        </View>
      ) : null}
      {formatEnergyCost &&
      hasBattery &&
      drive.startBatteryPct != null &&
      drive.endBatteryPct != null &&
      drive.startBatteryPct > drive.endBatteryPct ? (
        <View style={styles.inlineMetric}>
          <Glyph glyph="$" size={12} color={ACCENT_HEX.green} />
          <AppText variant="caption" style={styles.costText}>
            {`~${formatEnergyCost((drive.startBatteryPct - drive.endBatteryPct) * 0.75)}`}
          </AppText>
        </View>
      ) : null}
    </>
  );

  return (
    <HistoryListRow
      checkbox={checkbox}
      leading={
        <ScoreBadge
          grade={score.label}
          color={score.color}
          ariaLabel={t('drives.scoreAria', 'Score {{grade}}', {grade: score.label})}
        />
      }
      primary={primary}
      route={route}
      metrics={metrics}
      selected={selected}
    />
  );
}

const DriveCard = memo(
  DriveCardImpl,
  (prev, next) =>
    prev.drive === next.drive &&
    prev.selected === next.selected &&
    prev.distanceUnit === next.distanceUnit &&
    prev.speedUnit === next.speedUnit &&
    prev.efficiencyUnit === next.efficiencyUnit &&
    prev.tz === next.tz &&
    prev.isAnomaly === next.isAnomaly &&
    prev.onToggleSelect === next.onToggleSelect,
);

// ---- URL allowlists (web L216-218) -----------------------------------------

const COLLECTIONS = ['all', 'anomalies', 'notable', 'commutes', 'tagged'] as const;
type Collection = (typeof COLLECTIONS)[number];
const TREND_METRICS = ['drives', 'distance', 'score', 'efficiency', 'cost'] as const;
const SORT_FIELDS = ['date', 'distance', 'efficiency'] as const;
type SortField = (typeof SORT_FIELDS)[number];

// Web URL state (react-router useUrlEnum/String/Number/Batch) collapses to one
// in-memory params store in RN (no router). pickEnum mirrors useUrlEnum's
// allowlist-or-default validation.
function pickEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return value != null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export default function DrivesListPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('drives.title', 'Drive History'));

  // ── Data hooks ──────────────────────────────────────────────────────────
  const {vehicleId} = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDrives(vehicleIdStr);
  const {
    data: drives,
    isLoading: isDrivesLoading,
    error: drivesError,
    refetch: refetchDrives,
  } = drivesQuery;

  const tz = useTimezone('vehicle');

  // ── Unit conversion ─────────────────────────────────────────────────────
  const {unitPrefs} = useUnits();
  const toDistanceDisplay = useCallback(
    (v: number) => convertDistanceFromSI(v, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toSpeedDisplay = useCallback(
    (v: number) => convertSpeedFromSI(v, unitPrefs.speed),
    [unitPrefs.speed],
  );
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) =>
      unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm,
    [unitPrefs.distance],
  );
  const {formatEnergyCost, costPerKwh, formatCurrency} = useFormatting();

  // ── URL-persisted UI state (native in-memory store) ─────────────────────
  const [urlParams, setUrlParams] = useState<Record<string, string>>({});
  const setUrlBatch = useCallback(
    (updates: Record<string, string | null>) => {
      setUrlParams(prev => {
        const next = {...prev};
        for (const k of Object.keys(updates)) {
          const v = updates[k];
          if (v == null) {
            delete next[k];
          } else {
            next[k] = v;
          }
        }
        return next;
      });
    },
    [],
  );

  const sortBy = pickEnum<SortField>(urlParams.sort, SORT_FIELDS, 'date');
  const setSortBy = useCallback(
    (f: SortField) => setUrlBatch({sort: f}),
    [setUrlBatch],
  );
  const page = urlParams.page ? Number(urlParams.page) : 1;
  const setPage = useCallback(
    (p: number) => setUrlBatch({page: String(p)}),
    [setUrlBatch],
  );
  const pageSize = urlParams.size ? Number(urlParams.size) : 50;
  const search = urlParams.q ?? '';
  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEnd = useMemo(() => new Date().toISOString().split('T')[0], []);
  const startDate = urlParams.from ?? defaultStart;
  const endDate = urlParams.to ?? defaultEnd;
  const collection = pickEnum<Collection>(urlParams.coll, COLLECTIONS, 'all');
  const trendMetric = pickEnum<TrendMetric>(urlParams.trend, TREND_METRICS, 'drives');
  const setTrendMetric = useCallback(
    (k: TrendMetric) => setUrlBatch({trend: k}),
    [setUrlBatch],
  );

  // ── Date filter (vehicle-tz day buckets) ────────────────────────────────
  const dateFilteredDrives = useMemo(() => {
    if (!drives) {
      return [];
    }
    return drives.filter(d => {
      const day = localDayKey(d.startTs, tz);
      if (!day) {
        return true;
      }
      if (startDate && day < startDate) {
        return false;
      }
      if (endDate && day > endDate) {
        return false;
      }
      return true;
    });
  }, [drives, startDate, endDate, tz]);

  // ── Period stats (current + prior comparison) ───────────────────────────
  const currentStats = useMemo<PeriodStats>(
    () => computePeriodStats(dateFilteredDrives, undefined, undefined, tz),
    [dateFilteredDrives, tz],
  );
  const priorRange = useMemo(() => priorPeriod(startDate, endDate), [startDate, endDate]);
  const priorStats = useMemo<PeriodStats | null>(
    () =>
      priorRange && drives
        ? computePeriodStats(drives, priorRange.start, priorRange.end, tz)
        : null,
    [drives, priorRange, tz],
  );

  // ── Collection counts (computed BEFORE filter) ──────────────────────────
  const anomalyDrives = useMemo(
    () => detectAnomalies(dateFilteredDrives),
    [dateFilteredDrives],
  );
  const anomalyDriveIds = useMemo(
    () => new Set(anomalyDrives.map(d => d.id)),
    [anomalyDrives],
  );
  const notableDrives = useMemo(
    () => detectNotable(dateFilteredDrives),
    [dateFilteredDrives],
  );
  const commuteDrives = useMemo(
    () => detectCommutes(dateFilteredDrives, 3),
    [dateFilteredDrives],
  );

  // ── Apply collection filter ─────────────────────────────────────────────
  const collectionFiltered = useMemo(() => {
    switch (collection) {
      case 'anomalies':
        return anomalyDrives;
      case 'notable':
        return notableDrives;
      case 'commutes':
        return commuteDrives;
      case 'tagged':
        return [];
      case 'all':
      default:
        return dateFilteredDrives;
    }
  }, [collection, dateFilteredDrives, anomalyDrives, notableDrives, commuteDrives]);

  // ── Search filter (structured kv tokens + free text) ────────────────────
  const deferredSearch = useDeferredValue(search);
  const isSearchPending = !Object.is(search, deferredSearch);
  const searchTokens = useMemo(
    () => parseSearchQuery(deferredSearch),
    [deferredSearch],
  );
  const filteredDrives = useMemo(() => {
    if (searchTokens.length === 0) {
      return collectionFiltered;
    }
    return collectionFiltered.filter(d =>
      matchesTokens(d, searchTokens, {
        text: drive => [
          drive.startAddress,
          drive.endAddress,
          gradeFromEfficiency(getEfficiency(drive)).label,
          fmtNumber(toDistanceDisplay(drive.distanceM ?? 0)),
        ],
        kv: {
          score: (drive, token) => {
            const grade = gradeFromEfficiency(getEfficiency(drive)).label.toLowerCase();
            return grade === token.value.trim().toLowerCase();
          },
          from: (drive, token) => {
            const day = localDayKey(drive.startTs, tz);
            if (!day) {
              return false;
            }
            const monthLabel = formatDayKey(day, {style: 'long'}).toLowerCase();
            return monthLabel.includes(token.value.trim().toLowerCase());
          },
          distance: (drive, token) => {
            const target = Number(token.value);
            if (!Number.isFinite(target)) {
              return null;
            }
            const display = toDistanceDisplay(drive.distanceM ?? 0);
            return compareNumeric(display, token.op, target);
          },
        },
      }),
    );
  }, [collectionFiltered, searchTokens, toDistanceDisplay, tz]);

  // ── Sort ─────────────────────────────────────────────────────────────────
  const sortedDrives = useMemo(() => {
    const sorted = [...filteredDrives];
    switch (sortBy) {
      case 'distance':
        return sorted.sort((a, b) => b.distanceM - a.distanceM);
      case 'efficiency':
        return sorted.sort(
          (a, b) => (getEfficiency(a) ?? 999) - (getEfficiency(b) ?? 999),
        );
      default:
        return sorted.sort((a, b) => (b.startTs ?? '').localeCompare(a.startTs ?? ''));
    }
  }, [filteredDrives, sortBy]);

  // ── Pagination ───────────────────────────────────────────────────────────
  const paginatedDrives = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedDrives.slice(start, start + pageSize);
  }, [sortedDrives, page, pageSize]);

  // ── Date-grouped view of the paginated list ─────────────────────────────
  const groupedDrives = useMemo<DateGroupedListGroup<Drive>[]>(() => {
    const raw = groupByDate(paginatedDrives, d => localDayKey(d.startTs, tz));
    return raw.map(g => {
      const distM = g.items.reduce((s, d) => s + d.distanceM, 0);
      const distDisplay = fmtNumber(toDistanceDisplay(distM));
      const noun =
        g.items.length === 1
          ? t('bulk.noun.drive_one', 'drive')
          : t('bulk.noun.drive_other', 'drives');
      return {
        dateKey: g.dateKey,
        dateLabel: formatDayKey(g.dateKey, {style: 'long'}),
        relativeLabel: formatRelativeDays(`${g.dateKey}T12:00:00Z`, {tz: 'UTC'}),
        summary: `${g.items.length} ${noun} · ${distDisplay} ${distanceUnit}`,
        items: g.items,
      };
    });
  }, [paginatedDrives, toDistanceDisplay, distanceUnit, t, tz]);

  // ── Trend chart series ───────────────────────────────────────────────────
  const trendSeries = useMemo(
    () => ({
      drives: dailyTrend(dateFilteredDrives, 'drives', tz),
      distance: dailyTrend(dateFilteredDrives, 'distance', tz),
      score: dailyTrend(dateFilteredDrives, 'score', tz),
      efficiency: dailyTrend(dateFilteredDrives, 'efficiency', tz),
      cost: dailyTrend(dateFilteredDrives, 'cost', tz),
    }),
    [dateFilteredDrives, tz],
  );

  const trendMetricsConfig: MetricSwitcherMetric<{date: string; value: number}>[] =
    useMemo(
      () => [
        {
          key: 'drives',
          label: t('drives.metric.drives', 'Drives'),
          chart: 'bar',
          color: '#00f0ff',
          accent: 'cyan',
          formatValue: v => fmtInt(v),
          formatTick: v => fmtInt(v),
        },
        {
          key: 'distance',
          label: t('drives.metric.distance', 'Distance'),
          chart: 'bar',
          color: '#10b981',
          accent: 'green',
          getValue: p => toDistanceDisplay(p.value),
          formatValue: v => `${fmtNumber(v)} ${distanceUnit}`,
          formatTick: v => fmtNumber(v),
        },
        {
          key: 'score',
          label: t('drives.metric.score', 'Score'),
          chart: 'line',
          color: '#a855f7',
          accent: 'purple',
          formatValue: v => gradeFromNumeric(v).label,
          formatTick: v => fmtNumber(v, 1),
        },
        {
          key: 'efficiency',
          label: t('drives.metric.efficiency', 'Efficiency'),
          chart: 'line',
          color: '#f59e0b',
          accent: 'amber',
          getValue: p => toEfficiencyDisplay(p.value),
          formatValue: v => `${fmtInt(v)} ${efficiencyUnit}`,
          formatTick: v => fmtInt(v),
        },
        {
          key: 'cost',
          label: t('drives.metric.cost', 'Cost'),
          chart: 'bar',
          color: '#ef4444',
          accent: 'red',
          getValue: p => p.value * costPerKwh,
          formatValue: v => formatCurrency(v, 2),
          formatTick: v => formatCurrency(v, 2),
        },
      ],
      [
        t,
        toDistanceDisplay,
        toEfficiencyDisplay,
        distanceUnit,
        efficiencyUnit,
        costPerKwh,
        formatCurrency,
      ],
    );

  const formatChartXTick = useCallback(
    (key: string) => formatDayKey(key, {style: 'short'}),
    [],
  );

  // ── Bulk selection ───────────────────────────────────────────────────────
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    setBulkSelected(prev => {
      if (prev.size === 0) {
        return prev;
      }
      const visible = new Set(filteredDrives.map(d => d.id));
      const next = new Set<number>();
      prev.forEach(id => {
        if (visible.has(id)) {
          next.add(id);
        }
      });
      return next.size === prev.size ? prev : next;
    });
  }, [filteredDrives]);
  const toggleDriveSelected = useCallback((id: number, on: boolean) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);
  const clearBulk = useCallback(() => setBulkSelected(new Set()), []);
  const bulkDeleteDrivesMut = useBulkDeleteDrives();
  const bulkDriveActions = useMemo<BulkAction[]>(
    () => [
      {
        id: 'delete',
        label: t('bulk.actions.delete', 'Delete'),
        glyph: '🗑',
        variant: 'danger',
        confirm: {
          title: t('bulk.deleteConfirmTitle', 'Delete {{count}} {{noun}}?', {
            count: bulkSelected.size,
            noun:
              bulkSelected.size === 1
                ? t('bulk.noun.drive_one', 'drive')
                : t('bulk.noun.drive_other', 'drives'),
          }),
          description: t('bulk.deleteConfirmDescription', 'This cannot be undone.'),
          confirmLabel: t('common.delete', 'Delete'),
        },
        onClick: async ids => {
          await bulkDeleteDrivesMut.mutateAsync(ids.map(Number));
          clearBulk();
        },
      },
    ],
    [t, bulkSelected.size, bulkDeleteDrivesMut, clearBulk],
  );

  // ── Period labels for the comparison header ─────────────────────────────
  const datePresetId = useMemo(
    () => matchPresetId(startDate, endDate),
    [startDate, endDate],
  );
  const datePreset = datePresetId ? getDatePreset(datePresetId) : undefined;
  const datePresetLabel = datePreset ? t(datePreset.i18nKey, datePreset.fallback) : null;
  const formattedRange = `${formatDayKey(startDate, {style: 'long'})} – ${formatDayKey(endDate, {style: 'long'})}`;
  const periodLabel = datePresetLabel
    ? `${datePresetLabel} · ${formattedRange}`
    : formattedRange;
  const priorHasData = priorStats != null && priorStats.count > 0;
  let priorLabel: string | undefined;
  if (priorHasData && priorRange) {
    priorLabel = t('drives.priorPeriod', 'prior period: {{start}} – {{end}}', {
      start: formatDayKey(priorRange.start, {style: 'long'}),
      end: formatDayKey(priorRange.end, {style: 'long'}),
    });
  } else if (priorRange) {
    priorLabel = t(
      'drives.noPriorData',
      'No drives in prior period: {{start}} – {{end}}',
      {
        start: formatDayKey(priorRange.start, {style: 'long'}),
        end: formatDayKey(priorRange.end, {style: 'long'}),
      },
    );
  } else {
    priorLabel = undefined;
  }

  const avgGrade = gradeFromNumeric(currentStats.avgGradeNumeric);

  // ── Headline grids ───────────────────────────────────────────────────────
  const distMi = toDistanceDisplay(currentStats.totalDistanceM);
  const priorDistMi = priorStats ? toDistanceDisplay(priorStats.totalDistanceM) : null;
  const driveTimeMin = currentStats.totalDurationS / 60;
  const priorDriveTimeMin = priorStats ? priorStats.totalDurationS / 60 : null;
  const avgEffDisp =
    currentStats.avgEfficiencyWhKm != null
      ? toEfficiencyDisplay(currentStats.avgEfficiencyWhKm)
      : null;
  const priorEffDisp =
    priorStats?.avgEfficiencyWhKm != null
      ? toEfficiencyDisplay(priorStats.avgEfficiencyWhKm)
      : null;
  const totalCost = currentStats.totalEnergyKwh * costPerKwh;
  const priorTotalCost = priorStats ? priorStats.totalEnergyKwh * costPerKwh : null;

  // ── Secondary stats line ─────────────────────────────────────────────────
  const secondaryLine =
    currentStats.count > 0 ? (
      <AppText variant="caption" tone="muted">
        {`${t('drives.topSpeed', 'Top speed')} ${fmtInt(toSpeedDisplay(currentStats.topSpeedMps))} ${speedUnit}` +
          ` · ${t('drives.longest', 'Longest')} ${fmtNumber(toDistanceDisplay(currentStats.longest?.distanceM ?? 0))} ${distanceUnit}` +
          ` · ${t('drives.avgTrip', 'Avg trip')} ${fmtNumber(currentStats.count > 0 ? toDistanceDisplay(currentStats.totalDistanceM / currentStats.count) : 0)} ${distanceUnit}` +
          ` · ${formatDurationMinutes(currentStats.count > 0 ? currentStats.totalDurationS / 60 / currentStats.count : 0)} ${t('drives.avgDur', 'avg dur')}`}
      </AppText>
    ) : null;

  // ── Anomaly callout ──────────────────────────────────────────────────────
  const anomalyFooter =
    anomalyDrives.length > 0 && collection !== 'anomalies' ? (
      <InlineCallout
        variant="warning"
        glyph="⚠"
        action={{
          label: t('drives.viewAnomalies', 'View anomalies'),
          onPress: () => setUrlBatch({coll: 'anomalies', page: null}),
        }}>
        {t('drives.anomalyCount', '{{count}} {{noun}} in this range', {
          count: anomalyDrives.length,
          noun:
            anomalyDrives.length === 1
              ? t('drives.anomaly_one', 'anomaly')
              : t('drives.anomaly_other', 'anomalies'),
        })}
      </InlineCallout>
    ) : null;

  // ── Collections pill items ───────────────────────────────────────────────
  const collectionPills: PillItem[] = useMemo(
    () => [
      {key: 'all', label: t('drives.coll.all', 'All'), count: dateFilteredDrives.length, accent: 'cyan', glyph: '≡'},
      {key: 'anomalies', label: t('drives.coll.anomalies', 'Anomalies'), count: anomalyDrives.length, accent: 'red', glyph: '⚠'},
      {key: 'notable', label: t('drives.coll.notable', 'Notable'), count: notableDrives.length, accent: 'purple', glyph: '★'},
      {key: 'commutes', label: t('drives.coll.commutes', 'Commutes'), count: commuteDrives.length, accent: 'green', glyph: '↻'},
      {key: 'tagged', label: t('drives.coll.tagged', 'Tagged'), count: 0, accent: 'amber', glyph: '🏷', disabled: true},
    ],
    [t, dateFilteredDrives.length, anomalyDrives.length, notableDrives.length, commuteDrives.length],
  );
  const collectionLabel = collectionPills.find(p => p.key === collection)?.label ?? 'All';

  // ── Compact summary for the sticky bar ───────────────────────────────────
  const stickySummary = (
    <View style={styles.stickyRow}>
      <AppText variant="caption" tone="secondary" numberOfLines={1}>
        {t('drives.title', 'Drive History')}
      </AppText>
      <AppText variant="caption" tone="muted">
        ·
      </AppText>
      <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.stickyFlex}>
        {periodLabel}
      </AppText>
      <AppText variant="caption" tone="muted">
        ·
      </AppText>
      <AppText variant="caption" weight="semibold">
        {collectionLabel}
      </AppText>
      <AppText variant="caption" tone="muted">
        ·
      </AppText>
      <AppText variant="caption" tone="muted">
        {`${fmtCompact(filteredDrives.length)} ${t('drives.results', 'results')}`}
      </AppText>
      {avgGrade.label !== '—' ? (
        <>
          <AppText variant="caption" tone="muted">
            ·
          </AppText>
          <AppText variant="caption" tone="muted">
            {t('drives.avgScore', 'avg')}{' '}
            <AppText variant="caption" weight="semibold" style={{color: avgGrade.color}}>
              {avgGrade.label}
            </AppText>
          </AppText>
        </>
      ) : null}
    </View>
  );

  // ── Export (web <a download> → RN Share of the same export URL) ──────────
  const buildExportUrl = useCallback(
    (format: 'csv' | 'json'): string => {
      const qs =
        `format=${format}` +
        (startDate ? `&start=${startDate}` : '') +
        (endDate ? `&end=${endDate}` : '') +
        (vehicleId ? `&vehicle_id=${vehicleId}` : '');
      return apiUrl(`/api/v1/export/drives?${qs}`);
    },
    [startDate, endDate, vehicleId],
  );
  const handleExport = useCallback(
    (format: 'csv' | 'json') => {
      void Share.share({message: buildExportUrl(format)});
    },
    [buildExportUrl],
  );

  // ── Defensive: no vehicle ────────────────────────────────────────────────
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('drives.title', 'Drive History')} />;
  }

    return (
    <PageContainer
      title={t('drives.title', 'Drive History')}
      subtitle={t(
        'drives.subtitle',
        'Trip scoring, efficiency analysis, distance patterns, and performance data',
      )}
      error={(drivesError as Error) ?? null}
      onRetry={() => {
        refetchDrives();
      }}
      refreshing={drivesQuery.isFetching && !isDrivesLoading}
      onRefresh={() => {
        refetchDrives();
      }}
      actions={
        <View style={styles.headerActions}>
          <VehicleSelect />
          <RangePicker
            value={{start: startDate, end: endDate}}
            onChange={r => setUrlBatch({from: r.start, to: r.end, page: null})}
            align="end"
            triggerTestId="drives-range-picker"
          />
          <DataFreshnessAuto query={drivesQuery} />
        </View>
      }>
      {/* Sticky bar — web's scroll-spy PageHeaderSticky has no RN equivalent,
          so the summary renders as a static header row above the content. */}
      <GlassPanel style={styles.stickyBar}>{stickySummary}</GlassPanel>

      {/* Opt-in natural-language drive search (renders null unless AI enabled). */}
      <FadeIn>
        <AINLDriveSearch />
      </FadeIn>

      {/* Search + active filter chips */}
      <FadeIn>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={v => setUrlBatch({q: v || null, page: null})}
            placeholder={t(
              'drives.searchPlaceholder',
              'Search drives — try "score:D", "Office", "29.1"',
            )}
            historyScope="drives"
            testID="drives-search"
          />
          {isSearchPending ? (
            <AppText variant="caption" tone="muted" style={styles.searchPending}>
              {t('filter.pending', 'Filtering…')}
            </AppText>
          ) : null}
        </FilterBar>
        <ActiveFilterChips
          filters={
            [
              search
                ? {
                    key: 'q',
                    label: t('drives.filterLabel.search', 'Search'),
                    value: search,
                    onRemove: () => setUrlBatch({q: null, page: null}),
                  }
                : null,
              collection !== 'all'
                ? {
                    key: 'coll',
                    label: t('drives.filterLabel.collection', 'View'),
                    value: collectionLabel,
                    onRemove: () => setUrlBatch({coll: null, page: null}),
                  }
                : null,
            ].filter(Boolean) as FilterChipDescriptor[]
          }
          onClearAll={() => setUrlBatch({q: null, coll: null, page: null})}
        />
      </FadeIn>

      {/* Overview KPI card */}
      <FadeIn>
        {currentStats.count > 0 ? (
          <KpiOverviewCard
            id="drives-overview"
            testId="drives-overview"
            header={{
              title: t('drives.overview', 'Overview'),
              currentLabel: periodLabel,
              comparisonLabel: priorLabel,
            }}
            kpis={
              <>
                <MetricCard
                  label={t('drives.totalDrives', 'Drives')}
                  value={fmtCompact(currentStats.count)}
                  color="cyan"
                  delta={
                    priorHasData
                      ? {
                          metric: 'trip_count',
                          previous: priorStats!.count,
                          current: currentStats.count,
                          display: 'percent',
                        }
                      : undefined
                  }
                />
                <MetricCard
                  label={`${t('drives.distance', 'Distance')} (${distanceUnit})`}
                  value={fmtCompact(distMi, 10000)}
                  color="green"
                  delta={
                    priorHasData
                      ? {
                          metric: 'distance',
                          previous: priorDistMi,
                          current: distMi,
                          display: 'percent',
                        }
                      : undefined
                  }
                />
                <MetricCard
                  label={t('drives.driveTime', 'Drive time')}
                  value={formatDurationMinutes(driveTimeMin)}
                  color="blue"
                  delta={
                    priorHasData
                      ? {
                          metric: {direction: 'neutral'},
                          previous: priorDriveTimeMin,
                          current: driveTimeMin,
                          display: 'percent',
                        }
                      : undefined
                  }
                />
                <MetricCard
                  label={t('drives.avgScore', 'Avg score')}
                  value={avgGrade.label}
                  color="purple"
                  delta={
                    priorHasData &&
                    priorStats!.avgGradeNumeric != null &&
                    currentStats.avgGradeNumeric != null
                      ? {
                          metric: 'drive_score',
                          previous: priorStats!.avgGradeNumeric,
                          current: currentStats.avgGradeNumeric,
                          display: 'percent',
                        }
                      : undefined
                  }
                />
                <MetricCard
                  label={`${t('drives.efficiency', 'Efficiency')} (${efficiencyUnit})`}
                  value={avgEffDisp != null ? fmtInt(avgEffDisp) : '—'}
                  color="amber"
                  delta={
                    priorHasData && avgEffDisp != null && priorEffDisp != null
                      ? {
                          metric: 'efficiency',
                          previous: priorEffDisp,
                          current: avgEffDisp,
                          display: 'percent',
                        }
                      : undefined
                  }
                />
                <MetricCard
                  label={t('drives.cost', 'Cost')}
                  value={formatEnergyCost(currentStats.totalEnergyKwh)}
                  color="red"
                  delta={
                    priorHasData
                      ? {
                          metric: 'cost',
                          previous: priorTotalCost,
                          current: totalCost,
                          display: 'percent',
                        }
                      : undefined
                  }
                />
              </>
            }
            secondary={secondaryLine}
            footer={anomalyFooter}
          />
        ) : (
          <GlassPanel style={styles.panel}>
            <EmptyState message={t('drives.noStatsRange', 'No drives in this range')} />
          </GlassPanel>
        )}
      </FadeIn>

      {/* Drives over time — metric-switcher chart */}
      {currentStats.count > 0 ? (
        <FadeIn>
          <MetricSwitcherChart
            title={t('drives.overTime', 'Drives over time')}
            ariaLabel={t('drives.overTime.aria', 'Drives over time chart with metric switcher')}
            series={trendSeries}
            metrics={trendMetricsConfig}
            activeMetric={trendMetric}
            onMetricChange={k => setTrendMetric(k as TrendMetric)}
            formatXTick={formatChartXTick}
            emptyMessage={t('drives.overTime.empty', 'No data for this metric in the selected range')}
            testId="drives-trend-chart"
          />
        </FadeIn>
      ) : null}

      {/* Collections pill row */}
      <FadeIn>
        <PillFilterBar
          items={collectionPills}
          activeKey={collection}
          onChange={k => setUrlBatch({coll: k === 'all' ? null : k, page: null})}
          ariaLabel={t('drives.collections.aria', 'Filter drives by collection')}
          testID="drives-collections"
        />
      </FadeIn>

      {/* List controls — sort + export */}
      {sortedDrives.length > 0 ? (
        <View style={styles.listControls}>
          <View style={styles.listControlsTitle}>
            <Glyph glyph="🛣" color={ACCENT_HEX.cyan} size={15} />
            <AppText weight="semibold">{t('drives.allDrives', 'All Drives')}</AppText>
            <AppText variant="caption" tone="muted">
              {`(${fmtCompact(sortedDrives.length)})`}
            </AppText>
          </View>
          <View style={styles.listControlsActions}>
            <Glyph glyph="↕" size={13} />
            {SORT_FIELDS.map(s => {
              const fieldLabel =
                s === 'date'
                  ? t('drives.sortRecent', 'Recent')
                  : s === 'distance'
                  ? t('drives.sortDistance', 'Distance')
                  : t('drives.sortEfficiency', 'Efficiency');
              return (
                <Button
                  key={s}
                  variant="ghost"
                  active={sortBy === s}
                  onPress={() => setSortBy(s)}
                  accessibilityLabel={t('drives.sortByAria', 'Sort by {{field}}', {
                    field: fieldLabel,
                  })}>
                  {sortBy === s ? `${fieldLabel} ↓` : fieldLabel}
                </Button>
              );
            })}
            <Button variant="secondary" glyph="⬇" onPress={() => handleExport('csv')}>
              CSV
            </Button>
            <Button variant="secondary" glyph="⬇" onPress={() => handleExport('json')}>
              JSON
            </Button>
          </View>
        </View>
      ) : (
        <EmptyState
          glyph="📈"
          message={t('common.noData', 'No data available')}
        />
      )}

      {/* Drive list */}
      {isDrivesLoading ? (
        <View style={styles.skeletonStack}>
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} height={80} />
          ))}
        </View>
      ) : paginatedDrives.length > 0 ? (
        <>
          <BulkActionsToolbar
            selectedIds={Array.from(bulkSelected)}
            total={filteredDrives.length}
            onClear={clearBulk}
            actions={bulkDriveActions}
            itemNoun={{
              one: t('bulk.noun.drive_one', 'drive'),
              other: t('bulk.noun.drive_other', 'drives'),
            }}
          />
          <StaggerContainer>
            <DateGroupedList
              groups={groupedDrives}
              itemKey={d => d.id}
              renderItem={d => (
                <StaggerItem>
                  <DriveCard
                    drive={d}
                    toDistanceDisplay={toDistanceDisplay}
                    toSpeedDisplay={toSpeedDisplay}
                    toEfficiencyDisplay={toEfficiencyDisplay}
                    distanceUnit={distanceUnit}
                    speedUnit={speedUnit}
                    efficiencyUnit={efficiencyUnit}
                    formatEnergyCost={formatEnergyCost}
                    tz={tz}
                    isAnomaly={anomalyDriveIds.has(d.id)}
                    selected={bulkSelected.has(d.id)}
                    onToggleSelect={toggleDriveSelected}
                  />
                </StaggerItem>
              )}
            />
          </StaggerContainer>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={sortedDrives.length}
            onPageChange={setPage}
            onPageSizeChange={s => setUrlBatch({size: String(s), page: null})}
          />
        </>
      ) : (
        <EmptyState
          glyph="🛣"
          title={
            collection !== 'all'
              ? t('drives.emptyForCollection', 'No drives in this view')
              : t('drives.emptyTitle', 'No drives recorded yet')
          }
          message={
            collection !== 'all'
              ? t(
                  'drives.emptyForCollection.msg',
                  'Try switching to a different collection or clearing your filters.',
                )
              : t(
                  'drives.emptyMessage',
                  'Drive data will appear here once your vehicle records trips.',
                )
          }
          action={{
            label: t('drives.empty.cta', 'Reset filters'),
            onPress: () =>
              setUrlBatch({
                q: null,
                from: null,
                to: null,
                coll: null,
                sort: null,
                page: null,
              }),
          }}
        />
      )}
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  glyph: {
    lineHeight: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipLabel: {
    color: colors.textSecondary,
  },
  chipCount: {
    marginLeft: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  buttonGhost: {
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  buttonActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  buttonActiveText: {
    color: ACCENT_HEX.cyan,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  checkboxMark: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 16,
  },
  pageRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  pageHeaderText: {
    flexShrink: 1,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  pageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  section: {
    width: '100%',
  },
  skeleton: {
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
    width: '100%',
  },
  skeletonStack: {
    gap: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  emptyActionText: {
    color: colors.accent,
  },
  callout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    flexWrap: 'wrap',
  },
  calloutText: {
    flexShrink: 1,
  },
  errorCallout: {
    borderColor: 'rgba(239,68,68,0.4)',
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  vehicleSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  vehicleSelectText: {
    maxWidth: 140,
  },
  noVehicle: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  noVehicleText: {
    textAlign: 'center',
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  searchInput: {
    flex: 1,
    minWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  searchTextInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    paddingVertical: 0,
  },
  searchPending: {
    paddingHorizontal: spacing.xs,
  },
  activeChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rangeTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalSheet: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  modalTitle: {
    marginBottom: spacing.sm,
  },
  modalRow: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
  },
  modalRowActive: {
    backgroundColor: colors.surfaceSelected,
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  freshnessDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  pageBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  pageBtnDisabled: {
    opacity: 0.4,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  sectionTitleText: {
    color: colors.textPrimary,
  },
  delta: {
    marginTop: 2,
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  metricAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  metricLabel: {
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 20,
  },
  kpiCard: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  kpiHeader: {
    gap: 2,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  kpiSecondary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  groupList: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.sm,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  groupRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
    opacity: 0.5,
    marginHorizontal: spacing.xs,
  },
  groupItems: {
    gap: spacing.sm,
  },
  bulkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
    flexWrap: 'wrap',
    marginBottom: spacing.sm,
  },
  bulkActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  bulkActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  bulkActionDanger: {
    borderColor: 'rgba(239,68,68,0.4)',
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  chartCard: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  chartBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 100,
    gap: 2,
    marginTop: spacing.sm,
  },
  chartBarCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  chartBar: {
    width: '100%',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  chartAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  chartTick: {
    fontSize: 10,
  },
  scoreBadge: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
    minWidth: 32,
  },
  inlineMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  routeText: {
    flexShrink: 1,
  },
  routeFade: {
    flexShrink: 1,
    opacity: 0.7,
  },
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowCheckbox: {
    paddingLeft: spacing.xs,
  },
  rowBody: {
    flex: 1,
    padding: spacing.md,
  },
  rowBodySelected: {
    borderColor: colors.borderAccent,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowLeading: {
    width: 36,
    alignItems: 'center',
  },
  rowMain: {
    flex: 1,
    gap: spacing.xs,
  },
  rowPrimary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  rowRoute: {
    width: '100%',
  },
  rowMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  driveTime: {
    fontSize: 14,
  },
  costText: {
    color: 'rgba(16,185,129,0.85)',
  },
  stickyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  stickyFlex: {
    flexShrink: 1,
  },
  stickyBar: {
    padding: spacing.md,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  listControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  listControlsTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  listControlsActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
});
