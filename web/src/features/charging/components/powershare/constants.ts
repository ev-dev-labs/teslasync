/**
 * Powershare telemetry comes from 5 cold signals in signal_log per ADR-005
 * (typed-only hot schema; everything else → signal_log), surfaced through the
 * `/signals/observations` endpoint (router.go:4170).
 */
export const POWERSHARE_SIGNALS = {
  status: 'PowershareStatus',
  type: 'PowershareType',
  stopReason: 'PowershareStopReason',
  hoursLeft: 'PowershareHoursLeft',
  power: 'PowershareInstantaneousPowerKW',
} as const;

/**
 * How many recent observations to pull for the numeric signals so the trend
 * charts have a series to draw. The text signals only need the latest row.
 */
export const SERIES_LIMIT = 48;

/** chartTokens.series[2] — amber. Kept as a literal so the chart primitives can
 *  consume it directly without a token round-trip. */
export const POWER_COLOR = '#f59e0b';
/** chartTokens.series[5] — cyan. */
export const HOURS_COLOR = '#06b6d4';

/** One point in a numeric-signal trend, oldest → newest. */
export interface TrendPoint {
  ts: string;
  /** Pre-formatted time label for the chart X axis. */
  label: string;
  value: number;
}

/** One row in the raw-signal snapshot table. */
export interface SnapshotRow {
  key: string;
  label: string;
  value: string;
  ts: string | null;
}
