/**
 * Parking Dwell model — where the car sits between drives.
 *
 * Reconstructs parking stints from the gaps between consecutive drives:
 * a stint starts when drive N ends and ends when drive N+1 begins, located at
 * drive N's end address. The trailing stint (after the newest drive) runs to
 * `nowMs` and is flagged `ongoing`.
 *
 * Pure and clock-free: `nowMs` is always injected so the module stays
 * deterministic and unit-testable.
 */

import type { Drive } from '@/types/driving';

export interface ParkingStint {
  location: string | null;
  startMs: number;
  endMs: number;
  durationMs: number;
  ongoing: boolean;
}

export interface LocationDwell {
  location: string | null;
  totalMs: number;
  stints: number;
  /** Share of total parked time, 0–1. */
  share: number;
}

export interface ParkingSummary {
  stints: ParkingStint[];
  /** Descending by total dwell. */
  locations: LocationDwell[];
  totalParkedMs: number;
  totalDrivingMs: number;
  /** Parked ÷ (parked + driving), 0–1; null with no data. */
  parkedShare: number | null;
  /** Share of parked time overlapping 22:00–06:00 local, 0–1; null with no data. */
  nightShare: number | null;
  longestStint: ParkingStint | null;
}

function driveEndMs(d: Drive): number | null {
  if (d.endTs) {
    const t = new Date(d.endTs).getTime();
    if (Number.isFinite(t)) return t;
  }
  const start = new Date(d.startTs).getTime();
  if (!Number.isFinite(start)) return null;
  return Number.isFinite(d.durationS) && d.durationS > 0 ? start + d.durationS * 1000 : start;
}

/** Milliseconds of `[startMs, endMs)` falling inside local 22:00–06:00. */
export function nightOverlapMs(startMs: number, endMs: number): number {
  if (!(endMs > startMs)) return 0;
  let night = 0;
  // Walk night windows day by day. Each iteration advances ≥ 1 day, and the
  // cap (100 years of days) is a defensive backstop against corrupt input.
  const dayStart = new Date(startMs);
  dayStart.setHours(0, 0, 0, 0);
  let cursor = dayStart.getTime();
  for (let i = 0; i < 36_600 && cursor < endMs; i++) {
    const d = new Date(cursor);
    // Window A: 00:00–06:00 of this day; Window B: 22:00–24:00 of this day.
    const morningEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 6).getTime();
    const eveningStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 22).getTime();
    const nextDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    night += Math.max(0, Math.min(endMs, morningEnd) - Math.max(startMs, cursor));
    night += Math.max(0, Math.min(endMs, nextDay) - Math.max(startMs, eveningStart));
    cursor = nextDay;
  }
  return night;
}

export function summarizeParking(drives: readonly Drive[], nowMs: number): ParkingSummary {
  const sorted = [...drives]
    .filter((d) => d.startTs && Number.isFinite(new Date(d.startTs).getTime()))
    .sort((a, b) => new Date(a.startTs).getTime() - new Date(b.startTs).getTime());

  const stints: ParkingStint[] = [];
  let totalDrivingMs = 0;

  for (let i = 0; i < sorted.length; i++) {
    const drive = sorted[i]!;
    const endMs = driveEndMs(drive);
    if (endMs == null) continue;
    const startMs = new Date(drive.startTs).getTime();
    totalDrivingMs += Math.max(0, endMs - startMs);

    const next = sorted[i + 1];
    const stintEnd = next ? new Date(next.startTs).getTime() : nowMs;
    const durationMs = stintEnd - endMs;
    // Overlapping/duplicate drive records produce negative gaps — drop them
    // rather than let one bad import corrupt every share downstream.
    if (durationMs <= 0) continue;
    stints.push({
      location: drive.endAddress?.trim() || null,
      startMs: endMs,
      endMs: stintEnd,
      durationMs,
      ongoing: next == null,
    });
  }

  const byLocation = new Map<string | null, { totalMs: number; stints: number }>();
  let totalParkedMs = 0;
  let nightMs = 0;
  let longestStint: ParkingStint | null = null;
  for (const s of stints) {
    totalParkedMs += s.durationMs;
    nightMs += nightOverlapMs(s.startMs, s.endMs);
    if (longestStint == null || s.durationMs > longestStint.durationMs) longestStint = s;
    const agg = byLocation.get(s.location) ?? { totalMs: 0, stints: 0 };
    agg.totalMs += s.durationMs;
    agg.stints += 1;
    byLocation.set(s.location, agg);
  }

  const locations: LocationDwell[] = Array.from(byLocation.entries())
    .map(([location, agg]) => ({
      location,
      totalMs: agg.totalMs,
      stints: agg.stints,
      share: totalParkedMs > 0 ? agg.totalMs / totalParkedMs : 0,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  const totalTracked = totalParkedMs + totalDrivingMs;
  return {
    stints,
    locations,
    totalParkedMs,
    totalDrivingMs,
    parkedShare: totalTracked > 0 ? totalParkedMs / totalTracked : null,
    nightShare: totalParkedMs > 0 ? nightMs / totalParkedMs : null,
    longestStint,
  };
}
