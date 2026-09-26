/**
 * Drive Calendar model — a year of daily driving.
 *
 * Buckets drive distance into local calendar days for the shared workspace
 * range. Pure and clock-free (`nowMs` injected).
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

export interface CalendarWeek {
  days: CalendarDay[];
  /** `yyyy-mm` label to place above this week, or null between month boundaries. */
  monthKey: string | null;
}

export interface CalendarMonth {
  /** `yyyy-mm` local. */
  month: string;
  distanceM: number;
  drives: number;
  activeDays: number;
  totalDays: number;
}

export interface CalendarWeekday {
  /** JS day-of-week, 0 = Sunday. */
  day: number;
  distanceM: number;
  drives: number;
  activeDays: number;
  totalDays: number;
}

export interface DriveCalendar {
  /** Ascending days covering the selected window up to today when current. */
  days: CalendarDay[];
  /** The same days grouped into Sunday-first grid columns. */
  weeks: CalendarWeek[];
  /** Ascending calendar-month totals, including quiet months in the window. */
  months: CalendarMonth[];
  /** Sunday-first totals across the observed window. */
  weekdays: CalendarWeekday[];
  totalDistanceM: number;
  totalDrives: number;
  activeDays: number;
  /** Consecutive days with driving, ending today or yesterday. */
  currentStreak: number;
  longestStreak: number;
  /** Busiest day of the window, or null. */
  busiestDay: CalendarDay | null;
  /** Up to five highest-distance active days, descending. */
  topDays: CalendarDay[];
  /** Weekday with the most drives (distance breaks ties), or null. */
  favoriteWeekday: CalendarWeekday | null;
  /** Highest-distance calendar month, or null. */
  busiestMonth: CalendarMonth | null;
  /** Share of observed calendar days with at least one drive, 0–1. */
  activityRate: number;
  averageDistancePerActiveDayM: number | null;
  averageDrivesPerActiveDay: number | null;
  /** Share of distance driven on Saturday/Sunday, 0–1, or null without distance. */
  weekendDistanceShare: number | null;
}

export interface DriveCalendarWindow {
  start: string;
  end: string;
}

export function driveCalendarBounds(nowMs: number, range: DriveCalendarWindow): { start: Date; endExclusive: Date } {
  const start = new Date(`${range.start}T00:00:00`);
  const requestedEnd = new Date(`${range.end}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(requestedEnd.getTime()) || start > requestedEnd) {
    throw new Error('Drive calendar requires a valid date range');
  }
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const endExclusive = new Date(today);
  endExclusive.setDate(endExclusive.getDate() + 1);
  requestedEnd.setDate(requestedEnd.getDate() + 1);
  return { start, endExclusive: requestedEnd < endExclusive ? requestedEnd : endExclusive };
}

export function calendarDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** p95 by nearest-rank over the positive daily distances. */
function p95(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
}

export function buildDriveCalendar(drives: readonly Drive[], nowMs: number, range: DriveCalendarWindow): DriveCalendar {
  const byDay = new Map<string, { distanceM: number; drives: number }>();
  for (const d of drives) {
    if (!d.startTs) continue;
    const dt = new Date(d.startTs);
    if (!Number.isFinite(dt.getTime())) continue;
    const key = calendarDayKey(dt);
    const agg = byDay.get(key) ?? { distanceM: 0, drives: 0 };
    agg.distanceM += Number.isFinite(d.distanceM) ? Math.max(0, d.distanceM) : 0;
    agg.drives += 1;
    byDay.set(key, agg);
  }

  const { start: windowStart, endExclusive } = driveCalendarBounds(nowMs, range);
  const start = new Date(windowStart);
  start.setDate(start.getDate() - start.getDay());
  const lastDay = new Date(endExclusive);
  lastDay.setDate(lastDay.getDate() - 1);

  const lastDayKey = calendarDayKey(lastDay);
  const windowStartKey = calendarDayKey(windowStart);
  const positives: number[] = [];
  for (const [key, { distanceM }] of byDay) {
    if (key >= windowStartKey && key <= lastDayKey && distanceM > 0) positives.push(distanceM);
  }
  const cap = p95(positives);

  const days: CalendarDay[] = [];
  let totalDistanceM = 0;
  let totalDrives = 0;
  let activeDays = 0;
  let busiestDay: CalendarDay | null = null;

  for (const date = new Date(start); date < endExclusive; date.setDate(date.getDate() + 1)) {
    const key = calendarDayKey(date);
    const agg = key >= windowStartKey ? byDay.get(key) : undefined;
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
  // today OR yesterday when the range includes today — an empty "today"
  // shouldn't zero it before the evening commute happens.
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
  if (idx >= 0 && days[idx]!.date === calendarDayKey(new Date(nowMs)) && days[idx]!.drives === 0) idx -= 1;
  for (; idx >= 0 && days[idx]!.drives > 0; idx--) currentStreak += 1;

  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const weekDays = days.slice(i, i + 7);
    const monthStart = weekDays.find((day) => day.date.endsWith('-01'));
    weeks.push({
      days: weekDays,
      monthKey: monthStart?.date.slice(0, 7) ?? (i === 0 ? weekDays[0]?.date.slice(0, 7) ?? null : null),
    });
  }

  const byMonth = new Map<string, CalendarMonth>();
  const weekdays: CalendarWeekday[] = Array.from({ length: 7 }, (_, day) => ({
    day,
    distanceM: 0,
    drives: 0,
    activeDays: 0,
    totalDays: 0,
  }));

  const observedDays = days.filter((day) => day.date >= windowStartKey);
  for (const day of observedDays) {
    const monthKey = day.date.slice(0, 7);
    const month = byMonth.get(monthKey) ?? {
      month: monthKey,
      distanceM: 0,
      drives: 0,
      activeDays: 0,
      totalDays: 0,
    };
    month.distanceM += day.distanceM;
    month.drives += day.drives;
    month.activeDays += day.drives > 0 ? 1 : 0;
    month.totalDays += 1;
    byMonth.set(monthKey, month);

    const weekday = weekdays[day.day]!;
    weekday.distanceM += day.distanceM;
    weekday.drives += day.drives;
    weekday.activeDays += day.drives > 0 ? 1 : 0;
    weekday.totalDays += 1;
  }

  const months = [...byMonth.values()];
  const topDays = observedDays
    .filter((day) => day.drives > 0)
    .sort((a, b) => b.distanceM - a.distanceM || a.date.localeCompare(b.date))
    .slice(0, 5);

  const favoriteWeekday = totalDrives > 0
    ? weekdays.reduce((best, row) => (
        row.drives > best.drives ||
        (row.drives === best.drives && row.distanceM > best.distanceM)
          ? row
          : best
      ))
    : null;

  const busiestMonth = totalDrives > 0
    ? months.reduce((best, month) => (
        month.distanceM > best.distanceM ||
        (month.distanceM === best.distanceM && month.drives > best.drives)
          ? month
          : best
      ))
    : null;

  const weekendDistanceM = weekdays[0]!.distanceM + weekdays[6]!.distanceM;

  return {
    days,
    weeks,
    months,
    weekdays,
    totalDistanceM,
    totalDrives,
    activeDays,
    currentStreak,
    longestStreak,
    busiestDay,
    topDays,
    favoriteWeekday,
    busiestMonth,
    activityRate: observedDays.length > 0 ? activeDays / observedDays.length : 0,
    averageDistancePerActiveDayM: activeDays > 0 ? totalDistanceM / activeDays : null,
    averageDrivesPerActiveDay: activeDays > 0 ? totalDrives / activeDays : null,
    weekendDistanceShare: totalDistanceM > 0 ? weekendDistanceM / totalDistanceM : null,
  };
}
