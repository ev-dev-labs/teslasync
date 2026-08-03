/**
 * Efficiency Target model — a self-set consumption goal with weekly grading.
 *
 * The user picks a Wh/km target; drives are bucketed into ISO-adjacent weeks
 * (local Monday start) and each week's distance-weighted consumption is graded
 * against the target. Streaks count consecutive hit weeks. Pure & clock-free.
 */

import type { Drive } from '@/types/driving';

export interface WeekResult {
  /** `yyyy-mm-dd` of the week's local Monday. */
  weekStart: string;
  whPerKm: number;
  distanceM: number;
  drives: number;
  hit: boolean;
}

export interface TargetSummary {
  weeks: WeekResult[];
  /** Consecutive hit weeks ending with the most recent COMPLETE week. */
  currentStreak: number;
  longestStreak: number;
  hitRate: number | null;
  /** Distance-weighted consumption across all analyzed drives. */
  overallWhPerKm: number | null;
  analyzed: number;
}

/** Drives too short to grade fairly are excluded (parking-lot noise). */
function analyzable(d: Drive): boolean {
  return (
    d.energyUsedWh != null && Number.isFinite(d.energyUsedWh) && d.energyUsedWh > 0 &&
    Number.isFinite(d.distanceM) && d.distanceM >= 1000
  );
}

/** Local Monday 00:00 for the week containing `ms`, as `yyyy-mm-dd`. */
export function weekStartOf(ms: number): string {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  const shift = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - shift);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function summarizeTarget(
  drives: readonly Drive[],
  targetWhPerKm: number,
  maxWeeks = 26,
): TargetSummary {
  const usable = drives.filter(analyzable);

  const byWeek = new Map<string, { energyWh: number; distanceM: number; drives: number }>();
  let totalEnergy = 0;
  let totalDistance = 0;
  for (const d of usable) {
    const ms = new Date(d.startTs).getTime();
    if (!Number.isFinite(ms)) continue;
    const week = weekStartOf(ms);
    const agg = byWeek.get(week) ?? { energyWh: 0, distanceM: 0, drives: 0 };
    agg.energyWh += d.energyUsedWh!;
    agg.distanceM += d.distanceM;
    agg.drives += 1;
    byWeek.set(week, agg);
    totalEnergy += d.energyUsedWh!;
    totalDistance += d.distanceM;
  }

  const validTarget = Number.isFinite(targetWhPerKm) && targetWhPerKm > 0;
  const weeks: WeekResult[] = Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-maxWeeks)
    .map(([weekStart, agg]) => {
      const whPerKm = Math.round((agg.energyWh / (agg.distanceM / 1000)) * 10) / 10;
      return {
        weekStart,
        whPerKm,
        distanceM: agg.distanceM,
        drives: agg.drives,
        hit: validTarget && whPerKm <= targetWhPerKm,
      };
    });

  let longestStreak = 0;
  let run = 0;
  for (const w of weeks) {
    run = w.hit ? run + 1 : 0;
    if (run > longestStreak) longestStreak = run;
  }
  let currentStreak = 0;
  for (let i = weeks.length - 1; i >= 0 && weeks[i]!.hit; i--) currentStreak += 1;

  return {
    weeks,
    currentStreak,
    longestStreak,
    hitRate: weeks.length ? weeks.filter((w) => w.hit).length / weeks.length : null,
    overallWhPerKm:
      totalDistance >= 1000 ? Math.round((totalEnergy / (totalDistance / 1000)) * 10) / 10 : null,
    analyzed: usable.length,
  };
}
