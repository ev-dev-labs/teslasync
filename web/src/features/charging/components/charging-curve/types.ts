/**
 * View-model shapes for the Charging Curve feature.
 *
 * These are DISPLAY-layer aggregates: power is in kilowatts (kW), energy in
 * kilowatt-hours (kWh) and durations in minutes — already converted from the
 * SI wire fields (`*_w`, `*_wh`, seconds) at the point of construction. They
 * are intentionally NOT SI; do not "fix" the unit suffixes here.
 */

/** A single point on a simulated power-vs-SOC charging curve. */
export interface CurvePoint {
  /** Battery state-of-charge at this point, in percent (0–100). */
  soc: number;
  /** Instantaneous charging power at this SOC, in kilowatts (kW), never < 0. */
  power: number;
}

/** Aggregated statistics for one charger category (Supercharger / DC Fast /
 *  Home · AC). */
export interface ChargerTypeStats {
  /** Human-readable charger category label. */
  label: string;
  /** Number of sessions in this category. */
  count: number;
  /** Mean peak charging power, in kilowatts (kW). */
  avgKw: number;
  /** Mean energy added per session, in kilowatt-hours (kWh). */
  avgKwh: number;
  /** Mean session duration, in minutes. */
  avgDuration: number;
}

/** One calendar month's average DC vs AC charging speed. */
export interface MonthlySpeed {
  /** Month bucket, `YYYY-MM`. */
  month: string;
  /** Mean DC charging power for the month, in kilowatts (kW). */
  dcAvgKw: number;
  /** Mean AC charging power for the month, in kilowatts (kW). */
  acAvgKw: number;
}

/** A session's average charge rate paired with its session id. */
export interface ChargeRatePoint {
  /** Average charging rate, in kilowatt-hours per hour (kWh/h). */
  rate: number;
  /** Owning charging-session id. */
  id: number;
}

/** One calendar year's time-to-charge trend bucket.
 *
 *  Declared as a `type` alias (not an `interface`) so it carries an implicit
 *  index signature and stays assignable to `ChartContainer`'s `ChartDataRow`
 *  fallback-table shape — `YearlyTrendChart` passes an array of these straight
 *  to the chart `data` prop. */
export type YearlyTrendPoint = {
  /** Year bucket, `YYYY`. */
  year: string;
  /** Mean 10% → 80% charge duration, in minutes. */
  avg10to80: number;
  /** Mean 20% → 80% charge duration, in minutes. */
  avg20to80: number;
  /** Number of DC sessions counted in the year. */
  count: number;
};

/** Time-to-charge metrics over the selected session window. `null` marks a
 *  metric with no qualifying sessions — it is never silently coerced to 0. */
export interface TimeToChargeMetrics {
  /** Mean 10% → 80% duration in minutes, or `null` when none qualify. */
  avg10to80: number | null;
  /** Mean 20% → 80% duration in minutes, or `null` when none qualify. */
  avg20to80: number | null;
  /** Fastest session by charge rate, or `null` when none qualify. */
  fastest: ChargeRatePoint | null;
  /** Slowest session by charge rate, or `null` when none qualify. */
  slowest: ChargeRatePoint | null;
  /** Per-year trend, sorted ascending by year (empty when none qualify). */
  yearlyTrend: YearlyTrendPoint[];
}

/** Headline summary metrics for the charging overview grid. */
export interface SummaryStats {
  /** Total number of sessions in the window. */
  totalSessions: number;
  /** Total energy added, in kilowatt-hours (kWh). */
  totalEnergy: number;
  /** Mean peak charging power, in kilowatts (kW). */
  avgRate: number;
  /** Highest peak charging power observed, in kilowatts (kW). */
  peakRate: number;
  /** Mean session duration, in minutes. */
  avgDuration: number;
  /** Total charging cost, in the account's configured currency. */
  totalCost: number;
}
