/**
 * Charge Advisor model — "do I need to charge tonight?"
 *
 * Works entirely in battery-percent space so no pack-capacity guess is
 * needed: each drive consumed `startBatteryPct − endBatteryPct` of the pack,
 * and summing per calendar day yields a typical daily SoC burn per weekday.
 * Walking forward from the current SoC, day by day, finds when the pack would
 * cross the reserve floor — and whether that's before tomorrow's typical
 * charging opportunity.
 *
 * Pure and clock-free: `nowMs` injected by the caller.
 */

import type { Drive } from '@/types/driving';

export const RESERVE_FLOOR_PCT = 20;

export interface WeekdayBurn {
  /** JS day-of-week, 0 = Sunday. */
  day: number;
  /** Median SoC consumed on days of this weekday that had any driving, in percent. */
  medianPct: number | null;
  /** Share of this weekday's calendar days with at least one drive, 0–1. */
  driveDayShare: number | null;
}

export interface AdvisorForecastDay {
  /** Offset from today: 0 = today (remaining), 1 = tomorrow… */
  offset: number;
  day: number;
  /** Expected SoC burn for the day, percent (0 for typically-idle days). */
  expectedBurnPct: number;
  /** Projected SoC at the END of this day. */
  projectedEndPct: number;
}

export interface ChargeAdvice {
  /** Typical burn per weekday from history. */
  weekdayBurn: WeekdayBurn[];
  /** Up to 7 days of projection from the current SoC. */
  forecast: AdvisorForecastDay[];
  /** Days until the projection crosses the reserve floor; null if it doesn't within 7 days. */
  daysToReserve: number | null;
  /** True when the projection crosses the floor within ~2 days. */
  chargeTonight: boolean;
  /** Median daily burn across driving days, all weekdays pooled. */
  typicalDailyBurnPct: number | null;
  analyzedDays: number;
}

function median(sortedAsc: readonly number[]): number {
  const n = sortedAsc.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedAsc[mid]! : (sortedAsc[mid - 1]! + sortedAsc[mid]!) / 2;
}

/** Sum per-drive SoC consumption into local calendar days. */
function dailyBurns(drives: readonly Drive[]): Map<string, { burnPct: number; day: number }> {
  const byDay = new Map<string, { burnPct: number; day: number }>();
  for (const d of drives) {
    if (d.startBatteryPct == null || d.endBatteryPct == null) continue;
    const burn = d.startBatteryPct - d.endBatteryPct;
    if (!Number.isFinite(burn) || burn <= 0) continue;
    const dt = new Date(d.startTs);
    if (!Number.isFinite(dt.getTime())) continue;
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const agg = byDay.get(key) ?? { burnPct: 0, day: dt.getDay() };
    agg.burnPct += burn;
    byDay.set(key, agg);
  }
  return byDay;
}

export function computeChargeAdvice(
  drives: readonly Drive[],
  currentSocPct: number | null,
  nowMs: number,
): ChargeAdvice {
  const byDay = dailyBurns(drives);

  // Weekday medians over DRIVING days, plus how often that weekday is driven
  // at all (spanned weeks approximated from the observation window).
  const perWeekday: number[][] = Array.from({ length: 7 }, () => []);
  let earliestMs = Number.POSITIVE_INFINITY;
  for (const [key, { burnPct, day }] of byDay) {
    perWeekday[day]!.push(burnPct);
    const ms = new Date(`${key}T12:00:00`).getTime();
    if (ms < earliestMs) earliestMs = ms;
  }
  const observedWeeks =
    byDay.size > 0 ? Math.max(1, (nowMs - earliestMs) / (7 * 86_400_000)) : 0;

  const weekdayBurn: WeekdayBurn[] = Array.from({ length: 7 }, (_, day) => {
    const burns = perWeekday[day]!;
    return {
      day,
      medianPct: burns.length ? median([...burns].sort((a, b) => a - b)) : null,
      driveDayShare: observedWeeks > 0 ? Math.min(1, burns.length / observedWeeks) : null,
    };
  });

  const allBurns = perWeekday.flat().sort((a, b) => a - b);
  const typicalDailyBurnPct = allBurns.length ? median(allBurns) : null;

  // Forward projection: expected burn = weekday median × how often that
  // weekday is actually driven (an always-idle Sunday shouldn't drain the
  // forecast). Weekdays with NO observations fall back to the pooled median
  // scaled by the overall drive-day frequency — sparse history means
  // "unknown", not "idle", and an optimistic zero would defeat the advisor.
  const pooledDriveShare =
    observedWeeks > 0 ? Math.min(1, byDay.size / (observedWeeks * 7)) : 0;

  const forecast: AdvisorForecastDay[] = [];
  let daysToReserve: number | null = null;
  if (currentSocPct != null && Number.isFinite(currentSocPct) && allBurns.length >= 3) {
    let soc = currentSocPct;
    const today = new Date(nowMs);
    for (let offset = 0; offset < 7; offset++) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      const day = date.getDay();
      const wb = weekdayBurn[day]!;
      const expected =
        wb.medianPct != null
          ? wb.medianPct * (wb.driveDayShare ?? 1)
          : (typicalDailyBurnPct ?? 0) * pooledDriveShare;
      soc = Math.max(0, soc - expected);
      forecast.push({
        offset,
        day,
        expectedBurnPct: Math.round(expected * 10) / 10,
        projectedEndPct: Math.round(soc * 10) / 10,
      });
      if (daysToReserve == null && soc < RESERVE_FLOOR_PCT) daysToReserve = offset;
    }
  }

  return {
    weekdayBurn,
    forecast,
    daysToReserve,
    chargeTonight: daysToReserve != null && daysToReserve <= 1,
    typicalDailyBurnPct:
      typicalDailyBurnPct != null ? Math.round(typicalDailyBurnPct * 10) / 10 : null,
    analyzedDays: byDay.size,
  };
}
