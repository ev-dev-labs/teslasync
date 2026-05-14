/**
 * Adaptive time-bucketing helper used by trend charts and date-grouped
 * lists so the visual unit (day / week / month / year) matches the
 * range the user is viewing. Without this, a 5-year range would render
 * thousands of daily ticks and a 3-day range would render a single
 * weekly bar.
 *
 * Pure function; no React or Date library dependencies.
 */

export type BucketingMode = 'day' | 'week' | 'month' | 'year';

export interface BucketingThresholds {
  /** Inclusive upper-bound (in days) for the `'day'` bucket. */
  dayUpTo: number;
  /** Inclusive upper-bound (in days) for the `'week'` bucket. */
  weekUpTo: number;
  /** Inclusive upper-bound (in days) for the `'month'` bucket. */
  monthUpTo: number;
}

/**
 * Defaults match the user spec for /charging:
 *   - ≤ 14 days   → daily bars
 *   - 15–90 days  → weekly bars
 *   - 91–730 days → monthly bars
 *   - > 730 days  → yearly bars
 */
export const DEFAULT_BUCKETING_THRESHOLDS: BucketingThresholds = {
  dayUpTo: 14,
  weekUpTo: 90,
  monthUpTo: 730,
};

/**
 * Pick the right bucket for a range of `rangeDays` days.
 * Negative or NaN inputs collapse to `'day'` (safe default).
 */
export function getBucketingMode(
  rangeDays: number,
  thresholds: BucketingThresholds = DEFAULT_BUCKETING_THRESHOLDS,
): BucketingMode {
  if (!Number.isFinite(rangeDays) || rangeDays <= thresholds.dayUpTo) return 'day';
  if (rangeDays <= thresholds.weekUpTo) return 'week';
  if (rangeDays <= thresholds.monthUpTo) return 'month';
  return 'year';
}

/**
 * Compute the inclusive day-count between two `YYYY-MM-DD` strings.
 * Returns 0 when either input is malformed. UTC-stable: doesn't care
 * about the caller's local timezone since both ends are interpreted in
 * UTC for the purpose of measuring range *length*.
 */
export function rangeDays(startYmd: string, endYmd: string): number {
  const start = parseUtcDay(startYmd);
  const end = parseUtcDay(endYmd);
  if (start == null || end == null || end < start) return 0;
  const diffMs = end - start;
  // +1 because the range is inclusive of both endpoints (a range from
  // Jan 1 to Jan 1 is 1 day, not 0).
  return Math.floor(diffMs / 86_400_000) + 1;
}

function parseUtcDay(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const ts = Date.UTC(y, mo, d);
  return Number.isFinite(ts) ? ts : null;
}
