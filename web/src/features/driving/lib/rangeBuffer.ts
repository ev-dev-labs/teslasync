/**
 * Range Buffer model — how much battery is left when you arrive.
 *
 * Pure analysis over `Drive.endBatteryPct`: arrival-SoC histogram, close
 * calls, a monthly median trend, and a 0–100 "comfort score" describing how
 * far the driver stays from the bottom of the pack. No fetching, no React —
 * the page owns data and display.
 */

import type { Drive } from '@/types/driving';

export const LOW_ARRIVAL_PCT = 20;
export const CRITICAL_ARRIVAL_PCT = 10;

export interface ArrivalBucket {
  /** Inclusive lower bound of the bucket, e.g. 20 for 20–30%. */
  fromPct: number;
  /** Exclusive upper bound (100 for the top bucket, inclusive). */
  toPct: number;
  count: number;
}

export interface CloseCall {
  driveId: number;
  startTs: string;
  arrivalPct: number;
  distanceM: number;
}

// Type alias (not interface) so it carries an implicit index signature and
// stays assignable to ChartContainer's `ChartDataRow` fallback-table shape.
export type MonthlyMedian = {
  /** `yyyy-mm`. */
  month: string;
  medianPct: number;
};

export interface RangeBufferSummary {
  /** Drives with a finite arrival SoC — the denominator for every stat. */
  analyzed: number;
  medianArrivalPct: number | null;
  lowestArrivalPct: number | null;
  lowCount: number;
  criticalCount: number;
  /** 0–100; null until at least 5 drives are analyzable. */
  comfortScore: number | null;
  /** Ten fixed-width 10% buckets, 0–10 … 90–100. */
  buckets: ArrivalBucket[];
  /** Most recent 12 months with data, ascending. */
  monthlyMedian: MonthlyMedian[];
  /** The 5 lowest arrivals, ascending by arrival SoC. */
  closeCalls: CloseCall[];
}

function median(sortedAsc: readonly number[]): number {
  const n = sortedAsc.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedAsc[mid]! : (sortedAsc[mid - 1]! + sortedAsc[mid]!) / 2;
}

function arrivalOf(d: Drive): number | null {
  const v = d.endBatteryPct;
  return v != null && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

/**
 * Comfort score: the median arrival SoC, discounted by how often arrivals dip
 * into the low (<20%) and critical (<10%) zones. A driver who reliably lands
 * at 40% with no scares scores 40; frequent single-digit arrivals drag the
 * score toward 0 even when the median looks healthy. Clamped to 0–100 and
 * withheld (`null`) below 5 analyzable drives — too little data to grade.
 */
export function comfortScore(arrivals: readonly number[]): number | null {
  if (arrivals.length < 5) return null;
  const sorted = [...arrivals].sort((a, b) => a - b);
  const med = median(sorted);
  const lowShare = arrivals.filter((a) => a < LOW_ARRIVAL_PCT).length / arrivals.length;
  const criticalShare = arrivals.filter((a) => a < CRITICAL_ARRIVAL_PCT).length / arrivals.length;
  const score = med - 25 * lowShare - 50 * criticalShare;
  return Math.round(Math.min(100, Math.max(0, score)));
}

export function summarizeRangeBuffer(drives: readonly Drive[]): RangeBufferSummary {
  const withArrival = drives
    .map((d) => ({ drive: d, arrival: arrivalOf(d) }))
    .filter((x): x is { drive: Drive; arrival: number } => x.arrival != null);

  const arrivals = withArrival.map((x) => x.arrival);
  const sorted = [...arrivals].sort((a, b) => a - b);

  const buckets: ArrivalBucket[] = Array.from({ length: 10 }, (_, i) => ({
    fromPct: i * 10,
    toPct: (i + 1) * 10,
    count: 0,
  }));
  for (const a of arrivals) {
    // 100% belongs in the top bucket, not an eleventh one.
    const idx = Math.min(9, Math.floor(a / 10));
    buckets[idx]!.count += 1;
  }

  const byMonth = new Map<string, number[]>();
  for (const { drive, arrival } of withArrival) {
    const month = drive.startTs?.substring(0, 7);
    if (!month) continue;
    const list = byMonth.get(month) ?? [];
    list.push(arrival);
    byMonth.set(month, list);
  }
  const monthlyMedian: MonthlyMedian[] = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, list]) => ({
      month,
      medianPct: Math.round(median([...list].sort((a, b) => a - b)) * 10) / 10,
    }));

  const closeCalls: CloseCall[] = [...withArrival]
    .sort((a, b) => a.arrival - b.arrival)
    .slice(0, 5)
    .map(({ drive, arrival }) => ({
      driveId: drive.id,
      startTs: drive.startTs,
      arrivalPct: arrival,
      distanceM: drive.distanceM,
    }));

  return {
    analyzed: arrivals.length,
    medianArrivalPct: sorted.length ? Math.round(median(sorted) * 10) / 10 : null,
    lowestArrivalPct: sorted.length ? sorted[0]! : null,
    lowCount: arrivals.filter((a) => a < LOW_ARRIVAL_PCT).length,
    criticalCount: arrivals.filter((a) => a < CRITICAL_ARRIVAL_PCT).length,
    comfortScore: comfortScore(arrivals),
    buckets,
    monthlyMedian,
    closeCalls,
  };
}
