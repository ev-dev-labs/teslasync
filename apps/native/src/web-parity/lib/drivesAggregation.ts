// Native parity port of web/src/lib/drivesAggregation.ts.
//
// PURPOSE (web, source L1-9): pure, deterministic, side-effect-free aggregation
// helpers for the Drives feature. Every export is React-free arithmetic so it
// can be unit-tested in isolation and reused by widgets/pages without pulling in
// presentational code. The surface (ported name-for-name and signature-for-
// signature):
//   • Grades (source L13-100): GradeLabel/Grade types, the shared GRADE_PALETTE,
//     getEfficiency (Wh/km per drive), gradeFromEfficiency (eff -> letter),
//     gradeFromNumeric (averaged weight -> letter), avgGrade (mean grade over a
//     list, skipping ungraded drives).
//   • Period stats (source L102-248): PeriodStats type, computePeriodStats
//     (windowed headline rollup with an inclusive tz-anchored date filter),
//     priorPeriod (equal-length window immediately before the current one) and
//     its string-day helpers ymdToUtcMillis / utcMillisToYmd.
//   • Collections (source L250-314): detectAnomalies (grade-D drives),
//     detectNotable (top-decile-by-distance ∪ A+ grade, decile pool capped at
//     50), normaliseAddress + detectCommutes (recurring direction-insensitive
//     origin↔end pairs, default minOccurrences=3).
//   • Date grouping + daily trend (source L316-459): DateGroup type, localDayKey
//     (ISO -> tz-anchored YYYY-MM-DD), parseLocalDay (YYYY-MM-DD -> UTC-noon
//     Date), groupByDate (descending-date buckets), TrendMetric/TrendPoint
//     types, dailyTrend (per-day metric rollup, averaging eff/score buckets).
//
// NATIVE ADAPTATION (contract rules 5-7): this source is non-visual utility code
// with ZERO DOM / window / Recharts / Leaflet / web-UI dependency, so the logic
// is ported VERBATIM — every threshold, palette hex, fallback, Math/Map/Set/Date
// expression, regex, and sort comparator is byte-identical to the web original.
// The only runtime primitive used is Intl.DateTimeFormat (via the inlined
// ymdInTz below), which is Hermes-supported and already exercised elsewhere in
// this native tree (lib/format.ts, web-parity/lib/currencyFormat.ts,
// web-parity/features/driving/pages/DrivesListPage.tsx). There is therefore NO
// browser-only behavior to gate and NO "unavailable" state to expose.
//
// IMPORTS REMAP (two web siblings, neither yet a web-parity/lib parity module —
// pre-creating them here would collide with their own file-by-file slots, so we
// follow the established gpx.ts precedent):
//   • `import type { Drive } from '@/types/driving'` (source L10) is remapped to
//     the native location where the camelCase domain `Drive` type actually lives
//     and is consumed today — `../api/hooks/useDriving` (field-identical to the
//     web @/types/driving Drive). This is the exact import DrivesListPage.tsx
//     already uses, so `PeriodStats.longest`, `computePeriodStats(drives)`,
//     `detectAnomalies(): Drive[]`, etc. stay structurally compatible with every
//     other native Drive consumer. It is a TYPE-ONLY import (erased at compile
//     time), so no react-query/fetch runtime is pulled in.
//   • `import { ymdInTz } from './dateFormat'` (source L11) is reproduced as the
//     module-private `ymdInTz` below — a faithful copy of dateFormat.ts L154-206
//     (the memoized getFormatter + FORMATTER_CACHE and the tz/no-tz/invalid-IANA
//     branches). The only mechanical change is `Number.isNaN` in place of the
//     web global `isNaN` (no-op for the numeric getTime() input, and the style
//     this source already uses at L339), keeping it native-lint-clean.
//
// Native formatting per apps/native/.prettierrc.js (singleQuote, trailingComma
// 'all', arrowParens 'avoid') is the only other difference from source; the web
// source is already semicolon-terminated, so no semantic change.

import type { Drive } from '../api/hooks/useDriving';

/* ------------------------------------------------------------------ */
/*  Inlined day-key primitive (web ./dateFormat > ymdInTz, L154-206)   */
/* ------------------------------------------------------------------ */

/**
 * Cache of `Intl.DateTimeFormat` instances keyed by `tz|locale|fields`.
 * `Intl.DateTimeFormat` constructors are expensive enough that re-creating
 * one per call (e.g. once per drive in a 10K-row list) is a real cost.
 * Module-level memoization keeps the helpers cheap to call in tight loops.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getFormatter(
  opts: Intl.DateTimeFormatOptions,
  locale?: string,
): Intl.DateTimeFormat {
  // Empty / whitespace-only locale strings would throw `RangeError: Invalid
  // language tag: ` if passed to `Intl.DateTimeFormat`. Coerce to undefined
  // so the runtime falls back to the host default.
  const safeLocale =
    typeof locale === 'string' && locale.trim().length > 0 ? locale : undefined;
  const key = `${safeLocale ?? ''}|${JSON.stringify(opts)}`;
  let fmt = FORMATTER_CACHE.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(safeLocale, opts);
    FORMATTER_CACHE.set(key, fmt);
  }
  return fmt;
}

/**
 * Extract a `YYYY-MM-DD` string from a Date in the requested timezone.
 * Falls back to the browser's local zone when `tz` is unset. Shared day-key
 * primitive that {@link localDayKey} builds on so every "what day is this
 * drive on?" question gives the same answer across the page.
 */
function ymdInTz(d: Date, tz?: string): string | null {
  if (Number.isNaN(d.getTime())) return null;
  if (!tz) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  // Use formatToParts so we get raw numeric components — toLocaleDateString
  // would inject locale separators we'd then have to parse back out.
  try {
    const fmt = getFormatter(
      { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' },
      'en-US',
    );
    const parts = fmt.formatToParts(d);
    const get = (type: string): string | undefined =>
      parts.find(p => p.type === type)?.value;
    const y = get('year');
    const m = get('month');
    const day = get('day');
    if (!y || !m || !day) return null;
    return `${y}-${m}-${day}`;
  } catch {
    // Invalid IANA tz — fall back to browser-local rather than throwing.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Grades                                                            */
/* ------------------------------------------------------------------ */

export type GradeLabel = 'A+' | 'A' | 'B' | 'C' | 'D' | '—';

export interface Grade {
  /** Display label. `—` means insufficient data to grade. */
  label: GradeLabel;
  /** Hex colour matching the existing per-drive badge palette. */
  color: string;
  /**
   * Numeric weight used for averaging across many drives. `null` for
   * ungraded drives so callers can skip them in arithmetic.
   */
  numeric: number | null;
}

/** Internal: shared palette so both grade calculators stay in sync. */
const GRADE_PALETTE: Record<
  GradeLabel,
  { color: string; numeric: number | null }
> = {
  'A+': { color: '#10b981', numeric: 4.5 },
  A: { color: '#10b981', numeric: 4.0 },
  B: { color: '#00f0ff', numeric: 3.0 },
  C: { color: '#f59e0b', numeric: 2.0 },
  D: { color: '#ef4444', numeric: 1.0 },
  '—': { color: '#6b7280', numeric: null },
};

/**
 * Per-drive efficiency in Wh/km. `null` when the drive lacks the inputs
 * needed to compute it (no battery delta, zero distance). This matches the
 * formula previously inlined inside `DrivesListPage.tsx`.
 */
export function getEfficiency(drive: Drive): number | null {
  const batteryUsed = (drive.startBatteryPct ?? 0) - (drive.endBatteryPct ?? 0);
  if (drive.distanceM > 0 && batteryUsed > 0) {
    return (batteryUsed * 0.75 * 1000) / (drive.distanceM / 1000);
  }
  return null;
}

/**
 * Map an efficiency value (Wh/km) to a letter grade. Lower is better:
 * thresholds match the per-card badge in `DrivesListPage` so the hero
 * average and the row badges agree on what "B" means.
 */
export function gradeFromEfficiency(eff: number | null): Grade {
  if (eff == null) return { label: '—', ...GRADE_PALETTE['—'] };
  let label: GradeLabel;
  if (eff < 130) label = 'A+';
  else if (eff < 160) label = 'A';
  else if (eff < 190) label = 'B';
  else if (eff < 220) label = 'C';
  else label = 'D';
  return { label, ...GRADE_PALETTE[label] };
}

/**
 * Map a numeric weight back to a letter grade. Used after averaging
 * `Grade.numeric` values across a window so we can render a single badge.
 */
export function gradeFromNumeric(numeric: number | null): Grade {
  if (numeric == null || !Number.isFinite(numeric)) {
    return { label: '—', ...GRADE_PALETTE['—'] };
  }
  let label: GradeLabel;
  if (numeric >= 4.25) label = 'A+';
  else if (numeric >= 3.5) label = 'A';
  else if (numeric >= 2.5) label = 'B';
  else if (numeric >= 1.5) label = 'C';
  else label = 'D';
  return { label, ...GRADE_PALETTE[label] };
}

/** Average grade across a list of drives. Skips ungraded drives. */
export function avgGrade(drives: readonly Drive[]): Grade {
  let total = 0;
  let n = 0;
  for (const d of drives) {
    const g = gradeFromEfficiency(getEfficiency(d));
    if (g.numeric != null) {
      total += g.numeric;
      n += 1;
    }
  }
  if (n === 0) return { label: '—', ...GRADE_PALETTE['—'] };
  return gradeFromNumeric(total / n);
}

/* ------------------------------------------------------------------ */
/*  Period stats                                                      */
/* ------------------------------------------------------------------ */

export interface PeriodStats {
  count: number;
  /** Total distance in metres (SI canonical). */
  totalDistanceM: number;
  /** Total duration in seconds (SI canonical). */
  totalDurationS: number;
  /** Average efficiency in Wh/km (SI canonical). `null` when ungradable. */
  avgEfficiencyWhKm: number | null;
  /** Best (lowest) efficiency in Wh/km. `null` when ungradable. */
  bestEfficiencyWhKm: number | null;
  /** Top instantaneous speed in m/s. */
  topSpeedMps: number;
  /** Longest single drive (by distance). `null` for empty windows. */
  longest: Drive | null;
  /** Average grade weight, ready for `gradeFromNumeric`. */
  avgGradeNumeric: number | null;
  /** Total energy used (kWh), summed from per-drive battery delta. */
  totalEnergyKwh: number;
}

/**
 * Date filter applied to a drive's `startTs`. The drive's day is
 * computed via {@link localDayKey} so that the filter follows the
 * requested timezone — pass the vehicle's IANA tz to match what the
 * user sees in the row's date header. Both bounds are inclusive.
 */
function inDateRange(
  d: Drive,
  startDate?: string,
  endDate?: string,
  tz?: string,
): boolean {
  const day = localDayKey(d.startTs, tz);
  if (!day) return true;
  if (startDate && day < startDate) return false;
  if (endDate && day > endDate) return false;
  return true;
}

/**
 * Aggregate a window of drives into headline stats. Pass `startDate` /
 * `endDate` as `YYYY-MM-DD` strings to scope; omit both to compute over
 * the entire input list. `tz` (optional) anchors the day boundary used
 * by the date filter — pass the vehicle's IANA zone for vehicle-history
 * surfaces so the period count matches what the user counted by eye.
 */
export function computePeriodStats(
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
    if (!inDateRange(d, startDate, endDate, tz)) continue;
    count += 1;
    totalDistanceM += d.distanceM;
    totalDurationS += d.durationS;
    if ((d.maxSpeedMps ?? 0) > topSpeedMps) topSpeedMps = d.maxSpeedMps ?? 0;
    if (longest == null || d.distanceM > longest.distanceM) longest = d;

    const eff = getEfficiency(d);
    if (eff != null) {
      effSum += eff;
      effN += 1;
      if (bestEff == null || eff < bestEff) bestEff = eff;
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

/**
 * Given a current window `[startDate, endDate]`, return the equivalent
 * prior window of the same length immediately before it. Both inputs and
 * outputs are `YYYY-MM-DD` strings. Returns `null` for malformed input.
 *
 * The arithmetic is purely string-day-based (no Date objects involved
 * for the window math) so the result is identical regardless of the
 * caller's browser timezone — important for the vehicle-history flow
 * where the day-keys originated in the *vehicle's* zone.
 */
export function priorPeriod(
  startDate: string | undefined,
  endDate: string | undefined,
): { start: string; end: string } | null {
  if (!startDate || !endDate) return null;
  const startMs = ymdToUtcMillis(startDate);
  const endMs = ymdToUtcMillis(endDate);
  if (startMs == null || endMs == null) return null;
  const lengthDays = Math.max(
    1,
    Math.round((endMs - startMs) / 86_400_000) + 1,
  );
  const priorEndMs = startMs - 86_400_000;
  const priorStartMs = priorEndMs - (lengthDays - 1) * 86_400_000;
  return {
    start: utcMillisToYmd(priorStartMs),
    end: utcMillisToYmd(priorEndMs),
  };
}

function ymdToUtcMillis(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
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

/* ------------------------------------------------------------------ */
/*  Collections (anomalies / notable / commutes)                      */
/* ------------------------------------------------------------------ */

/** Drives whose efficiency grade is D — the worst tier. */
export function detectAnomalies(drives: readonly Drive[]): Drive[] {
  return drives.filter(
    d => gradeFromEfficiency(getEfficiency(d)).label === 'D',
  );
}

/**
 * Drives in the top decile by distance OR with grade A+. Caps the
 * "top decile" pool at 50 entries so the panel doesn't get drowned on
 * very large datasets.
 */
export function detectNotable(drives: readonly Drive[]): Drive[] {
  if (drives.length === 0) return [];
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

/**
 * Normalise an address for grouping — lowercase, collapse whitespace, drop
 * trailing parentheses (e.g. ", USA"). Returns `null` for missing input
 * so callers can skip drives without a recorded address.
 */
function normaliseAddress(addr: string | null): string | null {
  if (!addr) return null;
  return addr.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Drives that belong to a recurring origin↔end pair. A pair (start, end)
 * counts as a "commute" once it appears at least `minOccurrences` times
 * in the input list (default 3). Returns every drive that participates in
 * any such pair, in original order.
 */
export function detectCommutes(
  drives: readonly Drive[],
  minOccurrences = 3,
): Drive[] {
  const counts = new Map<string, number>();
  for (const d of drives) {
    const a = normaliseAddress(d.startAddress);
    const b = normaliseAddress(d.endAddress);
    if (!a || !b) continue;
    // Pair key is direction-insensitive: a→b and b→a hash to the same bucket.
    const key = a < b ? `${a}::${b}` : `${b}::${a}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return drives.filter(d => {
    const a = normaliseAddress(d.startAddress);
    const b = normaliseAddress(d.endAddress);
    if (!a || !b) return false;
    const key = a < b ? `${a}::${b}` : `${b}::${a}`;
    return (counts.get(key) ?? 0) >= minOccurrences;
  });
}

/* ------------------------------------------------------------------ */
/*  Date grouping + daily trend                                       */
/* ------------------------------------------------------------------ */

export interface DateGroup<T> {
  /** Sortable key, `YYYY-MM-DD`. */
  dateKey: string;
  /** Items belonging to this date, in original order. */
  items: T[];
}

/**
 * Convert an ISO timestamp to a `YYYY-MM-DD` key in the requested
 * timezone (defaults to the browser's local zone). Returns `null` for
 * empty/invalid input. Use this as the key extractor for
 * {@link groupByDate} when grouping should follow a specific zone's
 * date boundaries — the typical UX for a vehicle-history page is to
 * pass the *vehicle's* IANA tz so a drive at 11pm vehicle-local
 * doesn't get grouped under the next UTC day.
 */
export function localDayKey(
  iso: string | null | undefined,
  tz?: string,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return ymdInTz(d, tz);
}

/**
 * Parse a `YYYY-MM-DD` key (such as one produced by {@link localDayKey})
 * into a `Date` anchored at UTC noon on that day — anchoring at noon
 * avoids the `new Date('2026-04-24')` UTC-midnight pitfall while making
 * the returned Date safe to format in any timezone (a 12-hour cushion
 * absorbs the ±14h IANA range without crossing day boundaries).
 *
 * Prefer {@link formatDayKey} when you only need a label — that helper
 * formats the key directly without round-tripping through `Date`,
 * which is the safest path for bug-prone UI labels.
 */
export function parseLocalDay(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return new Date(NaN);
  const [, ys, ms, ds] = m;
  return new Date(Date.UTC(Number(ys), Number(ms) - 1, Number(ds), 12));
}

/**
 * Bucket items by day key extracted from each item. Returns groups in
 * descending date order so the most recent day appears first.
 */
export function groupByDate<T>(
  items: readonly T[],
  getDateKey: (item: T) => string | null,
): DateGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = getDateKey(item);
    if (!key) continue;
    const day = key.split('T')[0];
    const list = buckets.get(day) ?? [];
    list.push(item);
    buckets.set(day, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([dateKey, list]) => ({ dateKey, items: list }));
}

export type TrendMetric =
  | 'drives'
  | 'distance'
  | 'score'
  | 'efficiency'
  | 'cost';

export interface TrendPoint {
  /** `YYYY-MM-DD` */
  date: string;
  value: number;
}

/**
 * Daily aggregation of a metric across the supplied drives. Distance is
 * returned in metres (callers convert), cost in kWh-equivalent units (the
 * caller applies the `costPerKwh` multiplier so the lib stays free of
 * settings dependencies).
 *
 * Days are bucketed using {@link localDayKey} — pass the active vehicle's
 * IANA `tz` so a drive at 23:30 vehicle-local doesn't slip into the next
 * UTC day on the chart (which produces "ghost bars" the user can't
 * reconcile against the visible row list).
 */
export function dailyTrend(
  drives: readonly Drive[],
  metric: TrendMetric,
  tz?: string,
): TrendPoint[] {
  const buckets = new Map<
    string,
    { sum: number; count: number; best: number | null }
  >();
  for (const d of drives) {
    const day = localDayKey(d.startTs, tz);
    if (!day) continue;
    const b = buckets.get(day) ?? { sum: 0, count: 0, best: null };

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

  const points: TrendPoint[] = Array.from(buckets.entries()).map(
    ([date, b]) => {
      let value = 0;
      if (metric === 'efficiency' || metric === 'score') {
        value = b.count > 0 ? b.sum / b.count : 0;
      } else {
        value = b.sum;
      }
      return { date, value };
    },
  );
  return points.sort((a, b) => (a.date < b.date ? -1 : 1));
}
