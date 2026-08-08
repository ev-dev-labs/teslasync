/**
 * Pure Efficiency Target model.
 *
 * Canonical inputs and outputs stay in SI-derived units: meters, watt-hours,
 * and Wh/km. The caller supplies `nowMs`, making the active local
 * Monday-Sunday week deterministic and keeping display-unit conversion out of
 * the model.
 */

import type { Drive } from '@/types/driving';

const DAY_MS = 86_400_000;
const ROLLING_WEEK_SPAN_MS = 21 * DAY_MS;

export type TargetBand = 'onTarget' | 'nearMiss' | 'offTrack';

export interface WeekResult {
  /** `yyyy-mm-dd` of the week's local Monday. */
  weekStart: string;
  whPerKm: number;
  distanceM: number;
  energyWh: number;
  drives: number;
  /** Active weeks are descriptive snapshots and are never graded. */
  isActive: boolean;
  hit: boolean | null;
  band: TargetBand | null;
  targetGapWhPerKm: number | null;
  /** Trailing four calendar-week, distance-weighted observed consumption. */
  rolling4WeekWhPerKm: number | null;
  /** Consumption rank among completed weeks; 1 is lowest consumption. */
  rank: number | null;
}

export interface WeekdayResult {
  /** Monday = 0 … Sunday = 6. */
  weekday: number;
  whPerKm: number | null;
  distanceM: number;
  energyWh: number;
  drives: number;
}

export interface ConsistencySummary {
  onTarget: number;
  nearMiss: number;
  offTrack: number;
  gradedWeeks: number;
}

export interface TargetSummary {
  weeks: WeekResult[];
  completedWeeks: WeekResult[];
  activeWeek: WeekResult | null;
  latestCompletedWeek: WeekResult | null;
  weekdays: WeekdayResult[];
  consistency: ConsistencySummary;
  /** Consecutive hits ending with the latest completed, graded week. */
  currentStreak: number;
  /** Longest completed-week hit run in the observed history window. */
  longestStreak: number;
  /** Completed-week hit rate. The active week is excluded. */
  hitRate: number | null;
  /** Distance-weighted consumption across every eligible observed drive. */
  overallWhPerKm: number | null;
  observed: number;
  analyzed: number;
  excluded: number;
  historyCapReached: boolean;
  activeWeekStart: string;
}

export interface TargetSummaryOptions {
  /** Maximum rows the history endpoint can return in one request. */
  historyLimit?: number;
}

interface Aggregate {
  energyWh: number;
  distanceM: number;
  drives: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function rawConsumptionOf(aggregate: Aggregate): number {
  return aggregate.energyWh / (aggregate.distanceM / 1000);
}

function consumptionOf(aggregate: Aggregate): number {
  return round1(rawConsumptionOf(aggregate));
}

function validMeasurement(drive: Drive): drive is Drive & { energyUsedWh: number } {
  return (
    typeof drive.energyUsedWh === 'number' &&
    Number.isFinite(drive.energyUsedWh) &&
    drive.energyUsedWh > 0 &&
    Number.isFinite(drive.distanceM) &&
    drive.distanceM >= 1000
  );
}

function dayOrdinal(dayKey: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function targetBand(whPerKm: number, targetWhPerKm: number): TargetBand {
  if (whPerKm <= targetWhPerKm) return 'onTarget';
  if (whPerKm <= targetWhPerKm * 1.1) return 'nearMiss';
  return 'offTrack';
}

/** Local Monday 00:00 week key for `ms`; invalid input returns an empty key. */
export function weekStartOf(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return '';
  date.setHours(12, 0, 0, 0);
  const shift = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - shift);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptySummary(
  observed: number,
  activeWeekStart: string,
  historyLimit: number,
): TargetSummary {
  return {
    weeks: [],
    completedWeeks: [],
    activeWeek: null,
    latestCompletedWeek: null,
    weekdays: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      whPerKm: null,
      distanceM: 0,
      energyWh: 0,
      drives: 0,
    })),
    consistency: { onTarget: 0, nearMiss: 0, offTrack: 0, gradedWeeks: 0 },
    currentStreak: 0,
    longestStreak: 0,
    hitRate: null,
    overallWhPerKm: null,
    observed,
    analyzed: 0,
    excluded: observed,
    historyCapReached: observed >= historyLimit,
    activeWeekStart,
  };
}

export function summarizeTarget(
  drives: readonly Drive[],
  targetWhPerKm: number,
  nowMs: number,
  options: TargetSummaryOptions = {},
): TargetSummary {
  const historyLimit =
    Number.isFinite(options.historyLimit) && (options.historyLimit ?? 0) > 0
      ? Math.floor(options.historyLimit!)
      : 1000;
  const activeWeekStart = weekStartOf(nowMs);
  if (!activeWeekStart) return emptySummary(drives.length, '', historyLimit);

  const byWeek = new Map<string, Aggregate>();
  const byWeekday = Array.from(
    { length: 7 },
    (): Aggregate => ({ energyWh: 0, distanceM: 0, drives: 0 }),
  );
  let analyzed = 0;
  let totalEnergyWh = 0;
  let totalDistanceM = 0;

  for (const drive of drives) {
    const timestampMs = new Date(drive.startTs).getTime();
    if (
      !validMeasurement(drive) ||
      !Number.isFinite(timestampMs) ||
      timestampMs > nowMs
    ) {
      continue;
    }

    const weekStart = weekStartOf(timestampMs);
    if (!weekStart) continue;
    const aggregate = byWeek.get(weekStart) ?? {
      energyWh: 0,
      distanceM: 0,
      drives: 0,
    };
    aggregate.energyWh += drive.energyUsedWh;
    aggregate.distanceM += drive.distanceM;
    aggregate.drives += 1;
    byWeek.set(weekStart, aggregate);

    const weekday = (new Date(timestampMs).getDay() + 6) % 7;
    const weekdayAggregate = byWeekday[weekday]!;
    weekdayAggregate.energyWh += drive.energyUsedWh;
    weekdayAggregate.distanceM += drive.distanceM;
    weekdayAggregate.drives += 1;

    analyzed += 1;
    totalEnergyWh += drive.energyUsedWh;
    totalDistanceM += drive.distanceM;
  }

  const validTarget = Number.isFinite(targetWhPerKm) && targetWhPerKm > 0;
  const rawWeeks = Array.from(byWeek.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, aggregate]) => ({ weekStart, aggregate }));

  let weeks: WeekResult[] = rawWeeks.map(({ weekStart, aggregate }, index) => {
    const rawWhPerKm = rawConsumptionOf(aggregate);
    const whPerKm = round1(rawWhPerKm);
    const isActive = weekStart === activeWeekStart;
    const currentOrdinal = dayOrdinal(weekStart);
    const rollingAggregates = rawWeeks
      .slice(0, index + 1)
      .filter(({ weekStart: candidate }) => {
        const candidateOrdinal = dayOrdinal(candidate);
        return candidateOrdinal >= currentOrdinal - ROLLING_WEEK_SPAN_MS;
      })
      .map(({ aggregate: candidate }) => candidate);
    const rolling = rollingAggregates.reduce<Aggregate>(
      (total, candidate) => ({
        energyWh: total.energyWh + candidate.energyWh,
        distanceM: total.distanceM + candidate.distanceM,
        drives: total.drives + candidate.drives,
      }),
      { energyWh: 0, distanceM: 0, drives: 0 },
    );
    const band = !isActive && validTarget ? targetBand(rawWhPerKm, targetWhPerKm) : null;

    return {
      weekStart,
      whPerKm,
      distanceM: aggregate.distanceM,
      energyWh: aggregate.energyWh,
      drives: aggregate.drives,
      isActive,
      hit: isActive ? null : validTarget ? rawWhPerKm <= targetWhPerKm : false,
      band,
      targetGapWhPerKm:
        !isActive && validTarget ? round1(rawWhPerKm - targetWhPerKm) : null,
      rolling4WeekWhPerKm:
        rolling.distanceM >= 1000 ? consumptionOf(rolling) : null,
      rank: null,
    };
  });

  const ranked = weeks
    .filter((week) => !week.isActive)
    .slice()
    .sort(
      (left, right) =>
        left.whPerKm - right.whPerKm ||
        left.weekStart.localeCompare(right.weekStart),
    );
  const rankByWeek = new Map(
    ranked.map((week, index) => [week.weekStart, index + 1]),
  );
  weeks = weeks.map((week) => ({
    ...week,
    rank: week.isActive ? null : (rankByWeek.get(week.weekStart) ?? null),
  }));

  const completedWeeks = weeks.filter((week) => !week.isActive);
  const activeWeek = weeks.find((week) => week.isActive) ?? null;
  let longestStreak = 0;
  let run = 0;
  for (const week of completedWeeks) {
    run = week.hit ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
  }
  let currentStreak = 0;
  for (
    let index = completedWeeks.length - 1;
    index >= 0 && completedWeeks[index]!.hit;
    index -= 1
  ) {
    currentStreak += 1;
  }

  const consistency = completedWeeks.reduce<ConsistencySummary>(
    (result, week) => {
      if (week.band) {
        result[week.band] += 1;
        result.gradedWeeks += 1;
      }
      return result;
    },
    { onTarget: 0, nearMiss: 0, offTrack: 0, gradedWeeks: 0 },
  );
  const weekdays = byWeekday.map<WeekdayResult>((aggregate, weekday) => ({
    weekday,
    whPerKm: aggregate.distanceM >= 1000 ? consumptionOf(aggregate) : null,
    distanceM: aggregate.distanceM,
    energyWh: aggregate.energyWh,
    drives: aggregate.drives,
  }));

  return {
    weeks,
    completedWeeks,
    activeWeek,
    latestCompletedWeek:
      completedWeeks[completedWeeks.length - 1] ?? null,
    weekdays,
    consistency,
    currentStreak,
    longestStreak,
    hitRate:
      validTarget && completedWeeks.length > 0
        ? completedWeeks.filter((week) => week.hit).length / completedWeeks.length
        : null,
    overallWhPerKm:
      totalDistanceM >= 1000
        ? round1(totalEnergyWh / (totalDistanceM / 1000))
        : null,
    observed: drives.length,
    analyzed,
    excluded: drives.length - analyzed,
    historyCapReached: drives.length >= historyLimit,
    activeWeekStart,
  };
}
