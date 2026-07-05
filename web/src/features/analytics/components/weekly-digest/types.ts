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
 * Every quantity here is expressed in the DISPLAY units the section components
 * render directly (km, minutes, Wh/km, kWh, %, currency); this module works on
 * its own normalised view-model, distinct from the raw SI wire shapes in
 * `@/api/types`. Keep this file free of behaviour — it is a pure type contract
 * shared by the producer (useWeeklyDigest) and the consumers (the sections).
 */

/** A single completed drive, as consumed by the digest's driving aggregates. */
export interface Drive {
  id: number;
  /** ISO-8601 timestamp the drive started; used for week bucketing. */
  start_date: string;
  /** Distance travelled, in kilometres. */
  distance: number;
  /** Elapsed driving time, in minutes. */
  duration_min: number;
  /** Energy efficiency, in watt-hours per kilometre. */
  efficiency_wh_km: number;
  /** Energy consumed, in kilowatt-hours. */
  energy_used: number;
}

/** A single charging session, as consumed by the digest's charging aggregates. */
export interface ChargingSession {
  id: number;
  /** ISO-8601 timestamp the session started; used for week bucketing. */
  start_ts: string;
  /** Energy delivered to the battery this session, in kilowatt-hours. */
  total_energy_added_wh: number;
  /** Session cost, in the user's currency. */
  cost: number;
  /** Session duration, in minutes (drives the avg-charge-rate derivation). */
  duration_min: number;
  /** Battery state of charge at session start, as a percentage (0–100). */
  start_battery_pct: number;
  /** Battery state of charge at session end, as a percentage (0–100). */
  end_battery_pct: number;
}

/** A single alert; the digest only needs its severity + timestamp to bucket it. */
export interface Alert {
  id: number;
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
  /** Total distance driven this week, in kilometres. */
  totalDistance: number;
  /** Total distance driven the prior week, in kilometres. */
  prevDistance: number;
  totalDrives: number;
  prevDriveCount: number;
  /** Total drive energy this week, in kilowatt-hours. */
  energyUsed: number;
  prevEnergy: number;
  /** Total charging cost this week, in the user's currency. */
  chargingCost: number;
  prevChargingCost: number;
  /** Estimated CO₂ saved this week, in kilograms. */
  co2Saved: number;
  prevCo2: number;
  /** Mean drive efficiency this week, in watt-hours per kilometre. */
  avgEfficiency: number;
  prevAvgEfficiency: number;
  /** Total time driven this week, in minutes. */
  totalDuration: number;
  /** The longest drive of the week by distance, or `undefined` when none. */
  topDrive: Drive | undefined;
  /** Total energy added while charging this week, in kilowatt-hours. */
  chargeEnergyAdded: number;
  prevChargeEnergy: number;
  /** Mean charging power this week, in kilowatts. */
  avgChargeRate: number;
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

/** One weekday bucket of driving distance (km) for the daily-distance bar chart. */
export interface DailyDistanceEntry {
  /** Short weekday label (`Mon`…`Sun`). */
  day: string;
  distance: number;
}

/** One weekday bucket of charging energy (kWh) for the daily-energy bar chart. */
export interface DailyEnergyEntry {
  /** Short weekday label (`Mon`…`Sun`). */
  day: string;
  energy: number;
}

/** One slice of the alerts-by-severity pie chart. */
export interface AlertPieEntry {
  /** Capitalised severity label rendered in the legend/tooltip. */
  name: string;
  value: number;
  /** Resolved hex colour for the slice. */
  color: string;
}
