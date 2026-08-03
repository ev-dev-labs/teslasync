/**
 * Drive Calendar model — a GitHub-style year of daily driving.
 *
 * Buckets drive distance into local calendar days, exposes a week-aligned
 * grid for the trailing 52 weeks plus daily-drive streaks. Pure and
 * clock-free (`nowMs` injected).
 */

import type { Drive } from '@/types/driving';

export interface CalendarDay {
  /** `yyyy-mm-dd` local. */
  date: string;
  /** JS day-of-week, 0 = Sunday. */
  day: number;
  distanceM: number;
  drives: number;
  /** 0–4 intensity level against the year's p95 distance day. */
  level: number;
}

export interface DriveCalendar {
  /** Ascending days covering the trailing 52 full weeks up to today. */
  days: CalendarDay[];
  totalDistanceM: number;
  totalDrives: number;
  activeDays: number;
  /** Consecutive days with driving, ending today or yesterday. */
  currentStreak: number;
  longestStreak: number;
  /** Busiest day of the window, or null. */
  busiestDay: CalendarDay | null;
}

const DAY_MS = 86_400_000;

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** p95 by nearest-rank over the positive daily distances. */
function p95(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
}

export function buildDriveCalendar(drives: readonly Drive[], nowMs: number): DriveCalendar {
  const byDay = new Map<string, { distanceM: number; drives: number }>();
  for (const d of drives) {
    if (!d.startTs) continue;
    const dt = new Date(d.startTs);
    if (!Number.isFinite(dt.getTime())) continue;
    const key = localKey(dt);
    const agg = byDay.get(key) ?? { distanceM: 0, drives: 0 };
    agg.distanceM += Number.isFinite(d.distanceM) ? Math.max(0, d.distanceM) : 0;
    agg.drives += 1;
    byDay.set(key, agg);
  }

  // Window: 52 weeks back, aligned so the grid starts on a Sunday.
  const today = new Date(nowMs);
  today.setHours(12, 0, 0, 0);
  const start = new Date(today.getTime() - 52 * 7 * DAY_MS);
  start.setDate(start.getDate() - start.getDay()); // back to Sunday

  const positives: number[] = [];
  for (const { distanceM } of byDay.values()) if (distanceM > 0) positives.push(distanceM);
  const cap = p95(positives);

  const days: CalendarDay[] = [];
  let totalDistanceM = 0;
  let totalDrives = 0;
  let activeDays = 0;
  let busiestDay: CalendarDay | null = null;

  for (let t = start.getTime(); t <= today.getTime(); t += DAY_MS) {
    const date = new Date(t);
    const key = localKey(date);
    const agg = byDay.get(key);
    const distanceM = agg?.distanceM ?? 0;
    const count = agg?.drives ?? 0;
    // Level 0 = idle; 1–4 scale against the p95 cap so one epic road-trip
    // day doesn't wash every normal day down to level 1.
    const level =
      count === 0 ? 0 : cap > 0 ? Math.min(4, 1 + Math.floor((Math.min(distanceM, cap) / cap) * 3)) : 1;
    const cell: CalendarDay = { date: key, day: date.getDay(), distanceM, drives: count, level };
    days.push(cell);
    totalDistanceM += distanceM;
    totalDrives += count;
    if (count > 0) activeDays += 1;
    if (count > 0 && (busiestDay == null || distanceM > busiestDay.distanceM)) busiestDay = cell;
  }

  // Streaks over the windowed days (ascending). The current streak may end
  // today OR yesterday — an empty "today" shouldn't zero it before the
  // evening commute happens.
  let longestStreak = 0;
  let run = 0;
  for (const d of days) {
    if (d.drives > 0) {
      run += 1;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }
  let currentStreak = 0;
  let idx = days.length - 1;
  if (idx >= 0 && days[idx]!.drives === 0) idx -= 1; // forgive an empty today
  for (; idx >= 0 && days[idx]!.drives > 0; idx--) currentStreak += 1;

  return { days, totalDistanceM, totalDrives, activeDays, currentStreak, longestStreak, busiestDay };
}
