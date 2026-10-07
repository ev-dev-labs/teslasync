import type { ScoredDrive } from './scoreDomain';

/** Weekly / monthly roll-up derived from the scored drives in range. */
export interface PeriodStats {
  thisWeekAvg: number | null;
  lastWeekAvg: number | null;
  thisMonthAvg: number | null;
  lastMonthAvg: number | null;
  bestWeek: { avg: number; label: string };
  bestMonth: { avg: number; label: string };
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
 */
export function computePeriodStats(
  scoredDrives: ScoredDrive[],
  now: Date,
): PeriodStats | null {
  if (scoredDrives.length === 0) return null;

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const avg = (items: ScoredDrive[]): number | null =>
    items.length > 0
      ? Math.round(items.reduce((s, d) => s + d.score.total, 0) / items.length)
      : null;

  const thisWeekDrives = scoredDrives.filter(
    (sd) => new Date(sd.drive.startTs) >= weekStart,
  );
  const lastWeekDrives = scoredDrives.filter((sd) => {
    const d = new Date(sd.drive.startTs);
    return d >= lastWeekStart && d < weekStart;
  });
  const thisMonthDrives = scoredDrives.filter(
    (sd) => new Date(sd.drive.startTs) >= monthStart,
  );
  const lastMonthDrives = scoredDrives.filter((sd) => {
    const d = new Date(sd.drive.startTs);
    return d >= lastMonthStart && d <= lastMonthEnd;
  });

  const weekMap = new Map<string, ScoredDrive[]>();
  const monthMap = new Map<string, ScoredDrive[]>();
  scoredDrives.forEach((sd) => {
    const d = new Date(sd.drive.startTs);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const weekOfMonth = Math.ceil(
      (d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7,
    );
    // Key the week bucket by year-MONTH-week. Keying by week-of-month alone
    // collapsed the same week number across different months (e.g. Jun-W3 and
    // Jul-W3) into one bucket, averaging unrelated drives together and
    // corrupting the "Best Week" aggregate + its label.
    const wk = `${d.getFullYear()}-${month}-W${weekOfMonth}`;
    const mo = `${d.getFullYear()}-${month}`;
    if (!weekMap.has(wk)) weekMap.set(wk, []);
    weekMap.get(wk)!.push(sd);
    if (!monthMap.has(mo)) monthMap.set(mo, []);
    monthMap.get(mo)!.push(sd);
  });

  let bestWeek = { avg: 0, label: '—' };
  weekMap.forEach((items, label) => {
    const a = avg(items);
    if (a != null && a > bestWeek.avg) bestWeek = { avg: a, label };
  });
  let bestMonth = { avg: 0, label: '—' };
  monthMap.forEach((items, label) => {
    const a = avg(items);
    if (a != null && a > bestMonth.avg) bestMonth = { avg: a, label };
  });

  const aOrBetter = scoredDrives.filter(
    (sd) => sd.score.grade === 'A+' || sd.score.grade === 'A',
  ).length;

  return {
    thisWeekAvg: avg(thisWeekDrives),
    lastWeekAvg: avg(lastWeekDrives),
    thisMonthAvg: avg(thisMonthDrives),
    lastMonthAvg: avg(lastMonthDrives),
    bestWeek,
    bestMonth,
    totalDrives: scoredDrives.length,
    aOrBetter,
  };
}
