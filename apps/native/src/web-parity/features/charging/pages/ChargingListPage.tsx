import {Glyph} from '../../../../components/icons/Glyph';
// ChargingListPage — native parity port of
// web/src/features/charging/pages/ChargingListPage.tsx.
//
// The Charging Sessions hub: a sticky summary bar, a structured search box
// (charger:/cost:/kwh:/power:/dur:/in:/at:/free kv-tokens + free text), active
// filter chips, a 6-KPI overview card with prior-period deltas, a metric-switcher
// trend chart (sessions/energy/cost/power), collection pills
// (all/home/supercharger/dc/free/anomalies/notable/tagged), four threshold-gated
// analytical sections (AC-vs-DC stats, battery start-level distribution,
// charging efficiency, charger specs) plus a cost optimizer section, a
// sort/density/export controls bar, a bulk-select toolbar, the date-grouped
// session list, and pagination. Every state name, API path, SI-Wh/-W unit
// handling, filter/sort/pagination math, i18n key + English fallback, and
// section threshold is preserved verbatim from the web source.
//
// All web dependencies are unconverted siblings (lib/chargingAggregation,
// lib/searchQuery, lib/numberFormat, lib/dateFormat, lib/datePresets,
// lib/unitConversion, lib/scoreScale, the charging-list helpers/panels and the
// ChargingSessionCard). Following the established self-contained convention (see
// SessionListSection.tsx / AutomationsListPage.tsx), native-safe equivalents of
// every one are ported inline here; their canonical standalone native files
// remain owned by their own conversion turns. Native adaptations vs. the web
// source (behaviour / state / keys / units kept):
//   - react-i18next useTranslation (web L2) -> native-safe t(key, fallback,
//     options?) with {{var}} interpolation (no i18n runtime in RN).
//   - lucide-react icons (web L3-6) -> emoji/text glyphs (lucide is browser-only).
//   - @/components/layout PageContainer + PageHeaderSticky (web L7-8) -> inline RN
//     PageContainer (single ScrollView + RefreshControl) + a non-floating sticky
//     summary header row (RN has no IntersectionObserver scroll-spy).
//   - @/components/ui GlassPanel/Pagination (web L9-10) -> native GlassPanel +
//     inline RN Pagination (Pressable prev/next, showing X–Y of Z).
//   - @/components/motion FadeIn/StaggerContainer/StaggerItem (web L11-13) ->
//     passthrough Views (no framer-motion entrance primitive in this layer).
//   - @/components/feedback QueryError/EmptyState/EmptyStateThreshold/
//     InlineCallout/Skeleton (web L14-18) -> inline RN equivalents.
//   - @/components/forms RangePicker/VehicleSelect/PillFilterBar/SearchInput/
//     FilterBar/ActiveFilterChips/DensityToggle/SortControl/ListExportMenu
//     (web L19-25) -> inline RN equivalents. The DOM <a download> blob export is
//     replaced with React Native Share.share over the same CSV/JSON string
//     (rule 7); the SearchInput localStorage history dropdown is omitted
//     (historyScope kept for parity).
//   - @/components/data-display SavedViewMenu/DataFreshnessAuto/KpiOverviewCard/
//     MetricCard/DateGroupedList/BulkActionsToolbar (web L26-30) -> inline RN
//     equivalents. SavedViewMenu (a URL/localStorage-backed feature) is
//     router-only and omitted from the native header (documented).
//   - @/components/charts MetricSwitcherChart (web L31) -> inline RN
//     MetricSwitcherChart (metric pills + scaled native bars; recharts is
//     browser-only SVG).
//   - @/hooks useSavedViewUrl/useUrlState (web L32-33) -> the saved-view hook is
//     dropped (router-only); URL state collapses to one in-memory params store
//     (no react-router in RN) exposing the same getString/Enum/Boolean/Number +
//     setBatch semantics and preserving every state name.
//   - @/lib helpers (web L34, L43-46) -> ported inline (only the functions this
//     page transitively uses).
//   - @/api/hooks/useCharging (web L35) -> native ../../../api/hooks/useCharging
//     (useChargingSessionsPaginated/useChargingOptimizer/useBulkDeleteCharging),
//     identical args + API paths.
//   - @/hooks useUnits/useFormatting/usePageTitle/useSelectedVehicle +
//     @/lib/timezone useTimezone (web L36-40) -> inline native shims (useUnits/
//     useFormatting read the native useSettings; usePageTitle no-op; vehicle from
//     native useVehicles; timezone falls back to device-local day bucketing).
//   - @/features/onboarding NoVehicleSelected (web L41) -> inline RN version.
//   - @/components/mobile PullToRefresh (web L42) -> folded into PageContainer's
//     RefreshControl (the native idiom; nested scroll/pull wrappers avoided).
//   - ../components/ChargingSessionCard + ../components/charging-list barrel
//     (web L48-65) -> inline native ChargingSessionCard + the four compute
//     helpers + the five analytical panels.
//
// No DOM/Recharts/Leaflet/react-router/react-i18next/framer-motion/lucide/old
// web-UI import reaches the native output — only react, react-native primitives,
// the canonical AppText/GlassPanel + theme tokens, and the native charging/
// vehicles/settings hooks.

import React, {
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
import {
  useBulkDeleteCharging,
  useChargingOptimizer,
  useChargingSessionsPaginated,
  type ChargingOptimizerData,
} from '../../../api/hooks/useCharging';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import type {ChargingSession} from '../../../api/types';

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

function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

function fmtPercent(v: unknown, decimals?: number): string {
  return `${fmtNumber(v, decimals)}%`;
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

function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value == null) {
    return FALLBACK;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type EnergyUnitPref = 'Wh' | 'kWh';
type PowerUnitPref = 'W' | 'kW';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
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

// ---- scoreScale (web @/lib/scoreScale) -------------------------------------

type ScoreGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | '—';

interface ScoreGradeInfo {
  label: ScoreGrade;
  color: string;
  numeric: number | null;
}

const GRADE_PALETTE: Record<ScoreGrade, {color: string; numeric: number | null}> =
  {
    'A+': {color: '#10b981', numeric: 4.5},
    A: {color: '#10b981', numeric: 4.0},
    B: {color: '#00f0ff', numeric: 3.0},
    C: {color: '#f59e0b', numeric: 2.0},
    D: {color: '#ef4444', numeric: 1.0},
    F: {color: '#b91c1c', numeric: 0.5},
    '—': {color: '#6b7280', numeric: null},
  };

const DEFAULT_SCORE_THRESHOLDS: ReadonlyArray<{min: number; label: ScoreGrade}> =
  [
    {min: 90, label: 'A+'},
    {min: 80, label: 'A'},
    {min: 65, label: 'B'},
    {min: 50, label: 'C'},
    {min: 35, label: 'D'},
    {min: 0, label: 'F'},
  ];

function numericToGrade(score: number | null | undefined): ScoreGradeInfo {
  if (score == null || !Number.isFinite(score)) {
    return {label: '—', ...GRADE_PALETTE['—']};
  }
  const sorted = [...DEFAULT_SCORE_THRESHOLDS].sort((a, b) => b.min - a.min);
  for (const tier of sorted) {
    if (score >= tier.min) {
      return {label: tier.label, ...GRADE_PALETTE[tier.label]};
    }
  }
  return {label: 'F', ...GRADE_PALETTE.F};
}

// ---- chargingAggregation (web @/lib/chargingAggregation) -------------------

type ChargerCategory = 'home' | 'supercharger' | 'dc' | 'unknown';

function getChargerCategory(type: string | null | undefined): ChargerCategory {
  if (!type) {
    return 'home';
  }
  const t = type.toLowerCase();
  if (t.includes('super') || t.includes('tpc')) {
    return 'supercharger';
  }
  if (
    t.includes('dc') ||
    t.includes('ccs') ||
    t.includes('chademo') ||
    t.includes('fast')
  ) {
    return 'dc';
  }
  if (t.includes('home') || t.includes('ac') || t.includes('wall')) {
    return 'home';
  }
  return 'unknown';
}

function durationMinutes(s: ChargingSession): number {
  if (!s.started_at || !s.ended_at) {
    return 0;
  }
  const start = Date.parse(s.started_at);
  const end = Date.parse(s.ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return (end - start) / 60_000;
}

function avgPowerW(s: ChargingSession): number {
  const minutes = durationMinutes(s);
  if (minutes > 0 && s.total_energy_added_wh > 0) {
    return s.total_energy_added_wh / (minutes / 60);
  }
  return s.avg_power_w ?? 0;
}

function costPerKwh(s: ChargingSession): number | null {
  if (s.total_energy_added_wh <= 0) {
    return null;
  }
  if (s.cost_decimal == null || s.cost_decimal <= 0) {
    return null;
  }
  return s.cost_decimal / (s.total_energy_added_wh / 1000);
}

function localDayKey(
  iso: string | null | undefined,
  tz?: string,
): string | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return ymdInTz(d, tz);
}

function priorPeriod(
  startDate: string | undefined,
  endDate: string | undefined,
): {start: string; end: string} | null {
  if (!startDate || !endDate) {
    return null;
  }
  const startMs = parseYmdToUtcMillis(startDate);
  const endMs = parseYmdToUtcMillis(endDate);
  if (startMs == null || endMs == null) {
    return null;
  }
  const lengthDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
  const priorEndMs = startMs - 86_400_000;
  const priorStartMs = priorEndMs - (lengthDays - 1) * 86_400_000;
  const toYmd = (ms: number): string => {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return {start: toYmd(priorStartMs), end: toYmd(priorEndMs)};
}

function parseStartHour(
  iso: string | null | undefined,
  tz?: string,
): number | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  if (!tz) {
    return d.getHours();
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const h = parts.find(p => p.type === 'hour')?.value;
    if (!h) {
      return null;
    }
    const n = Number(h);
    return Number.isFinite(n) ? n % 24 : null;
  } catch {
    return d.getHours();
  }
}

function batteryFriendlyScore(
  sessions: readonly ChargingSession[],
): number | null {
  let total = 0;
  let n = 0;
  for (const s of sessions) {
    const start = s.start_soc_pct;
    const end = s.end_soc_pct;
    if (start == null || end == null) {
      continue;
    }
    n += 1;
    let score = 50;
    if (start <= 30) {
      score += 30;
    } else if (start <= 50) {
      score += 15;
    } else if (start <= 70) {
      score += 0;
    } else {
      score -= 10;
    }
    if (end <= 80) {
      score += 20;
    } else if (end <= 90) {
      score += 0;
    } else if (end < 100) {
      score -= 10;
    } else {
      score -= 25;
    }
    total += Math.max(0, Math.min(100, score));
  }
  return n > 0 ? total / n : null;
}

interface ChargingPeriodStats {
  count: number;
  totalEnergyWh: number;
  totalCost: number;
  totalDurationMin: number;
  avgRateKw: number | null;
  avgDurationMin: number | null;
  avgPowerW: number | null;
  mostCommonStartHour: number | null;
  byCategory: Record<ChargerCategory, number>;
  freeCount: number;
  batteryFriendlyScore: number | null;
  batteryFriendlyGrade: ScoreGradeInfo;
}

function inDateRange(
  s: ChargingSession,
  startDate?: string,
  endDate?: string,
  tz?: string,
): boolean {
  const day = localDayKey(s.started_at, tz);
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

function computeChargingPeriodStats(
  sessions: readonly ChargingSession[],
  startDate?: string,
  endDate?: string,
  tz?: string,
): ChargingPeriodStats {
  let count = 0;
  let totalEnergyWh = 0;
  let totalCost = 0;
  let totalDurationMin = 0;
  let powerSum = 0;
  let powerN = 0;
  let freeCount = 0;
  const byCategory: Record<ChargerCategory, number> = {
    home: 0,
    supercharger: 0,
    dc: 0,
    unknown: 0,
  };
  const hourCounts: number[] = new Array(24).fill(0);
  const inWindow: ChargingSession[] = [];

  for (const s of sessions) {
    if (!inDateRange(s, startDate, endDate, tz)) {
      continue;
    }
    count += 1;
    inWindow.push(s);
    totalEnergyWh += s.total_energy_added_wh;
    totalCost += s.cost_decimal ?? 0;
    totalDurationMin += durationMinutes(s);
    const p = avgPowerW(s);
    if (p > 0) {
      powerSum += p;
      powerN += 1;
    }
    byCategory[getChargerCategory(s.charger_type)] += 1;
    if (!s.cost_decimal || s.cost_decimal === 0) {
      freeCount += 1;
    }
    const hour = parseStartHour(s.started_at, tz);
    if (hour != null) {
      hourCounts[hour] += 1;
    }
  }

  const score = batteryFriendlyScore(inWindow);

  return {
    count,
    totalEnergyWh,
    totalCost,
    totalDurationMin,
    avgRateKw:
      totalDurationMin > 0
        ? totalEnergyWh / 1000 / (totalDurationMin / 60)
        : null,
    avgDurationMin: count > 0 ? totalDurationMin / count : null,
    avgPowerW: powerN > 0 ? powerSum / powerN : null,
    mostCommonStartHour: hourCounts.some(c => c > 0)
      ? hourCounts.indexOf(Math.max(...hourCounts))
      : null,
    byCategory,
    freeCount,
    batteryFriendlyScore: score,
    batteryFriendlyGrade: numericToGrade(score),
  };
}

type ChargingAnomalyKind =
  | 'telemetry_gap'
  | 'cost_zero'
  | 'bad_power'
  | 'expensive'
  | 'trickle';

interface ChargingAnomaly {
  session: ChargingSession;
  kind: ChargingAnomalyKind;
  message: string;
  actionLabel: string;
}

function formatDurationShort(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function detectChargingAnomalies(
  sessions: readonly ChargingSession[],
  currencySymbol = '$',
): ChargingAnomaly[] {
  const expensiveCostPerKwh = 0.5;
  const tricklePowerKw = 5;
  const trickleMinDurationMin = 360;
  const out: ChargingAnomaly[] = [];
  for (const s of sessions) {
    const dur = durationMinutes(s);
    const energyKwh = s.total_energy_added_wh / 1000;
    const power = avgPowerW(s) / 1000;
    const cpk = costPerKwh(s);

    if (energyKwh < 0.1 && dur > 5) {
      out.push({
        session: s,
        kind: 'telemetry_gap',
        message: `0 kWh added in ${formatDurationShort(dur)} — telemetry gap?`,
        actionLabel: 'Investigate',
      });
      continue;
    }
    if (
      energyKwh > 1 &&
      (s.cost_decimal == null || s.cost_decimal === 0) &&
      getChargerCategory(s.charger_type) !== 'home'
    ) {
      out.push({
        session: s,
        kind: 'cost_zero',
        message: 'Energy added but no cost recorded',
        actionLabel: 'Add cost',
      });
      continue;
    }
    if (getChargerCategory(s.charger_type) === 'dc' && dur > 30 && power < 3) {
      out.push({
        session: s,
        kind: 'bad_power',
        message: `Low power for DC (${fmtNumber(power, 1)} kW)`,
        actionLabel: 'View curve',
      });
      continue;
    }
    if (cpk != null && cpk > expensiveCostPerKwh) {
      out.push({
        session: s,
        kind: 'expensive',
        message: `Expensive charge (${currencySymbol}${fmtNumber(cpk, 2)}/kWh)`,
        actionLabel: 'Compare',
      });
      continue;
    }
    if (dur > trickleMinDurationMin && power < tricklePowerKw) {
      out.push({
        session: s,
        kind: 'trickle',
        message: `Trickle charge (${fmtNumber(power, 1)} kW for ${formatDurationShort(
          dur,
        )})`,
        actionLabel: 'View curve',
      });
      continue;
    }
  }
  return out;
}

function detectNotableSessions(
  sessions: readonly ChargingSession[],
): ChargingSession[] {
  if (sessions.length === 0) {
    return [];
  }
  const sorted = [...sessions].sort(
    (a, b) => b.total_energy_added_wh - a.total_energy_added_wh,
  );
  const cutoffIdx = Math.min(50, Math.max(1, Math.ceil(sessions.length * 0.1)));
  const topEnergy = new Set(sorted.slice(0, cutoffIdx).map(s => s.id));

  const result: ChargingSession[] = [];
  const seen = new Set<number>();
  for (const s of sessions) {
    const isFast = (s.peak_power_w ?? 0) >= 150_000;
    if ((topEnergy.has(s.id) || isFast) && !seen.has(s.id)) {
      result.push(s);
      seen.add(s.id);
    }
  }
  return result;
}

type ChargingTrendMetric = 'sessions' | 'energy' | 'cost' | 'power';

interface ChargingTrendPoint {
  date: string;
  value: number;
}

function dailyChargingTrend(
  sessions: readonly ChargingSession[],
  metric: ChargingTrendMetric,
  tz?: string,
): ChargingTrendPoint[] {
  const buckets = new Map<string, {sum: number; count: number}>();
  for (const s of sessions) {
    const day = localDayKey(s.started_at, tz);
    if (!day) {
      continue;
    }
    const b = buckets.get(day) ?? {sum: 0, count: 0};
    switch (metric) {
      case 'sessions':
        b.sum += 1;
        break;
      case 'energy':
        b.sum += s.total_energy_added_wh / 1000;
        break;
      case 'cost':
        b.sum += s.cost_decimal ?? 0;
        break;
      case 'power': {
        const p = avgPowerW(s) / 1000;
        if (p > 0) {
          b.sum += p;
          b.count += 1;
        }
        break;
      }
    }
    buckets.set(day, b);
  }
  return Array.from(buckets.entries())
    .map(([date, b]) => ({
      date,
      value: metric === 'power' ? (b.count > 0 ? b.sum / b.count : 0) : b.sum,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
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

function parseDurationToken(input: string): number | null {
  if (!input) {
    return null;
  }
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  const re = /(\d+(?:\.\d+)?)\s*(d|h|m|s)/g;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    matched = true;
    const value = Number(m[1]);
    if (!Number.isFinite(value)) {
      return null;
    }
    switch (m[2]) {
      case 'd':
        total += value * 24 * 60;
        break;
      case 'h':
        total += value * 60;
        break;
      case 'm':
        total += value;
        break;
      case 's':
        total += value / 60;
        break;
    }
  }
  if (!matched) {
    return null;
  }
  const consumed = trimmed
    .replace(/\s+/g, '')
    .match(/(\d+(?:\.\d+)?[dhms])+/g)
    ?.join('');
  if (consumed !== trimmed.replace(/\s+/g, '')) {
    return null;
  }
  return total;
}

function matchesYmdPrefix(
  value: string | null | undefined,
  prefix: string,
): boolean {
  const v = (value ?? '').trim();
  const p = (prefix ?? '').trim();
  if (!v || !p) {
    return false;
  }
  const ymd = v.length >= 10 ? v.slice(0, 10) : v;
  return ymd.startsWith(p);
}

// ---- charging-list helpers (web charging-list/helpers.ts) ------------------
// `durationMinutesSE` is the charging-curve helper variant (start,end → whole
// minutes), distinct from `durationMinutes(session)` above; both are used.

function durationMinutesSE(startedAt: string, endedAt: string | null): number {
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

function distanceAddedM(s: ChargingSession): number | null {
  if (s.start_odometer_m == null || s.end_odometer_m == null) {
    return null;
  }
  const delta = s.end_odometer_m - s.start_odometer_m;
  return delta > 0 ? delta : null;
}

interface AcDcBucket {
  energy: number;
  energyUsed: number;
  cost: number;
  count: number;
  totalDuration: number;
  freeCount: number;
  freeEnergy: number;
}

interface AcDcBreakdown {
  ac: AcDcBucket;
  dc: AcDcBucket;
  total: {energy: number; cost: number; freeEnergy: number; freeCount: number};
}

function computeAcDcBreakdown(sessions: ChargingSession[]): AcDcBreakdown {
  const ac: AcDcBucket = {
    energy: 0,
    energyUsed: 0,
    cost: 0,
    count: 0,
    totalDuration: 0,
    freeCount: 0,
    freeEnergy: 0,
  };
  const dc: AcDcBucket = {
    energy: 0,
    energyUsed: 0,
    cost: 0,
    count: 0,
    totalDuration: 0,
    freeCount: 0,
    freeEnergy: 0,
  };
  sessions.forEach(s => {
    const isDC = !!(
      s.charger_type ||
      (s.peak_power_w && s.peak_power_w > 22_000)
    );
    const bucket = isDC ? dc : ac;
    bucket.energy += s.total_energy_added_wh;
    bucket.energyUsed += s.total_energy_added_wh;
    bucket.cost += s.cost_decimal ?? 0;
    bucket.count++;
    bucket.totalDuration += durationMinutesSE(s.started_at, s.ended_at);
    if (!s.cost_decimal || s.cost_decimal === 0) {
      bucket.freeCount++;
      bucket.freeEnergy += s.total_energy_added_wh;
    }
  });
  return {
    ac,
    dc,
    total: {
      energy: ac.energy + dc.energy,
      cost: ac.cost + dc.cost,
      freeEnergy: ac.freeEnergy + dc.freeEnergy,
      freeCount: ac.freeCount + dc.freeCount,
    },
  };
}

interface StartLevelBucket {
  range: string;
  count: number;
}

function computeStartLevelDist(sessions: ChargingSession[]): StartLevelBucket[] {
  const buckets = Array.from({length: 10}, (_, i) => ({
    range: `${i * 10}-${i * 10 + 10}%`,
    count: 0,
  }));
  sessions.forEach(s => {
    const idx = Math.min(Math.floor(s.start_soc_pct / 10), 9);
    buckets[idx].count++;
  });
  return buckets;
}

interface EfficiencyStats {
  avgEfficiency: number;
  best: {id: number; date: string; efficiency: number; added: number; used: number};
  worst: {id: number; date: string; efficiency: number; added: number; used: number};
  wallLoss: number;
  totalAdded: number;
  totalUsed: number;
  count: number;
}

function computeEfficiencyStats(
  sessions: ChargingSession[],
): EfficiencyStats | null {
  if (sessions.length === 0) {
    return null;
  }
  const withData = sessions.filter(
    s =>
      s.total_energy_added_wh > 0 &&
      durationMinutesSE(s.started_at, s.ended_at) > 0,
  );
  if (withData.length === 0) {
    return null;
  }
  const efficiencies = withData.map(s => ({
    id: s.id,
    date: s.started_at,
    efficiency:
      (s.total_energy_added_wh / durationMinutesSE(s.started_at, s.ended_at)) *
      60,
    added: s.total_energy_added_wh,
    used: s.total_energy_added_wh,
  }));
  const totalAdded = withData.reduce(
    (sum, s) => sum + s.total_energy_added_wh,
    0,
  );
  const totalUsed = totalAdded;
  const avgEfficiency =
    withData.length > 0
      ? withData.reduce(
          (sum, s) =>
            sum +
            (s.total_energy_added_wh /
              durationMinutesSE(s.started_at, s.ended_at)) *
              60,
          0,
        ) / withData.length
      : 0;
  const sorted = [...efficiencies].sort((a, b) => b.efficiency - a.efficiency);
  return {
    avgEfficiency,
    best: sorted[0],
    worst: sorted[sorted.length - 1],
    wallLoss: 0,
    totalAdded,
    totalUsed,
    count: withData.length,
  };
}

interface SpecEntry {
  name: string;
  count: number;
  energy: number;
  power?: number;
  avgPower?: number;
}

interface ChargerSpecsData {
  voltage: SpecEntry[];
  phase: SpecEntry[];
  cable: SpecEntry[];
  brand: SpecEntry[];
}

function computeChargerSpecs(
  sessions: ChargingSession[],
): ChargerSpecsData | null {
  if (sessions.length === 0) {
    return null;
  }
  const byType: Record<string, {count: number; energy: number; power: number}> =
    {};
  sessions.forEach(s => {
    const typeKey = s.charger_type ?? 'AC/Home';
    if (!byType[typeKey]) {
      byType[typeKey] = {count: 0, energy: 0, power: 0};
    }
    byType[typeKey].count++;
    byType[typeKey].energy += s.total_energy_added_wh;
    byType[typeKey].power += s.peak_power_w ?? 0;
  });

  const byVoltage: Record<string, {count: number; energy: number; power: number}> =
    {};
  const byPhase: Record<string, {count: number; energy: number; power: number}> =
    {};
  const byCable: Record<string, {count: number; energy: number; power: number}> =
    {};
  sessions.forEach(s => {
    if (s.cable_type) {
      if (!byCable[s.cable_type]) {
        byCable[s.cable_type] = {count: 0, energy: 0, power: 0};
      }
      byCable[s.cable_type].count++;
      byCable[s.cable_type].energy += s.total_energy_added_wh;
    }
  });

  const toArr = (
    obj: Record<string, {count: number; energy: number; power?: number}>,
  ): SpecEntry[] =>
    Object.entries(obj)
      .map(([name, v]) => ({
        name,
        count: v.count,
        energy: convertEnergyFromSI(v.energy, 'kWh'),
        avgPower:
          v.power != null && v.power > 0
            ? convertPowerFromSI(v.power / v.count, 'kW')
            : undefined,
      }))
      .sort((a, b) => b.count - a.count);

  return {
    voltage: toArr(byVoltage),
    phase: toArr(byPhase),
    cable: toArr(byCable),
    brand: toArr(byType),
  };
}

// ---- App-hook native shims --------------------------------------------------

interface UnitPrefsLite {
  distance: DistanceUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefsLite} {
  const {data} = useSettings();
  const distance: DistanceUnitPref = data?.unit_of_length === 'mi' ? 'mi' : 'km';
  const unitPrefs = useMemo<UnitPrefsLite>(() => ({distance}), [distance]);
  return {unitPrefs};
}

interface UseFormattingResult {
  formatCurrency: (amount: number, decimals?: number) => string;
  currencySymbol: string;
}

function useFormatting(): UseFormattingResult {
  const {data} = useSettings();
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
  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );
  return useMemo(
    () => ({formatCurrency, currencySymbol}),
    [formatCurrency, currencySymbol],
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
function useTimezone(mode: 'vehicle' | 'local'): string | undefined {
  return mode === 'vehicle' ? undefined : undefined;
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
        active && {
          borderColor: accent,
          backgroundColor: `${accent}22`,
        },
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

// ---- PageContainer (web @/components/layout PageContainer + PullToRefresh) ---

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  copyLink?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  children?: ReactNode;
}

function PageContainer({
  title,
  subtitle,
  actions,
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

function EmptyStateThreshold({
  currentCount,
  threshold,
  itemNoun,
  sectionLabel,
  description,
}: {
  currentCount: number;
  threshold: number;
  itemNoun: string;
  sectionLabel: string;
  description?: string;
}): React.ReactElement {
  const remaining = Math.max(0, threshold - currentCount);
  return (
    <GlassPanel style={styles.thresholdPanel}>
      <AppText weight="semibold" variant="caption" style={styles.thresholdTitle}>
        {sectionLabel}
      </AppText>
      <AppText tone="muted" variant="caption" style={styles.thresholdBody}>
        {`Needs ${threshold} ${itemNoun} — ${remaining} more to unlock (have ${currentCount}).`}
      </AppText>
      {description ? (
        <AppText tone="muted" variant="caption">
          {description}
        </AppText>
      ) : null}
    </GlassPanel>
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

type Density = 'compact' | 'comfortable';

function DensityToggle({
  value,
  onChange,
  options,
  testID,
}: {
  value: Density;
  onChange: (d: Density) => void;
  options: Density[];
  testID?: string;
}): React.ReactElement {
  return (
    <View style={styles.segment} testID={testID}>
      {options.map(opt => (
        <Pressable
          key={opt}
          onPress={() => onChange(opt)}
          accessibilityRole="button"
          accessibilityState={{selected: value === opt}}
          style={[styles.segmentItem, value === opt && styles.segmentItemActive]}>
          <AppText
            variant="caption"
            weight={value === opt ? 'semibold' : 'regular'}
            tone={value === opt ? 'primary' : 'muted'}>
            {opt === 'compact' ? 'Compact' : 'Comfortable'}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

type SortDirection = 'asc' | 'desc';

function SortControl<F extends string>({
  field,
  direction,
  options,
  onFieldChange,
  onDirectionChange,
  testID,
}: {
  field: F;
  direction: SortDirection;
  options: ReadonlyArray<{value: F; label: string}>;
  onFieldChange: (f: F) => void;
  onDirectionChange: (d: SortDirection) => void;
  testID?: string;
}): React.ReactElement {
  return (
    <View style={styles.sortControl} testID={testID}>
      {options.map(opt => (
        <Pressable
          key={opt.value}
          onPress={() => onFieldChange(opt.value)}
          accessibilityRole="button"
          accessibilityState={{selected: field === opt.value}}
          style={[styles.sortPill, field === opt.value && styles.sortPillActive]}>
          <AppText
            variant="caption"
            weight={field === opt.value ? 'semibold' : 'regular'}
            tone={field === opt.value ? 'primary' : 'muted'}>
            {opt.label}
          </AppText>
        </Pressable>
      ))}
      <Pressable
        onPress={() => onDirectionChange(direction === 'desc' ? 'asc' : 'desc')}
        accessibilityRole="button"
        accessibilityLabel="Toggle sort direction"
        style={styles.sortDir}>
        <AppText variant="caption" weight="semibold">
          {direction === 'desc' ? '↓' : '↑'}
        </AppText>
      </Pressable>
    </View>
  );
}

function ListExportMenu({
  onExportCsv,
  onExportJson,
  selectedCount,
  visibleCount,
  testID,
}: {
  onExportCsv: (scope: 'visible' | 'selected') => void;
  onExportJson: (scope: 'visible' | 'selected') => void;
  selectedCount: number;
  visibleCount: number;
  testID?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const close = (): void => setOpen(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        testID={testID}
        style={styles.exportTrigger}>
        <Glyph glyph="⬇" />
        <AppText variant="caption" weight="semibold">
          Export
        </AppText>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.modalBackdrop} onPress={close}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <AppText weight="semibold" style={styles.modalTitle}>
              Export
            </AppText>
            <ExportRow
              label={`Visible (CSV) · ${fmtCompact(visibleCount)}`}
              onPress={() => {
                close();
                onExportCsv('visible');
              }}
            />
            <ExportRow
              label={`Visible (JSON) · ${fmtCompact(visibleCount)}`}
              onPress={() => {
                close();
                onExportJson('visible');
              }}
            />
            {selectedCount > 0 ? (
              <>
                <ExportRow
                  label={`Selected (CSV) · ${fmtCompact(selectedCount)}`}
                  onPress={() => {
                    close();
                    onExportCsv('selected');
                  }}
                />
                <ExportRow
                  label={`Selected (JSON) · ${fmtCompact(selectedCount)}`}
                  onPress={() => {
                    close();
                    onExportJson('selected');
                  }}
                />
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function ExportRow({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.modalRow}>
      <AppText>{label}</AppText>
    </Pressable>
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
  previous: number;
  current: number;
  display: 'percent';
}

function Delta({metric, previous, current}: MetricDelta): React.ReactElement | null {
  const diff = current - previous;
  const pctChange = previous !== 0 ? (diff / Math.abs(previous)) * 100 : null;
  const neutral =
    (typeof metric === 'object' && metric.direction === 'neutral') || diff === 0;
  // For cost-like metrics a decrease is good; everything else: an increase is
  // good. Mirrors the web Delta direction semantics at the display boundary.
  const downIsGood = metric === 'cost';
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

// ---- charts (web @/components/charts MetricSwitcherChart) -------------------
// recharts is browser-only SVG; the native switcher keeps the metric pills and
// renders the active series as height-scaled native bars (line metrics included).

interface MetricSwitcherMetric<P> {
  key: string;
  label: string;
  chart: 'bar' | 'line';
  color: string;
  accent: Accent;
  formatValue: (v: number) => string;
  formatTick: (v: number) => string;
  // The point type P is preserved for call-site parity with the web generic.
  __point?: P;
}

function MetricSwitcherChart<P>({
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
  metrics: MetricSwitcherMetric<P>[];
  activeMetric: string;
  onMetricChange: (key: string) => void;
  formatXTick: (key: string) => string;
  emptyMessage: string;
  testId?: string;
}): React.ReactElement {
  const active = metrics.find(m => m.key === activeMetric) ?? metrics[0];
  const points = series[activeMetric] ?? [];
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

// ---- panels (web charging-list/*) ------------------------------------------

function StatRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}): React.ReactElement {
  return (
    <View style={styles.statRow}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant="caption" weight="semibold" style={valueColor ? {color: valueColor} : undefined}>
        {value}
      </AppText>
    </View>
  );
}

function AcDcStatsPanel({breakdown}: {breakdown: AcDcBreakdown}): React.ReactElement {
  const {t} = useTranslation();
  const {formatCurrency} = useFormatting();
  const total = breakdown.total.energy;
  const acPct = total > 0 ? (breakdown.ac.energy / total) * 100 : 0;
  const dcPct = total > 0 ? (breakdown.dc.energy / total) * 100 : 0;
  const rows = [
    {label: t('charging.table.acCharging', 'AC Charging'), color: '#3b82f6', b: breakdown.ac},
    {label: t('charging.table.dcCharging', 'DC Charging'), color: '#f59e0b', b: breakdown.dc},
  ].filter(r => r.b.count > 0);

  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle glyph="⚡" glyphColor={ACCENT_HEX.amber}>
        {t('charging.stats.chargingByType', 'Charging Stats by Type')}
      </SectionTitle>
      <AppText variant="caption" tone="muted" style={styles.panelHint}>
        {t('charging.stats.energySplitLabel', 'Energy Split (AC vs DC)')}
      </AppText>
      <View style={styles.splitBar}>
        {breakdown.ac.energy > 0 ? (
          <View style={[styles.splitSeg, styles.splitAc, {flex: breakdown.ac.energy}]}>
            <AppText variant="caption" weight="bold" style={styles.splitLabel}>
              {`AC ${fmtPercent(acPct)}`}
            </AppText>
          </View>
        ) : null}
        {breakdown.dc.energy > 0 ? (
          <View style={[styles.splitSeg, styles.splitDc, {flex: breakdown.dc.energy}]}>
            <AppText variant="caption" weight="bold" style={styles.splitLabel}>
              {`DC ${fmtPercent(dcPct)}`}
            </AppText>
          </View>
        ) : null}
      </View>
      {rows.map(r => (
        <View key={r.label} style={styles.acDcRow}>
          <AppText variant="caption" weight="semibold" style={{color: r.color}}>
            {r.label}
          </AppText>
          <StatRow
            label={t('charging.table.sessionCount', 'Sessions')}
            value={fmtInt(r.b.count)}
          />
          <StatRow
            label={t('charging.table.energy', 'Energy')}
            value={
              r.b.energy >= 1000
                ? fmtWithUnit(r.b.energy / 1000, 'MWh')
                : fmtWithUnit(r.b.energy, 'kWh')
            }
          />
          <StatRow
            label={t('charging.table.cost', 'Cost')}
            value={formatCurrency(r.b.cost)}
            valueColor={ACCENT_HEX.amber}
          />
          <StatRow
            label={t('charging.table.costPerKwh', '$/kWh')}
            value={r.b.energy > 0 ? formatCurrency(r.b.cost / r.b.energy) : '—'}
          />
          <StatRow
            label={t('charging.table.avgEnergy', 'Avg Energy')}
            value={fmtWithUnit(r.b.energy / r.b.count, 'kWh')}
          />
          <StatRow
            label={t('charging.table.avgTime', 'Avg Time')}
            value={formatDurationMinutes(r.b.totalDuration / r.b.count)}
          />
          <StatRow
            label={t('charging.table.free', 'Free')}
            value={
              r.b.freeCount > 0
                ? `${r.b.freeCount} (${fmtWithUnit(r.b.freeEnergy, 'kWh')})`
                : '—'
            }
            valueColor={ACCENT_HEX.green}
          />
        </View>
      ))}
      {breakdown.total.freeCount > 0 ? (
        <View style={styles.acDcFree}>
          <AppText variant="caption" tone="muted">
            {t('charging.table.freeCharged', 'Free charged')}:{' '}
            <AppText variant="caption" weight="semibold" style={{color: ACCENT_HEX.green}}>
              {`${breakdown.total.freeCount} sessions`}
            </AppText>
          </AppText>
          <AppText variant="caption" tone="muted">
            {t('charging.table.freeEnergy', 'Free energy')}:{' '}
            <AppText variant="caption" weight="semibold" style={{color: ACCENT_HEX.green}}>
              {fmtWithUnit(breakdown.total.freeEnergy, 'kWh')}
            </AppText>
          </AppText>
        </View>
      ) : null}
    </GlassPanel>
  );
}

function BatteryLevelChart({data}: {data: StartLevelBucket[]}): React.ReactElement {
  const {t} = useTranslation();
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle glyph="🔋" glyphColor={ACCENT_HEX.amber}>
        {t('charging.charts.batteryLevelAtStart', 'Battery Level at Charge Start')}
      </SectionTitle>
      <AppText variant="caption" tone="muted" style={styles.panelHint}>
        {t(
          'charging.charts.batteryLevelHint',
          'How low do you typically go before charging?',
        )}
      </AppText>
      <View style={styles.chartBars}>
        {data.map(d => (
          <View key={d.range} style={styles.chartBarCol}>
            <View
              style={[
                styles.chartBar,
                styles.barAmber,
                {height: Math.max(3, (d.count / max) * 96)},
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.chartAxis}>
        {data.map((d, i) =>
          i % 2 === 0 ? (
            <AppText key={d.range} variant="caption" tone="muted" style={styles.chartTick}>
              {d.range.replace('%', '')}
            </AppText>
          ) : null,
        )}
      </View>
    </GlassPanel>
  );
}

function EfficiencyPanel({stats}: {stats: EfficiencyStats}): React.ReactElement {
  const {t} = useTranslation();
  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle glyph="📊" glyphColor={ACCENT_HEX.green}>
        {t('charging.efficiency.title', 'Charging Efficiency')}
      </SectionTitle>
      <AppText variant="caption" tone="muted" style={styles.panelHint}>
        {`${t('charging.efficiency.hint', 'Wall-to-battery energy conversion')} (${stats.count} ${t(
          'charging.efficiency.sessionsWithData',
          'sessions with data',
        )})`}
      </AppText>
      <View style={styles.statTiles}>
        <StatTile
          value={fmtPercent(stats.avgEfficiency)}
          label={t('charging.efficiency.average', 'Average Efficiency')}
          color={ACCENT_HEX.cyan}
        />
        <StatTile
          value={fmtPercent(stats.best.efficiency)}
          label={t('charging.efficiency.best', 'Best Session')}
          sub={formatDateTime(stats.best.date)}
          color={ACCENT_HEX.green}
        />
        <StatTile
          value={fmtPercent(stats.worst.efficiency)}
          label={t('charging.efficiency.worst', 'Worst Session')}
          sub={formatDateTime(stats.worst.date)}
          color={ACCENT_HEX.red}
        />
        <StatTile
          value={fmtWithUnit(stats.wallLoss, 'kWh')}
          label={t('charging.efficiency.wallLoss', 'Wall-to-Battery Loss')}
          sub={`${fmtNumber(stats.totalUsed)} kWh → ${fmtNumber(stats.totalAdded)} kWh`}
          color={ACCENT_HEX.amber}
        />
      </View>
    </GlassPanel>
  );
}

function StatTile({
  value,
  label,
  sub,
  color,
}: {
  value: string;
  label: string;
  sub?: string;
  color: string;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.statTile}>
      <AppText weight="bold" style={[styles.statTileValue, {color}]}>
        {value}
      </AppText>
      <AppText variant="caption" tone="muted" style={styles.statTileLabel}>
        {label}
      </AppText>
      {sub ? (
        <AppText variant="caption" tone="muted" style={styles.statTileSub}>
          {sub}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

function ChargerSpecsPanel({
  specs,
}: {
  specs: ChargerSpecsData | null;
}): React.ReactElement {
  const {t} = useTranslation();
  const hasData =
    !!specs &&
    (specs.voltage.length > 0 || specs.cable.length > 0 || specs.brand.length > 0);
  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle glyph="🎛" glyphColor={ACCENT_HEX.purple}>
        {t('charging.specs.title', 'Charger Specs Breakdown')}
      </SectionTitle>
      {hasData && specs ? (
        <View style={styles.specGrid}>
          <SpecColumn
            label={t('charging.specs.byVoltage', 'By Voltage')}
            items={specs.voltage}
            emptyMsg={t('charging.specs.noVoltage', 'No voltage data')}
          />
          <SpecColumn
            label={t('charging.specs.byPhase', 'By Phase')}
            items={specs.phase}
            emptyMsg={t('charging.specs.noPhase', 'No phase data')}
          />
          <SpecColumn
            label={t('charging.specs.byCable', 'By Cable')}
            items={specs.cable}
            emptyMsg={t('charging.specs.noCable', 'No cable data')}
          />
          <SpecColumn
            label={t('charging.specs.byBrand', 'By Brand')}
            items={specs.brand}
            emptyMsg={t('charging.specs.noBrand', 'No brand data')}
            showAvgPower
          />
        </View>
      ) : (
        <EmptyState
          message={t(
            'charging.specs.noData',
            'No charger specification data available yet',
          )}
        />
      )}
    </GlassPanel>
  );
}

function SpecColumn({
  label,
  items,
  emptyMsg,
  showAvgPower,
}: {
  label: string;
  items: SpecEntry[];
  emptyMsg: string;
  showAvgPower?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.specColumn}>
      <AppText variant="caption" weight="semibold" style={styles.specColumnLabel}>
        {label}
      </AppText>
      {items.length === 0 ? (
        <AppText variant="caption" tone="muted">
          {emptyMsg}
        </AppText>
      ) : (
        items.map(v => (
          <View key={v.name} style={styles.specRow}>
            <AppText variant="caption" weight="semibold" numberOfLines={1} style={styles.specName}>
              {v.name}
            </AppText>
            <AppText variant="caption" tone="muted">
              {`${v.count} sessions · ${
                showAvgPower && v.avgPower != null
                  ? `${fmtInt(v.avgPower)} kW avg`
                  : fmtWithUnit(v.energy, 'kWh')
              }`}
            </AppText>
          </View>
        ))
      )}
    </View>
  );
}

// ---- CostHeatmap (web charging-list/CostHeatmap) ---------------------------

interface HeatmapEntry {
  day: number;
  hour: number;
  sessions: number;
  avg_cost_per_kwh: number;
}

const HEATMAP_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function CostHeatmap({
  heatmap,
  peakCostPerKwh,
}: {
  heatmap: HeatmapEntry[];
  peakCostPerKwh: number;
}): React.ReactElement {
  const {t} = useTranslation();
  const data = heatmap ?? [];
  const maxCost = peakCostPerKwh || 0.3;
  const cellColor = (entry: HeatmapEntry | undefined): string => {
    if (!entry || entry.sessions === 0) {
      return 'rgba(255,255,255,0.02)';
    }
    const intensity = Math.min(1, entry.avg_cost_per_kwh / maxCost);
    const r = Math.round(intensity * 239 + (1 - intensity) * 16);
    const g = Math.round(intensity * 68 + (1 - intensity) * 185);
    const b = Math.round(intensity * 68 + (1 - intensity) * 129);
    const alpha = Math.min(0.9, 0.15 + entry.sessions * 0.12);
    return `rgba(${r},${g},${b},${alpha})`;
  };
  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle glyph="🕒" glyphColor={ACCENT_HEX.purple}>
        {t('charging.optimizer.heatmapTitle', 'Cost by Time of Week')}
      </SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.heatmapGrid}>
          {HEATMAP_DAYS.map((dayLabel, dayIdx) => (
            <View key={dayLabel} style={styles.heatmapRow}>
              <AppText variant="caption" tone="muted" style={styles.heatmapDay}>
                {dayLabel}
              </AppText>
              {Array.from({length: 24}, (_, hourIdx) => {
                const entry = data.find(
                  e => e.day === dayIdx && e.hour === hourIdx,
                );
                return (
                  <View
                    key={hourIdx}
                    accessibilityLabel={
                      entry && entry.sessions > 0
                        ? `${dayLabel} ${hourIdx}:00 — ${entry.sessions} sessions, $${fmtNumber(
                            entry.avg_cost_per_kwh,
                            3,
                          )}/kWh`
                        : `${dayLabel} ${hourIdx}:00`
                    }
                    style={[styles.heatmapCell, {backgroundColor: cellColor(entry)}]}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </GlassPanel>
  );
}

// ---- OptimizerSection (web charging-list/OptimizerSection) ------------------

function OptimizerSection({
  optimizer,
}: {
  optimizer: ChargingOptimizerData;
}): React.ReactElement {
  const {t} = useTranslation();
  const score = optimizer.battery_health_score;
  const scoreColor = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  const habits: Array<{label: string; value: string}> = [
    {
      label: t('charging.optimizer.sessionsWeek', 'Sessions/week'),
      value: fmtNumber(optimizer.current_schedule.avg_sessions_per_week, 1),
    },
    {
      label: t('charging.optimizer.homePct', 'Home charging'),
      value: `${fmtNumber(optimizer.current_schedule.home_charging_pct, 0)}%`,
    },
    {
      label: t('charging.optimizer.avgTarget', 'Avg charge target'),
      value: `${fmtNumber(optimizer.current_schedule.avg_charge_to_pct, 0)}%`,
    },
    {
      label: t('charging.optimizer.commonHour', 'Common start hour'),
      value: `${optimizer.current_schedule.most_common_start_hour}:00`,
    },
    {
      label: t('charging.optimizer.commonDay', 'Most common'),
      value: optimizer.current_schedule.most_common_day,
    },
  ];
  const peakHours = (optimizer.cost_analysis.peak_hours ?? [])
    .map(h => `${h}:00`)
    .join(', ');
  const offpeakHours = (optimizer.cost_analysis.offpeak_hours ?? [])
    .map(h => `${h}:00`)
    .join(', ');
  const recs = optimizer.recommendations ?? [];

  return (
    <>
      {optimizer.cost_analysis.potential_monthly_savings > 5 ? (
        <FadeIn delay={0.23}>
          <InlineCallout variant="success" glyph="💲">
            {t(
              'charging.optimizer.savingsBanner',
              'Save ~${{amount}}/month by adjusting your charging schedule',
              {
                amount: fmtNumber(
                  optimizer.cost_analysis.potential_monthly_savings,
                  0,
                ),
              },
            )}
          </InlineCallout>
        </FadeIn>
      ) : null}

      <FadeIn delay={0.24}>
        <GlassPanel style={styles.panel}>
          <SectionTitle glyph="📅" glyphColor={ACCENT_HEX.cyan}>
            {t('charging.optimizer.habits', 'Charging Habits')}
          </SectionTitle>
          {habits.map(item => (
            <StatRow key={item.label} label={item.label} value={item.value} />
          ))}
        </GlassPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <GlassPanel style={[styles.panel, styles.scorePanel]}>
          <AppText weight="bold" style={[styles.scoreValue, {color: scoreColor}]}>
            {fmtInt(score)}
          </AppText>
          <AppText variant="caption" tone="muted">
            {t('charging.optimizer.batteryScore', 'Battery-Friendly Score')}
          </AppText>
          <View style={styles.scoreTrack}>
            <View
              style={[
                styles.scoreFill,
                {width: pct(Math.min(100, Math.max(0, score))), backgroundColor: scoreColor},
              ]}
            />
          </View>
          <AppText variant="caption" tone="muted" style={styles.scoreHint}>
            {score >= 75
              ? t('charging.optimizer.scoreGood', 'Your habits are battery-friendly')
              : score >= 50
              ? t('charging.optimizer.scoreFair', 'Room for improvement')
              : t('charging.optimizer.scorePoor', 'Consider adjusting your habits')}
          </AppText>
        </GlassPanel>
      </FadeIn>

      <FadeIn delay={0.26}>
        <GlassPanel style={styles.panel}>
          <SectionTitle glyph="💲" glyphColor={ACCENT_HEX.green}>
            {t('charging.optimizer.costAnalysis', 'Cost Analysis')}
          </SectionTitle>
          <StatRow
            label={t('charging.optimizer.peakRate', 'Peak rate')}
            value={`$${fmtNumber(optimizer.cost_analysis.peak_cost_per_kwh, 3)}/kWh`}
            valueColor={ACCENT_HEX.red}
          />
          <StatRow
            label={t('charging.optimizer.offpeakRate', 'Off-peak rate')}
            value={`$${fmtNumber(optimizer.cost_analysis.offpeak_cost_per_kwh, 3)}/kWh`}
            valueColor={ACCENT_HEX.green}
          />
          <StatRow
            label={t('charging.optimizer.peakSessions', 'Sessions during peak')}
            value={`${fmtNumber(optimizer.cost_analysis.sessions_during_peak_pct, 0)}%`}
            valueColor={
              optimizer.cost_analysis.sessions_during_peak_pct > 30
                ? ACCENT_HEX.red
                : ACCENT_HEX.green
            }
          />
          <StatRow
            label={t('charging.optimizer.peakHours', 'Peak hours')}
            value={peakHours || '—'}
          />
          <StatRow
            label={t('charging.optimizer.offpeakHours', 'Off-peak hours')}
            value={offpeakHours || '—'}
          />
        </GlassPanel>
      </FadeIn>

      {(optimizer.weekly_heatmap ?? []).length > 0 ? (
        <FadeIn delay={0.27}>
          <CostHeatmap
            heatmap={optimizer.weekly_heatmap ?? []}
            peakCostPerKwh={optimizer.cost_analysis.peak_cost_per_kwh}
          />
        </FadeIn>
      ) : null}

      <FadeIn delay={0.28}>
        <GlassPanel style={styles.panel}>
          <SectionTitle glyph="💡" glyphColor={ACCENT_HEX.amber}>
            {t('charging.optimizer.recommendations', 'Optimization Recommendations')}
          </SectionTitle>
          {recs.length > 0 ? (
            recs.map((rec, i) => (
              <View
                key={i}
                style={[
                  styles.recRow,
                  {
                    borderColor:
                      rec.priority === 'high'
                        ? `${ACCENT_HEX.red}33`
                        : rec.priority === 'medium'
                        ? `${ACCENT_HEX.amber}33`
                        : colors.border,
                  },
                ]}>
                <View style={styles.recHead}>
                  <AppText weight="semibold" style={styles.recTitle}>
                    {rec.title}
                  </AppText>
                  <View
                    style={[
                      styles.recBadge,
                      {
                        backgroundColor:
                          rec.priority === 'high'
                            ? `${ACCENT_HEX.red}33`
                            : rec.priority === 'medium'
                            ? `${ACCENT_HEX.amber}33`
                            : `${ACCENT_HEX.green}33`,
                      },
                    ]}>
                    <AppText variant="caption" weight="semibold">
                      {rec.priority}
                    </AppText>
                  </View>
                  {rec.estimated_savings != null && rec.estimated_savings > 0 ? (
                    <View style={[styles.recBadge, {backgroundColor: `${ACCENT_HEX.green}33`}]}>
                      <AppText variant="caption" weight="semibold" style={{color: ACCENT_HEX.green}}>
                        {`~$${fmtNumber(rec.estimated_savings, 0)}/mo`}
                      </AppText>
                    </View>
                  ) : null}
                </View>
                <AppText variant="caption" tone="muted">
                  {rec.detail}
                </AppText>
              </View>
            ))
          ) : (
            <EmptyState
              message={t(
                'charging.optimizer.noRecs',
                'Recommendations will appear after more charging sessions.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </>
  );
}

// ---- ChargingSessionCard (web ../components/ChargingSessionCard) ------------

function pct(value: number): `${number}%` {
  return `${value}%`;
}

const CARD_ACCENT: Record<ChargerCategory, Accent> = {
  home: 'green',
  supercharger: 'red',
  dc: 'amber',
  unknown: 'cyan',
};

function ScoreBadge({score}: {score: number}): React.ReactElement {
  const grade = numericToGrade(score);
  return (
    <View style={[styles.scoreBadge, {borderColor: `${grade.color}66`, backgroundColor: `${grade.color}1f`}]}>
      <AppText variant="caption" weight="bold" style={{color: grade.color}}>
        {grade.label}
      </AppText>
    </View>
  );
}

function MiniBadge({
  label,
  glyph,
  accent,
}: {
  label: string;
  glyph?: string;
  accent: Accent;
}): React.ReactElement {
  const hex = ACCENT_HEX[accent];
  return (
    <View style={[styles.miniBadge, {borderColor: `${hex}44`, backgroundColor: `${hex}1a`}]}>
      {glyph ? <Glyph glyph={glyph} color={hex} size={11} /> : null}
      <AppText variant="caption" weight="semibold" style={{color: hex}}>
        {label}
      </AppText>
    </View>
  );
}

function ChargingSessionCard({
  session,
  toDistanceDisplay,
  distanceUnit,
  selected,
  onToggleSelect,
  anomaly,
  density = 'comfortable',
}: {
  session: ChargingSession;
  toDistanceDisplay: (km: number) => number;
  distanceUnit: string;
  selected?: boolean;
  onToggleSelect?: (id: number, on: boolean) => void;
  anomaly?: ChargingAnomaly;
  density?: 'comfortable' | 'compact';
}): React.ReactElement {
  const {t} = useTranslation();
  const {formatCurrency} = useFormatting();
  const cat = getChargerCategory(session.charger_type);
  const chargerLabels: Record<ChargerCategory, string> = {
    supercharger: t('charging.chargerTypes.supercharger', 'Supercharger'),
    dc: t('charging.chargerTypes.dc', 'DC Fast'),
    home: t('charging.chargerTypes.home', 'Home / AC'),
    unknown: t('charging.chargerTypes.unknown', 'Charger'),
  };

  const durationMin = durationMinutes(session);
  const w = avgPowerW(session);
  const avgRateKw = w > 0 ? w / 1000 : null;
  const cpk = costPerKwh(session);
  const addedM = distanceAddedM(session);
  const milesGained = addedM != null ? toDistanceDisplay(addedM / 1000) : null;
  const energyKwh = (session.total_energy_added_wh ?? 0) / 1000;
  const isFree = session.cost_decimal == null || session.cost_decimal === 0;
  const showCheckbox = typeof onToggleSelect === 'function';

  const start = session.start_soc_pct;
  const end = session.end_soc_pct;
  let sessionScore: number | null = null;
  if (start != null && end != null) {
    let s = 50;
    if (start <= 30) {
      s += 30;
    } else if (start <= 50) {
      s += 15;
    } else if (start <= 70) {
      s += 0;
    } else {
      s -= 10;
    }
    if (end <= 80) {
      s += 20;
    } else if (end <= 90) {
      s += 0;
    } else if (end < 100) {
      s -= 10;
    } else {
      s -= 25;
    }
    sessionScore = Math.max(0, Math.min(100, s));
  }

  const badgeAccent: Accent =
    cat === 'supercharger' ? 'red' : cat === 'dc' ? 'amber' : 'green';

  return (
    <Pressable
      onPress={
        showCheckbox ? () => onToggleSelect?.(session.id, !selected) : undefined
      }
      accessibilityRole={showCheckbox ? 'checkbox' : undefined}
      accessibilityState={showCheckbox ? {checked: !!selected} : undefined}
      style={[
        styles.sessionCard,
        selected && {borderColor: ACCENT_HEX[CARD_ACCENT[cat]]},
      ]}>
      <View style={styles.sessionTop}>
        {showCheckbox ? (
          <View style={[styles.checkbox, selected && styles.checkboxOn]}>
            {selected ? <AppText style={styles.checkboxMark}>✓</AppText> : null}
          </View>
        ) : null}
        {sessionScore != null ? <ScoreBadge score={sessionScore} /> : null}
        <View style={styles.sessionPrimary}>
          <AppText weight="semibold" numberOfLines={1}>
            {formatDateTime(session.started_at)}
          </AppText>
          <AppText variant="caption" tone="muted">
            {formatDurationMinutes(durationMin)}
          </AppText>
        </View>
      </View>

      <View style={styles.badgeRow}>
        <MiniBadge label={chargerLabels[cat]} accent={badgeAccent} />
        {energyKwh > 0 ? (
          <MiniBadge label={fmtWithUnit(energyKwh, 'kWh')} accent="cyan" />
        ) : null}
        {isFree && energyKwh > 0 ? (
          <MiniBadge label={t('charging.free', 'Free')} glyph="☀" accent="green" />
        ) : null}
        {anomaly ? (
          <MiniBadge label={anomaly.message} glyph="⚠" accent="red" />
        ) : null}
      </View>

      {session.start_place ? (
        <View style={styles.routeRow}>
          <Glyph glyph="📍" size={12} />
          <AppText variant="caption" tone="secondary" numberOfLines={1}>
            {session.start_place}
          </AppText>
        </View>
      ) : null}

      {density === 'compact' ? null : (
        <View style={styles.metricsRow}>
          {start != null && end != null ? (
            <AppText variant="caption" tone="muted">
              {`${fmtInt(start)}% → ${fmtInt(end)}%`}
            </AppText>
          ) : null}
          {session.peak_power_w != null ? (
            <AppText variant="caption" tone="muted">
              {`${fmtNumber(session.peak_power_w / 1000)} kW peak`}
            </AppText>
          ) : null}
          {avgRateKw != null ? (
            <AppText variant="caption" tone="muted">
              {`~${fmtNumber(avgRateKw)} kW avg`}
            </AppText>
          ) : null}
          {durationMin > 0 ? (
            <AppText variant="caption" tone="muted">
              {formatDurationMinutes(durationMin)}
            </AppText>
          ) : null}
          {typeof session.cost_decimal === 'number' && session.cost_decimal > 0 ? (
            <AppText variant="caption" weight="semibold" style={{color: ACCENT_HEX.green}}>
              {formatCurrency(session.cost_decimal)}
            </AppText>
          ) : null}
          {cpk != null ? (
            <AppText variant="caption" tone="muted">
              {`(${formatCurrency(cpk, 2)}/kWh)`}
            </AppText>
          ) : null}
          {typeof milesGained === 'number' && milesGained > 0 ? (
            <AppText variant="caption" style={{color: ACCENT_HEX.purple}}>
              {`⚡ +${fmtInt(milesGained)} ${distanceUnit}`}
            </AppText>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

// ---- URL allowlists (web L71-76) -------------------------------------------

const COLLECTIONS = [
  'all',
  'home',
  'supercharger',
  'dc',
  'free',
  'anomalies',
  'notable',
  'tagged',
] as const;
type Collection = (typeof COLLECTIONS)[number];
const TREND_METRICS = ['sessions', 'energy', 'cost', 'power'] as const;
const SORT_FIELDS = ['date', 'energy', 'cost', 'duration', 'power'] as const;
type SortField = (typeof SORT_FIELDS)[number];
const DENSITY_VALUES = ['compact', 'comfortable'] as const;

// Thresholds for conditional sections (web L81-84)
const THRESHOLD_OPTIMIZER = 10;
const THRESHOLD_SPECS = 5;
const THRESHOLD_BATTERY_DIST = 5;
const THRESHOLD_AC_DC = 1;

// Web URL state (react-router useUrlString/Enum/Boolean/Number/Batch) collapses
// to one in-memory params store in RN (no router). pickEnum mirrors useUrlEnum's
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

function formatHour(h: number): string {
  if (h === 0) {
    return '12 AM';
  }
  if (h === 12) {
    return '12 PM';
  }
  if (h < 12) {
    return `${h} AM`;
  }
  return `${h - 12} PM`;
}

export default function ChargingListPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('charging.list.title', 'Charging Sessions'));

  // ── Data ───────────────────────────────────────────────────────────────
  const {vehicleId} = useSelectedVehicle();
  const tz = useTimezone('vehicle');
  const {unitPrefs} = useUnits();
  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = useCallback(
    (km: number) => convertDistanceFromSI(km, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const {formatCurrency, currencySymbol} = useFormatting();

  // ── URL state (native in-memory store) ──────────────────────────────────
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

  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const startDate = urlParams.from ?? defaultStartDate;
  const endDate = urlParams.to ?? defaultEndDate;
  const search = urlParams.q ?? '';
  const collection: Collection = pickEnum(urlParams.coll, COLLECTIONS, 'all');
  const trendMetric = pickEnum(urlParams.trend, TREND_METRICS, 'sessions');
  const setTrendMetric = useCallback(
    (k: ChargingTrendMetric) => setUrlBatch({trend: k}),
    [setUrlBatch],
  );
  const sortBy = pickEnum(urlParams.sort, SORT_FIELDS, 'date');
  const setSortBy = useCallback(
    (f: SortField) => setUrlBatch({sort: f}),
    [setUrlBatch],
  );
  const sortDesc = urlParams.sort_desc != null ? urlParams.sort_desc === 'true' : true;
  const setSortDesc = useCallback(
    (v: boolean) => setUrlBatch({sort_desc: String(v)}),
    [setUrlBatch],
  );
  const density = pickEnum(urlParams.density, DENSITY_VALUES, 'comfortable');
  const setDensity = useCallback(
    (d: Density) => setUrlBatch({density: d}),
    [setUrlBatch],
  );
  const page = urlParams.page ? Number(urlParams.page) : 1;
  const setPage = useCallback(
    (p: number) => setUrlBatch({page: String(p)}),
    [setUrlBatch],
  );
  const pageSize = urlParams.size ? Number(urlParams.size) : 50;

  // ── Source query ─────────────────────────────────────────────────────────
  const chargingQuery = useChargingSessionsPaginated(vehicleId, {
    limit: 500,
    offset: 0,
    start: startDate,
    end: endDate,
  });
  const {data: sessions, isLoading, error, refetch} = chargingQuery;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;
  const {data: optimizer} = useChargingOptimizer(vehicleIdStr);

  // ── Date filter (vehicle-tz day buckets) ────────────────────────────────
  const dateFilteredSessions = useMemo(() => {
    if (!sessions) {
      return [];
    }
    return sessions.filter(s => {
      const day = localDayKey(s.started_at, tz);
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
  }, [sessions, startDate, endDate, tz]);

  // ── Period stats (current + prior comparison) ───────────────────────────
  const currentStats = useMemo<ChargingPeriodStats>(
    () => computeChargingPeriodStats(dateFilteredSessions, undefined, undefined, tz),
    [dateFilteredSessions, tz],
  );
  const priorRange = useMemo(() => priorPeriod(startDate, endDate), [startDate, endDate]);
  const priorStats = useMemo<ChargingPeriodStats | null>(
    () =>
      priorRange && sessions
        ? computeChargingPeriodStats(sessions, priorRange.start, priorRange.end, tz)
        : null,
    [sessions, priorRange, tz],
  );

  // ── Collection counts (computed BEFORE filter) ──────────────────────────
  const anomalies = useMemo(
    () => detectChargingAnomalies(dateFilteredSessions, currencySymbol),
    [dateFilteredSessions, currencySymbol],
  );
  const anomalyById = useMemo(() => {
    const m = new Map<number, ChargingAnomaly>();
    for (const a of anomalies) {
      m.set(a.session.id, a);
    }
    return m;
  }, [anomalies]);
  const notable = useMemo(() => detectNotableSessions(dateFilteredSessions), [dateFilteredSessions]);
  const homeSessions = useMemo(
    () => dateFilteredSessions.filter(s => getChargerCategory(s.charger_type) === 'home'),
    [dateFilteredSessions],
  );
  const scSessions = useMemo(
    () => dateFilteredSessions.filter(s => getChargerCategory(s.charger_type) === 'supercharger'),
    [dateFilteredSessions],
  );
  const dcSessions = useMemo(
    () => dateFilteredSessions.filter(s => getChargerCategory(s.charger_type) === 'dc'),
    [dateFilteredSessions],
  );
  const freeSessions = useMemo(
    () => dateFilteredSessions.filter(s => s.cost_decimal == null || s.cost_decimal === 0),
    [dateFilteredSessions],
  );

  // ── Apply collection filter ─────────────────────────────────────────────
  const collectionFiltered = useMemo(() => {
    switch (collection) {
      case 'home':
        return homeSessions;
      case 'supercharger':
        return scSessions;
      case 'dc':
        return dcSessions;
      case 'free':
        return freeSessions;
      case 'anomalies':
        return anomalies.map(a => a.session);
      case 'notable':
        return notable;
      case 'tagged':
        return [];
      case 'all':
      default:
        return dateFilteredSessions;
    }
  }, [
    collection,
    dateFilteredSessions,
    homeSessions,
    scSessions,
    dcSessions,
    freeSessions,
    anomalies,
    notable,
  ]);

  // ── Search filter (with structured kv tokens) ───────────────────────────
  const deferredSearch = useDeferredValue(search);
  const isSearchPending = !Object.is(search, deferredSearch);
  const searchTokens = useMemo(() => parseSearchQuery(deferredSearch), [deferredSearch]);
  const filteredSessions = useMemo(() => {
    if (searchTokens.length === 0) {
      return collectionFiltered;
    }
    return collectionFiltered.filter(s =>
      matchesTokens(s, searchTokens, {
        text: sess => [
          sess.start_place,
          sess.charger_type,
          fmtNumber(sess.total_energy_added_wh / 1000),
          sess.cost_decimal != null ? fmtNumber(sess.cost_decimal) : null,
        ],
        kv: {
          charger: (sess, token) => {
            const want = token.value.trim().toLowerCase();
            const got = getChargerCategory(sess.charger_type);
            if (want === 'sc') {
              return got === 'supercharger';
            }
            return got === want;
          },
          cost: (sess, token) => {
            const target = Number(token.value);
            if (!Number.isFinite(target)) {
              return null;
            }
            return compareNumeric(sess.cost_decimal ?? 0, token.op, target);
          },
          kwh: (sess, token) => {
            const target = Number(token.value);
            if (!Number.isFinite(target)) {
              return null;
            }
            return compareNumeric(sess.total_energy_added_wh / 1000, token.op, target);
          },
          power: (sess, token) => {
            const target = Number(token.value);
            if (!Number.isFinite(target)) {
              return null;
            }
            const peak = (sess.peak_power_w ?? 0) / 1000;
            return compareNumeric(peak, token.op, target);
          },
          dur: (sess, token) => {
            const target = parseDurationToken(token.value);
            if (target == null) {
              return null;
            }
            return compareNumeric(durationMinutes(sess), token.op, target);
          },
          in: (sess, token) => {
            const day = localDayKey(sess.started_at, tz);
            return matchesYmdPrefix(day, token.value.trim());
          },
          at: (sess, token) => {
            const want = token.value.trim().toLowerCase();
            const place = (sess.start_place ?? '').toLowerCase();
            return place.includes(want);
          },
          free: sess => sess.cost_decimal == null || sess.cost_decimal === 0,
        },
      }),
    );
  }, [collectionFiltered, searchTokens, tz]);

  // ── Sort ─────────────────────────────────────────────────────────────────
  const sortedSessions = useMemo(() => {
    const arr = [...filteredSessions];
    const cmp = (a: ChargingSession, b: ChargingSession): number => {
      switch (sortBy) {
        case 'energy':
          return a.total_energy_added_wh - b.total_energy_added_wh;
        case 'cost':
          return (a.cost_decimal ?? 0) - (b.cost_decimal ?? 0);
        case 'duration':
          return durationMinutes(a) - durationMinutes(b);
        case 'power':
          return avgPowerW(a) - avgPowerW(b);
        case 'date':
        default:
          return (a.started_at ?? '').localeCompare(b.started_at ?? '');
      }
    };
    arr.sort(cmp);
    if (sortDesc) {
      arr.reverse();
    }
    return arr;
  }, [filteredSessions, sortBy, sortDesc]);

  // ── Pagination ─────────────────────────────────────────────────────────
  const paginatedSessions = useMemo(() => {
    const startIdx = (page - 1) * pageSize;
    return sortedSessions.slice(startIdx, startIdx + pageSize);
  }, [sortedSessions, page, pageSize]);

  // ── Date-grouped view of the paginated list ─────────────────────────────
  const groupedSessions = useMemo<DateGroupedListGroup<ChargingSession>[]>(() => {
    const buckets = new Map<string, ChargingSession[]>();
    for (const s of paginatedSessions) {
      const key = localDayKey(s.started_at, tz);
      if (!key) {
        continue;
      }
      const list = buckets.get(key) ?? [];
      list.push(s);
      buckets.set(key, list);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => (sortDesc ? b.localeCompare(a) : a.localeCompare(b)))
      .map(([dateKey, items]) => {
        const totalEnergy =
          items.reduce((acc, s) => acc + s.total_energy_added_wh, 0) / 1000;
        const noun =
          items.length === 1
            ? t('bulk.noun.session_one', 'session')
            : t('bulk.noun.session_other', 'sessions');
        return {
          dateKey,
          dateLabel: formatDayKey(dateKey, {style: 'long'}),
          relativeLabel: formatRelativeDays(`${dateKey}T12:00:00Z`, {tz: 'UTC'}),
          summary: `${items.length} ${noun} · ${fmtNumber(totalEnergy)} kWh`,
          items,
        };
      });
  }, [paginatedSessions, t, tz, sortDesc]);

  // ── Trend chart series ───────────────────────────────────────────────────
  const trendSeries = useMemo(
    () => ({
      sessions: dailyChargingTrend(dateFilteredSessions, 'sessions', tz),
      energy: dailyChargingTrend(dateFilteredSessions, 'energy', tz),
      cost: dailyChargingTrend(dateFilteredSessions, 'cost', tz),
      power: dailyChargingTrend(dateFilteredSessions, 'power', tz),
    }),
    [dateFilteredSessions, tz],
  );

  const trendMetricsConfig: MetricSwitcherMetric<{date: string; value: number}>[] =
    useMemo(
      () => [
        {
          key: 'sessions',
          label: t('charging.metric.sessions', 'Sessions'),
          chart: 'bar',
          color: '#10b981',
          accent: 'green',
          formatValue: v => fmtInt(v),
          formatTick: v => fmtInt(v),
        },
        {
          key: 'energy',
          label: t('charging.metric.energy', 'Energy'),
          chart: 'bar',
          color: '#06b6d4',
          accent: 'cyan',
          formatValue: v => `${fmtNumber(v)} kWh`,
          formatTick: v => fmtNumber(v),
        },
        {
          key: 'cost',
          label: t('charging.metric.cost', 'Cost'),
          chart: 'bar',
          color: '#ef4444',
          accent: 'red',
          formatValue: v => formatCurrency(v),
          formatTick: v => formatCurrency(v, 0),
        },
        {
          key: 'power',
          label: t('charging.metric.power', 'Avg power'),
          chart: 'line',
          color: '#a855f7',
          accent: 'purple',
          formatValue: v => `${fmtNumber(v)} kW`,
          formatTick: v => fmtNumber(v, 0),
        },
      ],
      [t, formatCurrency],
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
      const visible = new Set(filteredSessions.map(s => s.id));
      const next = new Set<number>();
      prev.forEach(id => {
        if (visible.has(id)) {
          next.add(id);
        }
      });
      return next.size === prev.size ? prev : next;
    });
  }, [filteredSessions]);
  const toggleSessionSelected = useCallback((id: number, on: boolean) => {
    setBulkSelected(prev => {
      const n = new Set(prev);
      if (on) {
        n.add(id);
      } else {
        n.delete(id);
      }
      return n;
    });
  }, []);
  const clearBulk = useCallback(() => setBulkSelected(new Set()), []);
  const bulkDeleteMut = useBulkDeleteCharging();
  const bulkActions = useMemo<BulkAction[]>(
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
                ? t('bulk.noun.session_one', 'session')
                : t('bulk.noun.session_other', 'sessions'),
          }),
          description: t('bulk.deleteConfirmDescription', 'This cannot be undone.'),
          confirmLabel: t('common.delete', 'Delete'),
        },
        onClick: async ids => {
          await bulkDeleteMut.mutateAsync(ids.map(Number));
          clearBulk();
        },
      },
    ],
    [t, bulkSelected.size, bulkDeleteMut, clearBulk],
  );

  // ── Export (web blob/anchor → React Native Share) ───────────────────────
  const exportRows = useCallback(
    (scope: 'visible' | 'selected'): ChargingSession[] => {
      if (scope === 'selected') {
        return sortedSessions.filter(s => bulkSelected.has(s.id));
      }
      return sortedSessions;
    },
    [sortedSessions, bulkSelected],
  );
  const triggerDownload = useCallback(
    async (content: string, ext: string) => {
      try {
        await Share.share({
          message: content,
          title: `teslasync-charging-${startDate}-to-${endDate}.${ext}`,
        });
      } catch {
        // User dismissed the share sheet — nothing to do.
      }
    },
    [startDate, endDate],
  );
  const handleExportCsv = useCallback(
    (scope: 'visible' | 'selected') => {
      const rows = exportRows(scope);
      const header = [
        'id',
        'started_at',
        'ended_at',
        'charger_type',
        'kwh',
        'cost',
        'duration_min',
        'avg_kw',
        'peak_kw',
        'start_place',
      ];
      const lines = [header.join(',')];
      for (const s of rows) {
        const fields: Array<string | number> = [
          s.id,
          s.started_at,
          s.ended_at ?? '',
          s.charger_type ?? '',
          (s.total_energy_added_wh / 1000).toFixed(3),
          s.cost_decimal ?? '',
          durationMinutes(s).toFixed(1),
          (avgPowerW(s) / 1000).toFixed(2),
          ((s.peak_power_w ?? 0) / 1000).toFixed(2),
          (s.start_place ?? '').replace(/"/g, '""'),
        ];
        lines.push(
          fields
            .map(v => {
              const str = String(v);
              return /[,"\n]/.test(str) ? `"${str}"` : str;
            })
            .join(','),
        );
      }
      triggerDownload(lines.join('\n'), 'csv');
    },
    [exportRows, triggerDownload],
  );
  const handleExportJson = useCallback(
    (scope: 'visible' | 'selected') => {
      const rows = exportRows(scope);
      triggerDownload(JSON.stringify(rows, null, 2), 'json');
    },
    [exportRows, triggerDownload],
  );

  // ── Period labels ────────────────────────────────────────────────────────
  const datePresetId = useMemo(() => matchPresetId(startDate, endDate), [startDate, endDate]);
  const datePreset = datePresetId ? getDatePreset(datePresetId) : undefined;
  const datePresetLabel = datePreset ? t(datePreset.i18nKey, datePreset.fallback) : null;
  const formattedRange = `${formatDayKey(startDate, {style: 'long'})} – ${formatDayKey(
    endDate,
    {style: 'long'},
  )}`;
  const periodLabel = datePresetLabel
    ? `${datePresetLabel} · ${formattedRange}`
    : formattedRange;
  const priorHasData = priorStats != null && priorStats.count > 0;
  const priorLabel: string | undefined =
    priorHasData && priorRange
      ? t('charging.priorPeriod', 'prior period: {{start}} – {{end}}', {
          start: formatDayKey(priorRange.start, {style: 'long'}),
          end: formatDayKey(priorRange.end, {style: 'long'}),
        })
      : priorRange
      ? t('charging.noPriorData', 'No charging in prior period: {{start}} – {{end}}', {
          start: formatDayKey(priorRange.start, {style: 'long'}),
          end: formatDayKey(priorRange.end, {style: 'long'}),
        })
      : undefined;

  // ── Anomaly callout ──────────────────────────────────────────────────────
  const anomalyFooter =
    anomalies.length > 0 && collection !== 'anomalies' ? (
      <InlineCallout
        variant="warning"
        glyph="⚠"
        action={{
          label: t('charging.viewAnomalies', 'View anomalies'),
          onPress: () => setUrlBatch({coll: 'anomalies', page: null}),
        }}>
        {t('charging.anomalyCount', '{{count}} {{noun}} in this range', {
          count: anomalies.length,
          noun:
            anomalies.length === 1
              ? t('charging.anomaly_one', 'anomaly')
              : t('charging.anomaly_other', 'anomalies'),
        })}
      </InlineCallout>
    ) : null;

  // ── Secondary line ───────────────────────────────────────────────────────
  const secondaryLine =
    currentStats.count > 0 ? (
      <View style={styles.secondaryLine}>
        <AppText variant="caption" tone="muted">
          {t('charging.byType', '{{home}} home · {{sc}} SC · {{dc}} DC', {
            home: currentStats.byCategory.home,
            sc: currentStats.byCategory.supercharger,
            dc: currentStats.byCategory.dc,
          })}
        </AppText>
        <AppText variant="caption" tone="muted">
          {' · '}
        </AppText>
        <AppText variant="caption" tone="muted">
          {t('charging.freeCount', '{{count}} free', {count: currentStats.freeCount})}
        </AppText>
        {currentStats.batteryFriendlyScore != null ? (
          <AppText variant="caption" tone="muted">
            {' · '}
            {t('charging.batteryScore', 'Battery score')}{' '}
            <AppText
              variant="caption"
              weight="semibold"
              style={{color: currentStats.batteryFriendlyGrade.color}}>
              {currentStats.batteryFriendlyGrade.label}
            </AppText>
          </AppText>
        ) : null}
        {currentStats.mostCommonStartHour != null ? (
          <AppText variant="caption" tone="muted">
            {' · '}
            {t('charging.mostCommon', 'Most common start: {{hour}}', {
              hour: formatHour(currentStats.mostCommonStartHour),
            })}
          </AppText>
        ) : null}
      </View>
    ) : null;

  // ── Collection pills ─────────────────────────────────────────────────────
  const collectionPills: PillItem[] = useMemo(
    () => [
      {key: 'all', label: t('charging.coll.all', 'All'), count: dateFilteredSessions.length, accent: 'cyan', glyph: '≡'},
      {key: 'home', label: t('charging.coll.home', 'Home'), count: homeSessions.length, accent: 'green', glyph: '🏠'},
      {key: 'supercharger', label: t('charging.coll.supercharger', 'Supercharger'), count: scSessions.length, accent: 'red', glyph: '⚡'},
      {key: 'dc', label: t('charging.coll.dc', 'DC Fast'), count: dcSessions.length, accent: 'amber', glyph: '⚡'},
      {key: 'free', label: t('charging.coll.free', 'Free'), count: freeSessions.length, accent: 'green', glyph: '☀'},
      {key: 'anomalies', label: t('charging.coll.anomalies', 'Anomalies'), count: anomalies.length, accent: 'red', glyph: '⚠'},
      {key: 'notable', label: t('charging.coll.notable', 'Notable'), count: notable.length, accent: 'purple', glyph: '★'},
      {key: 'tagged', label: t('charging.coll.tagged', 'Tagged'), count: 0, accent: 'blue', glyph: '🏷', disabled: true},
    ],
    [
      t,
      dateFilteredSessions.length,
      homeSessions.length,
      scSessions.length,
      dcSessions.length,
      freeSessions.length,
      anomalies.length,
      notable.length,
    ],
  );
  const collectionLabel = collectionPills.find(p => p.key === collection)?.label ?? 'All';

  // ── Sticky summary ───────────────────────────────────────────────────────
  const stickySummary = (
    <View style={styles.stickyBar} testID="charging-sticky-summary">
      <AppText variant="caption" tone="secondary" numberOfLines={1} style={styles.stickyItem}>
        {t('charging.list.title', 'Charging Sessions')}
      </AppText>
      <AppText variant="caption" tone="muted">
        {' · '}
      </AppText>
      <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.stickyItem}>
        {periodLabel}
      </AppText>
      <AppText variant="caption" tone="muted">
        {' · '}
      </AppText>
      <AppText variant="caption" weight="semibold" numberOfLines={1}>
        {collectionLabel}
      </AppText>
      <AppText variant="caption" tone="muted">
        {' · '}
      </AppText>
      <AppText variant="caption" tone="muted">
        {`${fmtCompact(filteredSessions.length)} ${t('charging.results', 'results')}`}
      </AppText>
      {currentStats.batteryFriendlyGrade.label !== '—' ? (
        <AppText variant="caption" tone="muted">
          {' · '}
          {t('charging.avgScore', 'avg')}{' '}
          <AppText
            variant="caption"
            weight="semibold"
            style={{color: currentStats.batteryFriendlyGrade.color}}>
            {currentStats.batteryFriendlyGrade.label}
          </AppText>
        </AppText>
      ) : null}
    </View>
  );

  // ── Sort options ─────────────────────────────────────────────────────────
  const sortOptions = useMemo(
    () => [
      {value: 'date' as const, label: t('charging.sort.date', 'Date')},
      {value: 'energy' as const, label: t('charging.sort.energy', 'Energy')},
      {value: 'cost' as const, label: t('charging.sort.cost', 'Cost')},
      {value: 'duration' as const, label: t('charging.sort.duration', 'Duration')},
      {value: 'power' as const, label: t('charging.sort.power', 'Power')},
    ],
    [t],
  );

  // ── Conditional sections — pre-computed inputs ──────────────────────────
  const acDcBreakdown = useMemo(
    () => (sessions ? computeAcDcBreakdown(sessions) : null),
    [sessions],
  );
  const startLevelDist = useMemo(
    () => (sessions ? computeStartLevelDist(sessions) : []),
    [sessions],
  );
  const efficiencyStats = useMemo(
    () => (sessions ? computeEfficiencyStats(sessions) : null),
    [sessions],
  );
  const chargerSpecs = useMemo(
    () => (sessions ? computeChargerSpecs(sessions) : null),
    [sessions],
  );

  // ── Defensive: no vehicle ───────────────────────────────────────────────
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('charging.list.title', 'Charging Sessions')} />;
  }

  return (
    <PageContainer
      title={t('charging.list.title', 'Charging Sessions')}
      subtitle={t(
        'charging.list.subtitle',
        'Cost, charger type, energy patterns, and battery-friendly scoring',
      )}
      copyLink
      refreshing={chargingQuery.isFetching && !isLoading}
      onRefresh={() => {
        refetch();
      }}
      actions={
        <View style={styles.headerActions}>
          <VehicleSelect />
          <RangePicker
            value={{start: startDate, end: endDate}}
            onChange={r => setUrlBatch({from: r.start, to: r.end, page: null})}
            align="end"
            triggerTestId="charging-list-range"
          />
          <DataFreshnessAuto query={chargingQuery} />
        </View>
      }>
      {stickySummary}

      <QueryError
        error={(error as Error) ?? null}
        onRetry={() => {
          refetch();
        }}
      />

      {/* Search + active filter chips */}
      <FadeIn>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={v => setUrlBatch({q: v || null, page: null})}
            placeholder={t(
              'charging.searchPlaceholder',
              'Search charging — try "charger:home", "cost:>5", "kwh:>20", "Costco"',
            )}
            historyScope="charging"
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
                    label: t('charging.filterLabel.search', 'Search'),
                    value: search,
                    onRemove: () => setUrlBatch({q: null, page: null}),
                  }
                : null,
              collection !== 'all'
                ? {
                    key: 'coll',
                    label: t('charging.filterLabel.collection', 'View'),
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
            id="charging-overview"
            testId="charging-overview"
            header={{
              title: t('charging.overview', 'Overview'),
              currentLabel: periodLabel,
              comparisonLabel: priorLabel,
            }}
            kpis={
              <>
                <MetricCard
                  label={t('charging.totalSessions', 'Sessions')}
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
                  label={t('charging.totalEnergy', 'Energy (kWh)')}
                  value={fmtCompact(currentStats.totalEnergyWh / 1000, 10000)}
                  color="green"
                  delta={
                    priorHasData
                      ? {
                          metric: 'energy_consumed',
                          previous: priorStats!.totalEnergyWh / 1000,
                          current: currentStats.totalEnergyWh / 1000,
                          display: 'percent',
                        }
                      : undefined
                  }
                />
                <MetricCard
                  label={t('charging.totalCost', 'Cost')}
                  value={formatCurrency(currentStats.totalCost)}
                  color="red"
                  delta={
                    priorHasData
                      ? {
                          metric: 'cost',
                          previous: priorStats!.totalCost,
                          current: currentStats.totalCost,
                          display: 'percent',
                        }
                      : undefined
                  }
                />
                <MetricCard
                  label={t('charging.avgRate', 'Avg rate (kW)')}
                  value={
                    currentStats.avgRateKw != null
                      ? fmtNumber(currentStats.avgRateKw)
                      : '—'
                  }
                  color="purple"
                  delta={
                    priorHasData &&
                    currentStats.avgRateKw != null &&
                    priorStats!.avgRateKw != null
                      ? {
                          metric: {direction: 'neutral'},
                          previous: priorStats!.avgRateKw,
                          current: currentStats.avgRateKw,
                          display: 'percent',
                        }
                      : undefined
                  }
                />
                <MetricCard
                  label={t('charging.avgDuration', 'Avg duration')}
                  value={
                    currentStats.avgDurationMin != null
                      ? formatDurationMinutes(currentStats.avgDurationMin)
                      : '—'
                  }
                  color="blue"
                  delta={
                    priorHasData &&
                    currentStats.avgDurationMin != null &&
                    priorStats!.avgDurationMin != null
                      ? {
                          metric: {direction: 'neutral'},
                          previous: priorStats!.avgDurationMin,
                          current: currentStats.avgDurationMin,
                          display: 'percent',
                        }
                      : undefined
                  }
                />
                <MetricCard
                  label={t('charging.avgPower', 'Avg power (kW)')}
                  value={
                    currentStats.avgPowerW != null
                      ? fmtNumber(currentStats.avgPowerW / 1000)
                      : '—'
                  }
                  color="amber"
                  delta={
                    priorHasData &&
                    currentStats.avgPowerW != null &&
                    priorStats!.avgPowerW != null
                      ? {
                          metric: {direction: 'neutral'},
                          previous: priorStats!.avgPowerW / 1000,
                          current: currentStats.avgPowerW / 1000,
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
            <EmptyState
              message={t('charging.noStatsRange', 'No charging sessions in this range')}
            />
          </GlassPanel>
        )}
      </FadeIn>

      {/* Trend chart */}
      {currentStats.count > 0 ? (
        <FadeIn>
          <MetricSwitcherChart
            title={t('charging.overTime', 'Charging over time')}
            ariaLabel={t(
              'charging.overTime.aria',
              'Charging over time chart with metric switcher',
            )}
            series={trendSeries}
            metrics={trendMetricsConfig}
            activeMetric={trendMetric}
            onMetricChange={k => setTrendMetric(k as ChargingTrendMetric)}
            formatXTick={formatChartXTick}
            emptyMessage={t(
              'charging.overTime.empty',
              'No data for this metric in the selected range',
            )}
            testId="charging-trend-chart"
          />
        </FadeIn>
      ) : null}

      {/* Collections */}
      <FadeIn>
        <PillFilterBar
          items={collectionPills}
          activeKey={collection}
          onChange={k => setUrlBatch({coll: k === 'all' ? null : k, page: null})}
          ariaLabel={t('charging.collections.aria', 'Filter charging sessions by collection')}
          testID="charging-collections"
        />
      </FadeIn>

      {/* Conditional analytical sections, each gated by a threshold */}
      {sessions ? (
        <>
          {acDcBreakdown &&
          acDcBreakdown.ac.count + acDcBreakdown.dc.count >= THRESHOLD_AC_DC ? (
            <FadeIn delay={0.05}>
              <AcDcStatsPanel breakdown={acDcBreakdown} />
            </FadeIn>
          ) : null}

          {startLevelDist.length > 0 && sessions.length >= THRESHOLD_BATTERY_DIST ? (
            <FadeIn delay={0.07}>
              <BatteryLevelChart data={startLevelDist} />
            </FadeIn>
          ) : sessions.length > 0 && sessions.length < THRESHOLD_BATTERY_DIST ? (
            <FadeIn delay={0.07}>
              <EmptyStateThreshold
                currentCount={sessions.length}
                threshold={THRESHOLD_BATTERY_DIST}
                itemNoun={t('charging.itemNoun', 'sessions')}
                sectionLabel={t(
                  'charging.section.batteryDist',
                  'Battery start-level distribution',
                )}
                description={t(
                  'charging.section.batteryDistDesc',
                  'See where you typically start charging.',
                )}
              />
            </FadeIn>
          ) : null}

          {efficiencyStats ? (
            <FadeIn delay={0.09}>
              <EfficiencyPanel stats={efficiencyStats} />
            </FadeIn>
          ) : null}

          {chargerSpecs && sessions.length >= THRESHOLD_SPECS ? (
            <FadeIn delay={0.11}>
              <ChargerSpecsPanel specs={chargerSpecs} />
            </FadeIn>
          ) : sessions.length > 0 && sessions.length < THRESHOLD_SPECS ? (
            <FadeIn delay={0.11}>
              <EmptyStateThreshold
                currentCount={sessions.length}
                threshold={THRESHOLD_SPECS}
                itemNoun={t('charging.itemNoun', 'sessions')}
                sectionLabel={t('charging.section.specs', 'Charger specs breakdown')}
              />
            </FadeIn>
          ) : null}

          {optimizer && sessions.length >= THRESHOLD_OPTIMIZER ? (
            <OptimizerSection optimizer={optimizer} />
          ) : sessions.length > 0 && sessions.length < THRESHOLD_OPTIMIZER ? (
            <FadeIn delay={0.13}>
              <EmptyStateThreshold
                currentCount={sessions.length}
                threshold={THRESHOLD_OPTIMIZER}
                itemNoun={t('charging.itemNoun', 'sessions')}
                sectionLabel={t('charging.section.optimizer', 'Cost optimizer & heatmap')}
                description={t(
                  'charging.section.optimizerDesc',
                  'Smart scheduling recommendations require pattern recognition.',
                )}
              />
            </FadeIn>
          ) : null}
        </>
      ) : null}

      {/* List controls bar */}
      {sortedSessions.length > 0 ? (
        <View style={styles.listControls}>
          <SectionTitle glyph="🔌" glyphColor={ACCENT_HEX.green}>
            {`${t('charging.allSessions', 'All sessions')} (${fmtCompact(
              sortedSessions.length,
            )})`}
          </SectionTitle>
          <View style={styles.listControlsRow}>
            <SortControl<SortField>
              field={sortBy}
              direction={sortDesc ? 'desc' : 'asc'}
              options={sortOptions}
              onFieldChange={setSortBy}
              onDirectionChange={(d: SortDirection) => setSortDesc(d === 'desc')}
              testID="charging-sort"
            />
            <DensityToggle
              value={density}
              onChange={setDensity}
              options={['compact', 'comfortable']}
              testID="charging-density"
            />
            <ListExportMenu
              onExportCsv={handleExportCsv}
              onExportJson={handleExportJson}
              selectedCount={bulkSelected.size}
              visibleCount={sortedSessions.length}
              testID="charging-export"
            />
          </View>
        </View>
      ) : !isLoading ? (
        <EmptyState
          glyph="📊"
          message={t('common.noData', 'No data available')}
        />
      ) : null}

      {/* Session list */}
      {isLoading ? (
        <View style={styles.skeletonStack}>
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} height={80} />
          ))}
        </View>
      ) : paginatedSessions.length > 0 ? (
        <>
          <BulkActionsToolbar
            selectedIds={Array.from(bulkSelected)}
            total={filteredSessions.length}
            onClear={clearBulk}
            actions={bulkActions}
            itemNoun={{
              one: t('bulk.noun.session_one', 'session'),
              other: t('bulk.noun.session_other', 'sessions'),
            }}
          />
          <StaggerContainer>
            <DateGroupedList
              groups={groupedSessions}
              itemKey={s => s.id}
              renderItem={s => (
                <StaggerItem>
                  <ChargingSessionCard
                    session={s}
                    toDistanceDisplay={toDistanceDisplay}
                    distanceUnit={distanceUnit}
                    selected={bulkSelected.has(s.id)}
                    onToggleSelect={toggleSessionSelected}
                    anomaly={anomalyById.get(s.id)}
                    density={density === 'compact' ? 'compact' : 'comfortable'}
                  />
                </StaggerItem>
              )}
            />
          </StaggerContainer>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={sortedSessions.length}
            onPageChange={setPage}
            onPageSizeChange={s => setUrlBatch({size: String(s), page: null})}
          />
        </>
      ) : !isLoading ? (
        <EmptyState
          glyph="🔋"
          title={
            collection !== 'all'
              ? t('charging.emptyForCollection', 'No charging sessions in this view')
              : t('charging.emptyTitle', 'No charging sessions yet')
          }
          message={
            collection !== 'all'
              ? t(
                  'charging.emptyForCollection.msg',
                  'Try switching to a different collection or clearing your filters.',
                )
              : t(
                  'charging.emptyMessage',
                  'Charging data will appear here once your vehicle records sessions.',
                )
          }
          action={{
            label: t('charging.empty.cta', 'Reset filters'),
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
      ) : null}
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  glyph: {
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    opacity: 0.5,
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
  thresholdPanel: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  thresholdTitle: {
    color: colors.textPrimary,
  },
  thresholdBody: {
    lineHeight: 18,
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
  segment: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  segmentItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  segmentItemActive: {
    backgroundColor: colors.surfaceSelected,
  },
  sortControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  sortPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortPillActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  sortDir: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exportTrigger: {
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
  panel: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  panelHint: {
    marginBottom: spacing.xs,
  },
  splitBar: {
    flexDirection: 'row',
    height: 18,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  splitSeg: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitAc: {
    backgroundColor: '#3b82f6',
  },
  splitDc: {
    backgroundColor: '#f59e0b',
  },
  barAmber: {
    backgroundColor: '#f59e0b',
  },
  splitLabel: {
    color: '#ffffff',
    fontSize: 9,
  },
  acDcRow: {
    gap: 2,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  acDcFree: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  statTiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statTile: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 120,
    alignItems: 'center',
    padding: spacing.md,
    gap: 2,
  },
  statTileValue: {
    fontSize: 22,
  },
  statTileLabel: {
    textAlign: 'center',
  },
  statTileSub: {
    fontSize: 10,
    textAlign: 'center',
  },
  specGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  specColumn: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 140,
    gap: spacing.xs,
  },
  specColumnLabel: {
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  specRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  specName: {
    flexShrink: 1,
  },
  heatmapGrid: {
    gap: 2,
  },
  heatmapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  heatmapDay: {
    width: 34,
    fontSize: 10,
  },
  heatmapCell: {
    width: 20,
    height: 16,
    borderRadius: 3,
  },
  scorePanel: {
    alignItems: 'center',
  },
  scoreValue: {
    fontSize: 40,
  },
  scoreTrack: {
    width: '70%',
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  scoreFill: {
    height: '100%',
    borderRadius: 999,
  },
  scoreHint: {
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  recRow: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: colors.surfaceRaised,
  },
  recHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  recTitle: {
    color: colors.textPrimary,
  },
  recBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
  },
  scoreBadge: {
    minWidth: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  miniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  sessionCard: {
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    gap: spacing.sm,
  },
  sessionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sessionPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
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
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  secondaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  stickyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  stickyItem: {
    flexShrink: 1,
  },
  listControls: {
    gap: spacing.sm,
  },
  listControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
});
