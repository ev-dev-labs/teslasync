import type { ScoredDrive } from './scoreDomain';
import { type FormatOptions, ymdInTz } from '@/lib/dateFormat';
import { addCivilDays } from '@/lib/dateRange';

/** Weekly / monthly roll-up derived from the scored drives in range. */
export interface PeriodStats {
  thisWeekAvg: number | null;
  lastWeekAvg: number | null;
  thisMonthAvg: number | null;
  lastMonthAvg: number | null;
  bestWeek: { avg: number | null; label: string };
  bestMonth: { avg: number | null; label: string };
  totalDrives: number;
  aOrBetter: number;
}

/**
 * Aggregate weekly / monthly averages, best week / month, and the A-or-better
 * count from the scored drives. `now` is injected (not read from the clock)
 * so the window boundaries are deterministic and unit-testable.
 *
 * Returns `null` when there are no scored drives so callers render an empty
 * state instead of a grid of zeros.
 * Pass the saved display formatter options to use its timezone. Periods are
 * half-open calendar ranges; locale never changes the canonical bucket labels.
 * Undated drives retain their total/grade counts but have no calendar bucket.
 * Non-finite or missing totals have no average; measured zero remains valid.
 * Averages retain integer rounding, and tied buckets keep first-seen identity.
 */
export function computePeriodStats(
  scoredDrives: ScoredDrive[],
  now: Date,
  opts?: FormatOptions,
): PeriodStats | null {
  if (scoredDrives.length === 0) return null;

  const today = ymdInTz(now, opts?.tz);
  const weekStart = today
    ? addCivilDays(today, -new Date(`${today}T00:00:00Z`).getUTCDay())
    : null;
  const nextWeekStart = weekStart ? addCivilDays(weekStart, 7) : null;
  const lastWeekStart = weekStart ? addCivilDays(weekStart, -7) : null;
  const monthStart = today ? `${today.slice(0, 7)}-01` : null;
  const lastMonthStart = monthStart
    ? `${addCivilDays(monthStart, -1).slice(0, 7)}-01`
    : null;
  const nextMonthStart = monthStart
    ? `${addCivilDays(monthStart, 31).slice(0, 7)}-01`
    : null;
  const datedDrives = scoredDrives.flatMap((sd) => {
    const day = sd.drive.startTs
      ? ymdInTz(new Date(sd.drive.startTs), opts?.tz)
      : null;
    return day ? [{ sd, day }] : [];
  });
  // Compare civil days, not elapsed 24-hour durations, across DST changes.
  const inPeriod = (start: string | null, end: string | null): ScoredDrive[] =>
    start && end
      ? datedDrives.filter(({ day }) => day >= start && day < end).map(({ sd }) => sd)
      : [];

  const avg = (items: ScoredDrive[]): number | null => {
    const totals = items.map((sd) => sd.score.total).filter(Number.isFinite);
    return totals.length > 0
      ? Math.round(totals.reduce((sum, total) => sum + total, 0) / totals.length)
      : null;
  };

  const thisWeekDrives = inPeriod(weekStart, nextWeekStart);
  const lastWeekDrives = inPeriod(lastWeekStart, weekStart);
  const thisMonthDrives = inPeriod(monthStart, nextMonthStart);
  const lastMonthDrives = inPeriod(lastMonthStart, monthStart);

  const weekMap = new Map<string, ScoredDrive[]>();
  const monthMap = new Map<string, ScoredDrive[]>();
  datedDrives.forEach(({ sd, day }) => {
    const d = new Date(`${day}T00:00:00Z`);
    const mo = day.slice(0, 7);
    const firstWeekday = new Date(`${mo}-01T00:00:00Z`).getUTCDay();
    const weekOfMonth = Math.ceil(
      (d.getUTCDate() + firstWeekday) / 7,
    );
    // Key the week bucket by year-MONTH-week. Keying by week-of-month alone
    // collapsed the same week number across different months (e.g. Jun-W3 and
    // Jul-W3) into one bucket, averaging unrelated drives together and
    // corrupting the "Best Week" aggregate + its label.
    const wk = `${mo}-W${weekOfMonth}`;
    if (!weekMap.has(wk)) weekMap.set(wk, []);
    weekMap.get(wk)!.push(sd);
    if (!monthMap.has(mo)) monthMap.set(mo, []);
    monthMap.get(mo)!.push(sd);
  });

  const bestPeriod = (buckets: Map<string, ScoredDrive[]>): PeriodStats['bestWeek'] => {
    let best: { avg: number; label: string } | null = null;
    buckets.forEach((items, label) => {
      const a = avg(items);
      if (a != null && (best == null || a > best.avg)) best = { avg: a, label };
    });
    return best ?? { avg: null, label: '—' };
  };

  const aOrBetter = scoredDrives.filter(
    (sd) => sd.score.grade === 'A+' || sd.score.grade === 'A',
  ).length;

  return {
    thisWeekAvg: avg(thisWeekDrives),
    lastWeekAvg: avg(lastWeekDrives),
    thisMonthAvg: avg(thisMonthDrives),
    lastMonthAvg: avg(lastMonthDrives),
    bestWeek: bestPeriod(weekMap),
    bestMonth: bestPeriod(monthMap),
    totalDrives: scoredDrives.length,
    aOrBetter,
  };
}
