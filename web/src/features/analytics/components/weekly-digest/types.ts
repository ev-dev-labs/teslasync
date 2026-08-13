/**
 * Weekly-digest view-model contract.
 *
 * `WeeklyDigestPage` (route `/weekly-digest`) renders a bento of section
 * components — DrivingSection, ChargingSection, BatteryHealthSection,
 * AlertsSection, SummaryHeroCards, WeekOverWeekSummary — all driven by the
 * shapes declared here. `useWeeklyDigest()` is the single producer: it reads the
 * per-record inputs ({@link Drive} / {@link ChargingSession} / {@link Alert}),
 * buckets them into the selected ISO week vs. the prior week, and derives the
 * aggregate {@link DigestMetrics} plus the chart series
 * ({@link DailyDistanceEntry} / {@link DailyEnergyEntry} / {@link AlertPieEntry})
 * and the optional {@link FunFact} headline.
 *
 * Every physical quantity remains SI-canonical through this view-model. Section
 * components convert only at the render boundary through `useUnits()`. Keep this
 * file free of behaviour — it is a pure type contract shared by the producer
 * (`useWeeklyDigest`) and the consumers (the sections).
 */

/** A single completed drive, as consumed by the digest's driving aggregates. */
export interface Drive {
  id: number;
  /** ISO-8601 timestamp the drive started; used for week bucketing. */
  startTs: string;
  /** Distance travelled, in metres. */
  distanceM: number;
  /** Elapsed driving time, in seconds. */
  durationS: number;
  /** Energy consumed, in watt-hours. */
  energyUsedWh: number | null;
}

/** A single charging session, as consumed by the digest's charging aggregates. */
export interface ChargingSession {
  id: number;
  /** ISO-8601 timestamp the session started; used for week bucketing. */
  started_at: string;
  /** ISO-8601 timestamp the session ended; null while charging is active. */
  ended_at: string | null;
  /** Energy delivered to the battery this session, in watt-hours. */
  total_energy_added_wh: number | null;
  /** Session cost, in the user's currency. */
  cost_decimal: number | null;
  /** Mean session power, in watts. */
  avg_power_w?: number | null;
  /** Battery state of charge at session start, as a percentage (0–100). */
  start_soc_pct: number | null;
  /** Battery state of charge at session end, as a percentage (0–100). */
  end_soc_pct: number | null;
}

/** A single alert; the digest only needs its severity + timestamp to bucket it. */
export interface Alert {
  id: number;
  /** Owning vehicle; zero denotes a notification from an all-vehicle rule. */
  vehicle_id: number;
  /** Severity slug — typically `info` | `warning` | `critical`. */
  severity: string;
  /** ISO-8601 timestamp the alert fired; used for week bucketing. */
  created_at: string;
}

/**
 * Fully-aggregated metrics for the selected week, derived by useWeeklyDigest and
 * threaded into every section. Each `prev*` field mirrors its counterpart for
 * the immediately preceding week so the sections can render week-over-week
 * deltas. All numeric fields are always present (zeroed when there is no data);
 * only `topDrive` is optional.
 */
export interface DigestMetrics {
  /** Total distance driven this week, in metres. */
  totalDistanceM: number;
  /** Total distance driven the prior week, in metres. */
  prevDistanceM: number;
  totalDrives: number;
  prevDriveCount: number;
  /** Total drive energy this week, in watt-hours. */
  energyUsedWh: number;
  prevEnergyWh: number;
  /** Total charging cost this week, in the user's currency. */
  chargingCost: number;
  prevChargingCost: number;
  /** Estimated CO₂ saved this week, in kilograms. */
  co2Saved: number;
  prevCo2: number;
  /** Distance-weighted drive efficiency this week, in watt-hours per metre. */
  avgEfficiencyWhPerM: number;
  prevAvgEfficiencyWhPerM: number;
  /** Total time driven this week, in seconds. */
  totalDurationS: number;
  /** The longest drive of the week by distance, or `undefined` when none. */
  topDrive: Drive | undefined;
  /** Total energy added while charging this week, in watt-hours. */
  chargeEnergyAddedWh: number;
  prevChargeEnergyWh: number;
  /** Mean charging power this week, in watts. */
  avgChargePowerW: number;
  chargingSessionCount: number;
  /** Mean battery % at charge start across the week's sessions. */
  batteryStart: number;
  /** Mean battery % at charge end across the week's sessions. */
  batteryEnd: number;
  /** Alert counts this week keyed by severity slug. */
  alertsByType: Record<string, number>;
  /** Total alert count this week (equals the sum of `alertsByType` values). */
  alertTotal: number;
}

/** "You drove far enough to reach X" headline, or `undefined` below threshold. */
export interface FunFact {
  from: string;
  to: string;
  /** Number of trips between the two cities, pre-formatted to one decimal. */
  times: string;
}

/** One weekday bucket of driving distance (m) for the daily-distance bar chart. */
export interface DailyDistanceEntry {
  /** Short weekday label (`Mon`…`Sun`). */
  day: string;
  distanceM: number;
}

/** One weekday bucket of charging energy (Wh) for the daily-energy bar chart. */
export interface DailyEnergyEntry {
  /** Short weekday label (`Mon`…`Sun`). */
  day: string;
  energyWh: number;
}

/** One slice of the alerts-by-severity pie chart. */
export interface AlertPieEntry {
  /** Capitalised severity label rendered in the legend/tooltip. */
  name: string;
  value: number;
  /** Resolved hex colour for the slice. */
  color: string;
}
