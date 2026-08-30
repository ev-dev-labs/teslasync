/**
 * Pure aggregation helpers for the Drives feature.
 *
 * Every function in this module is deterministic and side-effect free so it
 * can be unit-tested in isolation and reused by widgets/pages without
 * pulling in React. Domain logic that needs to be visible across the
 * driving feature lives here; presentational components stay free of
 * arithmetic.
 */
import type { Drive } from '@/types/driving';
import { ymdInTz } from './dateFormat';

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
const GRADE_PALETTE: Record<GradeLabel, { color: string; numeric: number | null }> = {
  'A+': { color: '#10b981', numeric: 4.5 },
  A:    { color: '#10b981', numeric: 4.0 },
  B:    { color: '#00f0ff', numeric: 3.0 },
  C:    { color: '#f59e0b', numeric: 2.0 },
  D:    { color: '#ef4444', numeric: 1.0 },
  '—':  { color: '#6b7280', numeric: null },
};

export const MIN_EFFICIENCY_DISTANCE_M = 1_000;

/**
 * Calculate measured energy intensity in Wh/km from canonical SI values.
 * Very short drives are excluded because rounding and standby loads make the
 * result too noisy for meaningful comparison.
 */
export function getEnergyIntensityWhPerKm(
  distanceM: number | null | undefined,
  energyUsedWh: number | null | undefined,
): number | null {
  if (
    distanceM == null
    || !Number.isFinite(distanceM)
    || distanceM < MIN_EFFICIENCY_DISTANCE_M
    || energyUsedWh == null
    || !Number.isFinite(energyUsedWh)
    || energyUsedWh <= 0
  ) {
    return null;
  }

  return energyUsedWh / (distanceM / 1_000);
}

/** Return a drive's measured energy intensity in Wh/km. */
export function getEfficiency(drive: Drive): number | null {
  return getEnergyIntensityWhPerKm(drive.distanceM, drive.energyUsedWh);
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

/** Distance-weighted grade across drives with measured energy. */
export function avgGrade(drives: readonly Drive[]): Grade {
  let energyWh = 0;
  let distanceM = 0;
  for (const d of drives) {
    if (getEfficiency(d) != null) {
      energyWh += d.energyUsedWh ?? 0;
      distanceM += d.distanceM;
    }
  }
  return gradeFromEfficiency(getEnergyIntensityWhPerKm(distanceM, energyWh));
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
  /** Total measured energy used in canonical watt-hours. */
  totalEnergyWh: number;
  /** Drives with measured positive energy, including short drives. */
  energyMeasuredCount: number;
  /** Drives eligible for measured energy-intensity comparison. */
  efficiencyMeasuredCount: number;
}

/**
 * Date filter applied to a drive's `startTs`. The drive's day is
 * computed via {@link localDayKey} so that the filter follows the
 * requested timezone — pass the vehicle's IANA tz to match what the
 * user sees in the row's date header. Both bounds are inclusive.
 */
function inDateRange(d: Drive, startDate?: string, endDate?: string, tz?: string): boolean {
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
  let efficiencyEnergyWh = 0;
  let efficiencyDistanceM = 0;
  let efficiencyMeasuredCount = 0;
  let bestEff: number | null = null;
  let totalEnergyWh = 0;
  let energyMeasuredCount = 0;

  for (const d of drives) {
    if (!inDateRange(d, startDate, endDate, tz)) continue;
    count += 1;
    totalDistanceM += d.distanceM;
    totalDurationS += d.durationS;
    if ((d.maxSpeedMps ?? 0) > topSpeedMps) topSpeedMps = d.maxSpeedMps ?? 0;
    if (longest == null || d.distanceM > longest.distanceM) longest = d;

    const eff = getEfficiency(d);
    if (eff != null) {
      efficiencyEnergyWh += d.energyUsedWh ?? 0;
      efficiencyDistanceM += d.distanceM;
      efficiencyMeasuredCount += 1;
      if (bestEff == null || eff < bestEff) bestEff = eff;
    }

    if (
      d.energyUsedWh != null
      && Number.isFinite(d.energyUsedWh)
      && d.energyUsedWh > 0
    ) {
      totalEnergyWh += d.energyUsedWh;
      energyMeasuredCount += 1;
    }
  }

  const avgEfficiencyWhKm = efficiencyMeasuredCount > 0 && efficiencyDistanceM > 0
    ? efficiencyEnergyWh / (efficiencyDistanceM / 1_000)
    : null;

  return {
    count,
    totalDistanceM,
    totalDurationS,
    topSpeedMps,
    longest,
    avgEfficiencyWhKm,
    bestEfficiencyWhKm: bestEff,
    avgGradeNumeric: avgEfficiencyWhKm != null
      ? gradeFromEfficiency(avgEfficiencyWhKm).numeric
      : null,
    totalEnergyWh,
    energyMeasuredCount,
    efficiencyMeasuredCount,
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
  const lengthDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
  const priorEndMs = startMs - 86_400_000;
  const priorStartMs = priorEndMs - (lengthDays - 1) * 86_400_000;
  return {
    start: utcMillisToYmd(priorStartMs),
    end: utcMillisToYmd(priorEndMs),
  };
}

/**
 * Shift a `YYYY-MM-DD` day key by `days` (negative shifts backwards).
 * Returns `null` for malformed input.
 *
 * Used to pad a server-side fetch window. The API filters `started_at` in
 * UTC while this page buckets drives by the *vehicle's* local day, so an
 * unpadded window can omit rows that the vehicle-tz filter would keep. One
 * day of padding covers the whole ±14h range of real world offsets.
 */
export function shiftDayKey(key: string | undefined, days: number): string | null {
  if (!key) return null;
  const ms = ymdToUtcMillis(key);
  if (ms == null) return null;
  return utcMillisToYmd(ms + days * 86_400_000);
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
  return drives.filter((d) => gradeFromEfficiency(getEfficiency(d)).label === 'D');
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
  const longTrips = new Set(sorted.slice(0, cutoffIdx).map((d) => d.id));
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
export function detectCommutes(drives: readonly Drive[], minOccurrences = 3): Drive[] {
  const counts = new Map<string, number>();
  for (const d of drives) {
    const a = normaliseAddress(d.startAddress);
    const b = normaliseAddress(d.endAddress);
    if (!a || !b) continue;
    // Pair key is direction-insensitive: a→b and b→a hash to the same bucket.
    const key = a < b ? `${a}::${b}` : `${b}::${a}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return drives.filter((d) => {
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
export function localDayKey(iso: string | null | undefined, tz?: string): string | null {
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

export type TrendMetric = 'drives' | 'distance' | 'score' | 'efficiency' | 'cost';

export interface TrendPoint {
  /** `YYYY-MM-DD` */
  date: string;
  value: number;
}

/**
 * Daily aggregation of a metric across the supplied drives. Distance is
 * returned in metres (callers convert), cost in canonical watt-hours (the
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
  const buckets = new Map<string, { sum: number; count: number; distanceM: number }>();
  for (const d of drives) {
    const day = localDayKey(d.startTs, tz);
    if (!day) continue;
    const b = buckets.get(day) ?? { sum: 0, count: 0, distanceM: 0 };

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
          b.sum += d.energyUsedWh ?? 0;
          b.distanceM += d.distanceM;
          b.count += 1;
        }
        break;
      }
      case 'score': {
        const eff = getEfficiency(d);
        if (eff != null) {
          b.sum += d.energyUsedWh ?? 0;
          b.distanceM += d.distanceM;
          b.count += 1;
        }
        break;
      }
      case 'cost':
        if (
          d.energyUsedWh != null
          && Number.isFinite(d.energyUsedWh)
          && d.energyUsedWh > 0
        ) {
          b.sum += d.energyUsedWh;
          b.count += 1;
        }
        break;
    }
    buckets.set(day, b);
  }

  const points: TrendPoint[] = Array.from(buckets.entries()).flatMap(([date, b]) => {
    if (
      (metric === 'efficiency' || metric === 'score' || metric === 'cost')
      && b.count === 0
    ) {
      return [];
    }

    let value = b.sum;
    if (metric === 'efficiency' || metric === 'score') {
      const efficiency = b.distanceM > 0
        ? b.sum / (b.distanceM / 1_000)
        : null;
      value = metric === 'score'
        ? gradeFromEfficiency(efficiency).numeric ?? 0
        : efficiency ?? 0;
    }
    return [{ date, value }];
  });
  return points.sort((a, b) => (a.date < b.date ? -1 : 1));
}
