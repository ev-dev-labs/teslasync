/**
 * FSD Insights API contract.
 *
 * Mirrors `internal/api/fsd` (GET /api/v1/analytics/fsd) field-for-field:
 * snake_case keys, canonical SI meters, Go pointers as `| null`.
 *
 * ## Honesty contract (mirrors the Go package doc)
 *
 * The endpoint is derived from ONE Tesla Fleet Telemetry field,
 * `SelfDrivingMilesSinceReset` — a user-resettable cumulative counter of
 * supervised self-driving distance — plus `MilesSinceReset` as the
 * observed-driving denominator. Despite the proto names, both arrive here as
 * SI **meters**.
 *
 * These counters therefore CANNOT describe interventions, disengagements,
 * safety performance, autonomy quality, or exact per-drive attribution. No
 * type in this file should ever be extended to imply otherwise.
 *
 * ## Units
 *
 * Every `*_m` value is meters. Hooks return them raw; conversion to the
 * operator's display unit happens at the render boundary through
 * `useUnits()` + `lib/unitConversion`.
 *
 * ## Absence is not zero
 *
 * Every FSD distance is `number | null`. `null` means "not measured" — the
 * self-driving counter did not report inside the window, or no delta could be
 * derived from what it reported. Rendering `?? 0` for those fields is a data
 * integrity bug: it turns "the car never told us" into "the car never drove
 * itself". `quality.fsd_reported_in_period`, `quality.fsd_distance_derivable`
 * and `quality.fsd_measured_days` expose the same distinction as flags.
 */

/** Period the response covers. Dates are local calendar dates in `timezone`. */
export interface FsdInsightsPeriod {
  days: number;
  /** IANA timezone the daily buckets were grouped by. */
  timezone: string;
  /** First local calendar day of the dense series (YYYY-MM-DD). */
  start_date: string;
  /** Last local calendar day of the dense series (YYYY-MM-DD). */
  end_date: string;
  /** RFC3339 UTC instant the window opened at. */
  start_at: string;
  /** RFC3339 UTC instant the window closed at. */
  end_at: string;
}

/** The single local day with the most supervised self-driving distance. */
export interface FsdInsightsBestDay {
  date: string;
  fsd_distance_m: number;
  driving_distance_m: number | null;
  fsd_share_pct: number | null;
}

/** Period-level rollup. All distances are SI meters. */
export interface FsdInsightsTotals {
  /** Null when the self-driving counter did not report a derivable distance. */
  fsd_distance_m: number | null;
  /** Null when the observed-driving counter never reported a derivable delta. */
  driving_distance_m: number | null;
  /** Null when either side is unavailable, their bases differ, or the denominator is zero. */
  fsd_share_pct: number | null;
  active_days: number;
  /** Days whose `fsd_distance_m` is a measurement rather than null. */
  measured_days: number;
  days_in_period: number;
  /** Average across measured days only; null days never count as zero. */
  avg_measured_day_fsd_distance_m: number | null;
  avg_active_day_fsd_distance_m: number | null;
  best_day: FsdInsightsBestDay | null;
}

/** Trust metadata backing the Data Confidence panel. */
export interface FsdInsightsQuality {
  fsd_sample_count: number;
  driving_sample_count: number;
  fsd_invalid_sample_count: number;
  driving_invalid_sample_count: number;
  fsd_duplicate_sample_count: number;
  driving_duplicate_sample_count: number;
  fsd_reset_count: number;
  driving_reset_count: number;
  fsd_baseline_available: boolean;
  driving_baseline_available: boolean;
  /**
   * Whether the counter emitted at least one valid observation INSIDE the
   * window. A pre-window baseline alone is deliberately not enough.
   */
  fsd_reported_in_period: boolean;
  driving_reported_in_period: boolean;
  /** When false, every `fsd_distance_m` in the payload is null. */
  fsd_distance_derivable: boolean;
  driving_denominator_available: boolean;
  /** Both counters have a provably common pre-window or simultaneous in-window basis. */
  share_basis_available: boolean;
  /** Days whose `fsd_distance_m` is a measurement rather than null. */
  fsd_measured_days: number;
  /** True when legacy rows without proven canonical normalization are excluded. */
  historical_data_guarded: boolean;
  /** Minimum row-level normalization contract accepted by the endpoint. */
  required_normalization_version: number;
  fsd_untrusted_sample_count: number;
  driving_untrusted_sample_count: number;
  /** Days on which at least one relevant distance counter emitted a valid value. */
  counter_observation_days: number;
  days_without_counter_observation: number;
  counter_observation_day_pct: number;
  first_observation_at: string | null;
  last_observation_at: string | null;
  /** Bounds of the self-driving counter specifically. */
  fsd_first_observation_at: string | null;
  fsd_last_observation_at: string | null;
  /** True when a raw share exceeded 100% (independent counter resets). */
  share_clamped: boolean;
}

/**
 * One local calendar day. The series is dense: every day in the period is
 * present.
 *
 * `fsd_distance_m === null` means the self-driving counter has nothing to say
 * about this day. A measured `0` means at least one relevant distance counter
 * reported and the self-driving counter did not move.
 * `has_counter_observation === false` says only that neither of these two
 * counters emitted that day; it is not a vehicle-connectivity signal.
 */
export interface FsdInsightsDay {
  date: string;
  fsd_distance_m: number | null;
  driving_distance_m: number | null;
  fsd_share_pct: number | null;
  fsd_observation_count: number;
  driving_observation_count: number;
  reset_count: number;
  has_counter_observation: boolean;
}

/** Full GET /analytics/fsd payload. */
export interface FsdInsights {
  vehicle_id: number;
  period: FsdInsightsPeriod;
  totals: FsdInsightsTotals;
  quality: FsdInsightsQuality;
  daily: FsdInsightsDay[];
}

/** Period presets the backend and the period control agree on. */
export const FSD_PERIOD_DAYS = [7, 30, 90, 365] as const;

/** One of the supported period lengths. */
export type FsdPeriodDays = (typeof FSD_PERIOD_DAYS)[number];

/** Default period, matching the backend's `defaultDays`. */
export const FSD_DEFAULT_PERIOD_DAYS: FsdPeriodDays = 30;
