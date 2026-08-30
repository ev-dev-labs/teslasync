import type { FsdInsightsDay } from '@/types/fsd';
import { FSD_PERIOD_DAYS, type FsdPeriodDays } from '@/types/fsd';

/**
 * Derived views over the dense daily series returned by GET /analytics/fsd.
 *
 * Everything here is pure and unit-agnostic: values stay in canonical SI
 * meters and are converted only at the render boundary. No helper invents a
 * value the API did not report — a missing denominator stays `null` all the
 * way to the component.
 */

/** One weekday bucket of the day-pattern insight. `weekday` is 0 = Sunday. */
export interface FsdWeekdayBucket {
  weekday: number;
  /**
   * Supervised self-driving distance summed across that weekday (meters), or
   * null when no contributing day carried a measurement.
   */
  fsdDistanceM: number | null;
  /** Self-driving distance from days where the API reported a usable share. */
  shareFsdDistanceM: number | null;
  /** Observed driving distance from the same share-eligible days. */
  shareDrivingDistanceM: number | null;
  /** Days of this weekday with a relevant distance-counter observation. */
  counterObservationDays: number;
  /** Days of this weekday carrying a measured self-driving distance. */
  measuredDays: number;
  /** Days of this weekday with non-zero supervised self-driving distance. */
  activeDays: number;
}

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Weekday index (0 = Sunday) for a `YYYY-MM-DD` local calendar day key.
 *
 * The key already names a LOCAL calendar day, so it must not be re-interpreted
 * through the browser's zone. Anchoring at UTC noon and reading the UTC day
 * keeps the weekday stable in every offset, including the midnight-boundary
 * cases where `new Date('2026-03-01')` would land on the previous day.
 *
 * Returns null for a malformed key rather than guessing.
 */
export function weekdayOfDayKey(dayKey: string): number | null {
  const match = DAY_KEY_RE.exec(dayKey);
  if (!match) return null;
  const [, year, month, day] = match;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const anchor = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber, 12));
  if (Number.isNaN(anchor.getTime())) return null;
  if (
    anchor.getUTCFullYear() !== yearNumber ||
    anchor.getUTCMonth() !== monthNumber - 1 ||
    anchor.getUTCDate() !== dayNumber
  ) {
    return null;
  }
  return anchor.getUTCDay();
}

/**
 * Roll the dense daily series into seven weekday buckets.
 *
 * The displayed self-driving total remains independent of share eligibility.
 * Share numerator and denominator are accumulated only as a pair from days
 * where the API reported a share, and only when the period-level quality
 * contract proves both counters have a common basis.
 */
export function buildWeekdayPattern(
  days: readonly FsdInsightsDay[],
  shareBasisAvailable: boolean,
): FsdWeekdayBucket[] {
  const buckets: FsdWeekdayBucket[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    fsdDistanceM: null,
    shareFsdDistanceM: null,
    shareDrivingDistanceM: null,
    counterObservationDays: 0,
    measuredDays: 0,
    activeDays: 0,
  }));

  for (const day of days) {
    const weekday = weekdayOfDayKey(day.date);
    if (weekday == null) continue;
    const bucket = buckets[weekday];
    if (day.fsd_distance_m != null) {
      bucket.fsdDistanceM = (bucket.fsdDistanceM ?? 0) + day.fsd_distance_m;
      bucket.measuredDays += 1;
      if (day.fsd_distance_m > 0) bucket.activeDays += 1;
    }
    if (
      shareBasisAvailable &&
      day.fsd_share_pct != null &&
      day.fsd_distance_m != null &&
      day.driving_distance_m != null
    ) {
      bucket.shareFsdDistanceM =
        (bucket.shareFsdDistanceM ?? 0) + day.fsd_distance_m;
      bucket.shareDrivingDistanceM =
        (bucket.shareDrivingDistanceM ?? 0) + day.driving_distance_m;
    }
    if (day.has_counter_observation) bucket.counterObservationDays += 1;
  }

  return buckets;
}

/** Share of observed driving for a bucket, or null when unknown/zero. */
export function bucketSharePct(bucket: FsdWeekdayBucket): number | null {
  if (bucket.shareFsdDistanceM == null) return null;
  if (bucket.shareDrivingDistanceM == null || bucket.shareDrivingDistanceM <= 0) return null;
  const raw = (bucket.shareFsdDistanceM / bucket.shareDrivingDistanceM) * 100;
  if (!Number.isFinite(raw)) return null;
  return Math.min(100, Math.max(0, raw));
}

/**
 * Days that actually accumulated supervised self-driving distance, ordered by
 * distance descending then by date descending, capped at `limit`.
 *
 * Unmeasured days (`fsd_distance_m === null`) and measured zeros are both
 * excluded on purpose: a "top days" list padded with either implies the
 * counter reported activity it never reported.
 */
export function topActiveDays(
  days: readonly FsdInsightsDay[],
  limit: number,
): FsdInsightsDay[] {
  return days
    .filter((day) => day.fsd_distance_m != null && day.fsd_distance_m > 0)
    .slice()
    .sort((a, b) => {
      const aDistance = a.fsd_distance_m ?? 0;
      const bDistance = b.fsd_distance_m ?? 0;
      return bDistance === aDistance ? b.date.localeCompare(a.date) : bDistance - aDistance;
    })
    .slice(0, Math.max(0, limit));
}

/** True when at least one day contains a relevant distance-counter observation. */
export function hasAnyCounterObservation(days: readonly FsdInsightsDay[]): boolean {
  return days.some((day) => day.has_counter_observation);
}

/**
 * True when at least one day carries a MEASURED self-driving distance.
 *
 * This — not `hasAnyCounterObservation` — is what gates the distance chart:
 * a vehicle whose driving counter changes all week while its self-driving
 * counter stays silent still has nothing measurable to plot.
 */
export function hasAnyMeasuredFsd(days: readonly FsdInsightsDay[]): boolean {
  return days.some((day) => day.fsd_distance_m != null);
}

/** True when at least one day reported a usable share denominator. */
export function hasAnyShare(days: readonly FsdInsightsDay[]): boolean {
  return days.some((day) => day.fsd_share_pct != null);
}

/**
 * Narrow an arbitrary number (URL state, persisted preference) back onto the
 * supported period set so the period control can never render an option the
 * backend was not asked for.
 */
export function coercePeriodDays(value: number, fallback: FsdPeriodDays): FsdPeriodDays {
  return (FSD_PERIOD_DAYS as readonly number[]).includes(value)
    ? (value as FsdPeriodDays)
    : fallback;
}
