import { fmtNumber } from '@/lib/numberFormat';
import { CITY_PAIRS } from './constants';

/**
 * Monday–Sunday range (local time) for the ISO week `offset` weeks from today:
 * 0 = current week, -1 = previous, +1 = next. Returns `[start, end]` where
 * `start` is Monday 00:00:00.000 and `end` is Sunday 23:59:59.999.
 *
 * Sunday is the *last* day of the week, not the first — so on a Sunday `offset`
 * 0 still resolves to the week that contains today instead of rolling forward
 * into next week (which would hide today's drives/charging from the digest).
 */
export function getWeekRange(offset: number): [Date, Date] {
  const now = new Date();
  const start = new Date(now);
  const dow = now.getDay(); // 0 = Sunday … 6 = Saturday
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  start.setDate(now.getDate() - daysSinceMonday + offset * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return [start, end];
}

/**
 * True when `dateStr` parses to an instant within `[start, end]` (inclusive).
 * An unparseable timestamp is treated as out of range rather than leaning on
 * the `NaN` comparison always being false.
 */
export function isInRange(dateStr: string, start: Date, end: Date): boolean {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  return d >= start && d <= end;
}

/**
 * Zero-based weekday index with Monday first: Mon=0 … Sun=6. Returns -1 for an
 * unparseable date so callers can skip it instead of indexing a bins array with
 * `NaN` (which yields `undefined` and throws on the subsequent property access).
 */
export function dayOfWeekIndex(dateStr: string): number {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return -1;
  const day = d.getDay();
  return day === 0 ? 6 : day - 1; // Mon=0 ... Sun=6
}

/**
 * Percentage change from `previous` to `current`. When `previous` is 0 there is
 * nothing to divide by, so report +100% if we grew from nothing and 0% otherwise.
 */
export function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Direction + formatted magnitude for a week-over-week delta. Differences below
 * 0.01 read as flat. `invertPositive` flips the good/bad polarity for metrics
 * where lower is better (energy used, cost, efficiency Wh/km).
 */
export function trendFor(
  current: number,
  previous: number,
  invertPositive = false,
): { direction: 'up' | 'down' | 'flat'; value: string; positive: boolean } {
  const diff = current - previous;
  const pct = pctChange(current, previous);
  if (Math.abs(diff) < 0.01) {
    return { direction: 'flat', value: '0%', positive: true };
  }
  const isUp = diff > 0;
  return {
    direction: isUp ? 'up' : 'down',
    value: `${isUp ? '+' : ''}${fmtNumber(pct, 1)}%`,
    positive: invertPositive ? !isUp : isUp,
  };
}

/**
 * Nearest well-known city pair (by great-circle km) to `distanceKm`, powering
 * the relatable "you drove NY→Boston 1.4×" fun fact. Returns `undefined` when
 * `distanceKm` is non-finite (e.g. NaN) so callers render nothing.
 */
export function findCityPair(distanceKm: number): (typeof CITY_PAIRS)[number] | undefined {
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
