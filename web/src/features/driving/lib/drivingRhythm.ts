/**
 * Driving Rhythm model — when the car actually gets driven.
 *
 * Builds a weekday × hour punchcard from drive start times (interpreted in
 * the viewer's local timezone, matching every other local-time display in the
 * app), plus departure-time medians and a 0–100 predictability score derived
 * from the entropy of the start-hour distribution. Pure and React-free.
 */

import type { Drive } from '@/types/driving';

/** counts[day][hour] with JS `Date#getDay()` indexing (0 = Sunday). */
export type RhythmMatrix = number[][];

export interface RhythmSlot {
  /** JS day-of-week, 0 = Sunday. */
  day: number;
  hour: number;
  count: number;
}

export interface DrivingRhythm {
  matrix: RhythmMatrix;
  total: number;
  /** Highest cell count — the punchcard's color-scale ceiling. */
  maxCount: number;
  /** Busiest slot, or null with no drives. Ties resolve to the earliest slot. */
  favorite: RhythmSlot | null;
  weekdayCount: number;
  weekendCount: number;
  /**
   * 0–100: how concentrated the start hours are. 100 = every drive leaves at
   * the same hour (perfectly predictable), 0 = starts spread uniformly across
   * all 24 hours. Null below 5 drives. Computed as `1 − H/H_max` where `H` is
   * the Shannon entropy of the hour-of-day distribution and `H_max = ln 24`.
   */
  predictability: number | null;
  /**
   * Median departure hour per JS day (fractional hours, e.g. 8.25 = 08:15),
   * or null for days without drives.
   */
  medianDepartureByDay: (number | null)[];
}

function emptyMatrix(): RhythmMatrix {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

function median(sortedAsc: readonly number[]): number {
  const n = sortedAsc.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedAsc[mid]! : (sortedAsc[mid - 1]! + sortedAsc[mid]!) / 2;
}

export function buildDrivingRhythm(drives: readonly Drive[]): DrivingRhythm {
  const matrix = emptyMatrix();
  const hourTotals = Array.from({ length: 24 }, () => 0);
  const departuresByDay: number[][] = Array.from({ length: 7 }, () => []);
  let total = 0;

  for (const d of drives) {
    if (!d.startTs) continue;
    const dt = new Date(d.startTs);
    const ms = dt.getTime();
    if (!Number.isFinite(ms)) continue;
    const day = dt.getDay();
    const hour = dt.getHours();
    matrix[day]![hour]! += 1;
    hourTotals[hour]! += 1;
    departuresByDay[day]!.push(hour + dt.getMinutes() / 60);
    total += 1;
  }

  let favorite: RhythmSlot | null = null;
  let maxCount = 0;
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const count = matrix[day]![hour]!;
      if (count > maxCount) {
        maxCount = count;
        favorite = { day, hour, count };
      }
    }
  }

  const weekendCount = matrix[0]!.reduce((a, b) => a + b, 0) + matrix[6]!.reduce((a, b) => a + b, 0);

  let predictability: number | null = null;
  if (total >= 5) {
    let entropy = 0;
    for (const n of hourTotals) {
      if (n === 0) continue;
      const p = n / total;
      entropy -= p * Math.log(p);
    }
    // Clamp: floating-point entropy can exceed ln 24 by an ulp on a perfectly
    // uniform spread, which would round to -0 (and `Object.is(-0, 0)` is
    // false — surprising to every consumer and test).
    predictability = Math.min(100, Math.max(0, Math.round((1 - entropy / Math.log(24)) * 100)));
  }

  const medianDepartureByDay = departuresByDay.map((list) =>
    list.length ? median([...list].sort((a, b) => a - b)) : null,
  );

  return {
    matrix,
    total,
    maxCount,
    favorite,
    weekdayCount: total - weekendCount,
    weekendCount,
    predictability,
    medianDepartureByDay,
  };
}

/** Format a fractional hour (8.25) as a wall-clock label ("08:15"). */
export function formatFractionalHour(h: number): string {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  // 7.999 rounds to minute 60 — carry into the next hour instead of "07:60".
  const carried = minutes === 60;
  const hh = String((carried ? hours + 1 : hours) % 24).padStart(2, '0');
  const mm = String(carried ? 0 : minutes).padStart(2, '0');
  return `${hh}:${mm}`;
}
