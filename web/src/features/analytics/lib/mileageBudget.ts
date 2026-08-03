/**
 * Mileage Budget model — lease/warranty allowance pacing.
 *
 * Given a distance allowance (annual km over a fixed term) and the vehicle's
 * drives, computes where the odometer *should* be today (pro-rata), where it
 * actually is, and a linear projection of the term-end total with its overage
 * cost. Pure and clock-free — `nowMs` is injected by the caller.
 */

import type { Drive } from '@/types/driving';

export interface MileageBudgetConfig {
  /** Allowance per year, kilometres. */
  annualAllowanceKm: number;
  /** Term start, `yyyy-mm-dd` (local midnight). */
  termStartIso: string;
  /** Term length in months. */
  termMonths: number;
  /** Overage cost per km in major currency units. */
  overagePerKm: number;
}

export interface MonthlyBudgetPoint {
  /** `yyyy-mm`. */
  month: string;
  /** Cumulative driven km up to the end of this month (or `now` for the current month). */
  usedKm: number;
  /** Pro-rata allowance km at the same point in time. */
  allowedKm: number;
}

export interface MileageBudgetResult {
  ok: boolean;
  termStartMs: number;
  termEndMs: number;
  elapsedDays: number;
  totalDays: number;
  remainingDays: number;
  usedM: number;
  /** Pro-rata allowance as of `nowMs`, meters. */
  allowedToDateM: number;
  /** Full-term allowance, meters. */
  totalAllowanceM: number;
  /** used ÷ allowed-to-date; null before any allowance accrues. */
  paceRatio: number | null;
  /** Linear projection of term-end distance, meters; null in the first days. */
  projectedTotalM: number | null;
  projectedOverageM: number;
  projectedOverageCost: number;
  monthly: MonthlyBudgetPoint[];
}

const DAY_MS = 86_400_000;

function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate()).getTime();
}

export function isValidBudgetConfig(c: MileageBudgetConfig): boolean {
  return (
    Number.isFinite(c.annualAllowanceKm) && c.annualAllowanceKm > 0 &&
    Number.isFinite(c.termMonths) && c.termMonths >= 1 &&
    Number.isFinite(c.overagePerKm) && c.overagePerKm >= 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(c.termStartIso) &&
    Number.isFinite(new Date(`${c.termStartIso}T00:00:00`).getTime())
  );
}

export function computeMileageBudget(
  drives: readonly Drive[],
  config: MileageBudgetConfig,
  nowMs: number,
): MileageBudgetResult {
  const termStartMs = new Date(`${config.termStartIso}T00:00:00`).getTime();
  const termEndMs = addMonths(termStartMs, config.termMonths);
  const totalDays = Math.max(1, Math.round((termEndMs - termStartMs) / DAY_MS));
  const clampedNow = Math.min(Math.max(nowMs, termStartMs), termEndMs);
  const elapsedDays = (clampedNow - termStartMs) / DAY_MS;

  const totalAllowanceM = config.annualAllowanceKm * 1000 * (config.termMonths / 12);
  const allowedToDateM = totalAllowanceM * (elapsedDays / totalDays);

  // In-term drives only, ascending, for both the total and the monthly series.
  const inTerm = drives
    .filter((d) => {
      if (!d.startTs) return false;
      const t = new Date(d.startTs).getTime();
      return Number.isFinite(t) && t >= termStartMs && t < termEndMs;
    })
    .sort((a, b) => new Date(a.startTs).getTime() - new Date(b.startTs).getTime());

  let usedM = 0;
  const byMonth = new Map<string, number>();
  for (const d of inTerm) {
    const dist = Number.isFinite(d.distanceM) ? Math.max(0, d.distanceM) : 0;
    usedM += dist;
    const month = d.startTs.substring(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + dist);
  }

  // Cumulative series month by month from term start to `now`.
  const monthly: MonthlyBudgetPoint[] = [];
  let cumulative = 0;
  const start = new Date(termStartMs);
  for (let i = 0; i < config.termMonths + 1; i++) {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const monthStartMs = monthDate.getTime();
    if (monthStartMs > clampedNow) break;
    const month = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    cumulative += byMonth.get(month) ?? 0;
    const pointMs = Math.min(
      new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1).getTime(),
      clampedNow,
    );
    monthly.push({
      month,
      usedKm: Math.round(cumulative / 100) / 10,
      allowedKm: Math.round((totalAllowanceM * ((pointMs - termStartMs) / DAY_MS / totalDays)) / 100) / 10,
    });
  }

  // A linear projection over the first days of a term is all noise —
  // withhold it until a week of signal exists.
  const projectedTotalM = elapsedDays >= 7 ? (usedM / elapsedDays) * totalDays : null;
  const projectedOverageM = projectedTotalM != null ? Math.max(0, projectedTotalM - totalAllowanceM) : 0;

  return {
    ok: isValidBudgetConfig(config),
    termStartMs,
    termEndMs,
    elapsedDays: Math.round(elapsedDays),
    totalDays,
    remainingDays: Math.max(0, totalDays - Math.round(elapsedDays)),
    usedM,
    allowedToDateM,
    totalAllowanceM,
    paceRatio: allowedToDateM > 0 ? usedM / allowedToDateM : null,
    projectedTotalM,
    projectedOverageM,
    projectedOverageCost: (projectedOverageM / 1000) * config.overagePerKm,
    monthly,
  };
}
