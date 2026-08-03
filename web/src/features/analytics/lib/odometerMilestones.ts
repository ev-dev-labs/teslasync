/**
 * Odometer Milestones model — round-number birthdays for the odometer.
 *
 * TeslaSync drives carry per-drive distance, not absolute odometer, so the
 * model works on `baseOdometerKm + cumulative drive distance`: the user
 * calibrates the base once (current odometer minus logged distance is
 * derived for them on the page). Passed milestones get the date they were
 * crossed; upcoming ones get an ETA from the trailing 90-day pace.
 * Pure and clock-free.
 */

import type { Drive } from '@/types/driving';

export interface PassedMilestone {
  km: number;
  /** `yyyy-mm-dd` local date of the drive that crossed it. */
  date: string;
}

export interface UpcomingMilestone {
  km: number;
  /** Estimated ms timestamp, or null when pace is unknown. */
  etaMs: number | null;
  remainingKm: number;
}

export interface MilestoneSummary {
  currentKm: number;
  /** Trailing-90-day average, km/day; null without enough history. */
  paceKmPerDay: number | null;
  passed: PassedMilestone[];
  upcoming: UpcomingMilestone[];
}

const DAY_MS = 86_400_000;

/** Milestone ladder: every 10k to 100k, then every 50k. */
export function milestoneLadder(maxKm: number): number[] {
  const out: number[] = [];
  for (let km = 10_000; km <= 100_000; km += 10_000) out.push(km);
  for (let km = 150_000; km <= Math.max(maxKm + 100_000, 200_000); km += 50_000) out.push(km);
  return out;
}

export function computeMilestones(
  drives: readonly Drive[],
  baseOdometerKm: number,
  nowMs: number,
): MilestoneSummary {
  const sorted = [...drives]
    .filter((d) => d.startTs && Number.isFinite(new Date(d.startTs).getTime()))
    .sort((a, b) => a.startTs.localeCompare(b.startTs));

  const base = Number.isFinite(baseOdometerKm) && baseOdometerKm >= 0 ? baseOdometerKm : 0;

  // Walk the cumulative odometer and note each ladder crossing.
  let cumKm = base;
  const passed: PassedMilestone[] = [];
  const ladder = milestoneLadder(base + sorted.reduce((s, d) => s + Math.max(0, d.distanceM) / 1000, 0));
  let nextIdx = ladder.findIndex((km) => km > base);
  if (nextIdx === -1) nextIdx = ladder.length;

  for (const d of sorted) {
    const dist = Number.isFinite(d.distanceM) ? Math.max(0, d.distanceM) / 1000 : 0;
    cumKm += dist;
    while (nextIdx < ladder.length && cumKm >= ladder[nextIdx]!) {
      passed.push({ km: ladder[nextIdx]!, date: d.startTs.substring(0, 10) });
      nextIdx += 1;
    }
  }

  // Pace: distance driven in the trailing 90 days.
  const cutoff = nowMs - 90 * DAY_MS;
  let trailingKm = 0;
  for (const d of sorted) {
    if (new Date(d.startTs).getTime() >= cutoff) trailingKm += Math.max(0, d.distanceM) / 1000;
  }
  const paceKmPerDay = sorted.length >= 5 && trailingKm > 0 ? trailingKm / 90 : null;

  const upcoming: UpcomingMilestone[] = ladder.slice(nextIdx, nextIdx + 3).map((km) => {
    const remainingKm = Math.max(0, km - cumKm);
    return {
      km,
      remainingKm: Math.round(remainingKm * 10) / 10,
      etaMs: paceKmPerDay != null ? nowMs + (remainingKm / paceKmPerDay) * DAY_MS : null,
    };
  });

  return {
    currentKm: Math.round(cumKm * 10) / 10,
    paceKmPerDay: paceKmPerDay != null ? Math.round(paceKmPerDay * 10) / 10 : null,
    passed,
    upcoming,
  };
}
