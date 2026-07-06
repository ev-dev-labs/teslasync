/**
 * cost-analysis view-model contracts.
 *
 * These interfaces are the derived shapes produced by the SOLE factory
 * `useCostAnalysisData()` and consumed by the Cost Analysis section components
 * (CostSummaryCards, MonthlyCostChart, ChargerTypeBreakdown, LifetimeSummary, …).
 *
 * Unit conventions (important — this feature mixes SI and display units):
 *   - Monetary values are in the user's DISPLAY currency (Settings
 *     `currency_symbol`); they carry whatever the raw `cost_decimal` column
 *     holds and are not converted.
 *   - Energy values are **kWh** (converted from the SI `total_energy_added_wh`
 *     column via `convertEnergyFromSI(_, 'kWh')`) — never raw Wh.
 *   - `totalDistanceM` is the only raw-SI field: **metres**. Per-distance costs
 *     are expressed in the user's chosen display distance unit.
 *   - Durations are in **minutes**; percentages are on a 0–100 scale.
 */

/** One calendar-month cost bucket, keyed `YYYY-MM` and sorted ascending. */
export interface MonthlyBucket {
  /** Bucket key in `YYYY-MM` form (e.g. `2024-01`). */
  month: string;
  /** Total spend for the month, in the display currency. */
  cost: number;
  /** Total energy added for the month, in kWh. */
  energy: number;
  /** Number of charging sessions in the month. */
  sessions: number;
  /** Blended rate for the month, in currency per kWh. */
  avgCostPerKwh: number;
  /** Equivalent gasoline cost for the same energy, in the display currency. */
  gasEquiv: number;
  /** `gasEquiv - cost`; positive means the EV was cheaper this month. */
  savings: number;
}

/** Aggregated economics for a single charger category (Home, Supercharger, …). */
export interface ChargerTypeData {
  /** Human-readable charger category label. */
  name: string;
  /** Total spend for this category, in the display currency. */
  cost: number;
  /** Total energy added for this category, in kWh. */
  energy: number;
  /** Number of sessions in this category. */
  sessions: number;
  /** Chart series colour (hex or CSS colour string). */
  color: string;
}

/** One hour-of-day bucket (0–23) for the time-of-use analysis. */
export interface HourBucket {
  /** Hour of day, 0–23 (local time). */
  hour: number;
  /** Display label in `HH:00` form. */
  label: string;
  /** Number of sessions started in this hour. */
  sessions: number;
  /** Mean per-session cost for the hour, in the display currency. */
  avgCost: number;
  /** Total energy added in this hour, in kWh. */
  totalEnergy: number;
}

/** Headline lifetime totals shown in the KPI band and environmental impact panel. */
export interface CoreStats {
  /** Lifetime spend, in the display currency. */
  totalCost: number;
  /** Lifetime energy added, in kWh. */
  totalEnergy: number;
  /** Blended lifetime rate, in currency per kWh. */
  avgCostPerKwh: number;
  /** Lifetime charging duration, in minutes. */
  totalDuration: number;
  /** Lifetime distance added, in **metres** (raw SI). */
  totalDistanceM: number;
  /** Cost per unit distance, in currency per user display distance unit. */
  costPerDist: number;
  /** Equivalent gasoline cost for the lifetime energy, in the display currency. */
  gasCost: number;
  /** `gasCost - totalCost`; positive means the EV was cheaper overall. */
  savings: number;
  /** Savings as a percentage of the equivalent gas cost, 0–100. */
  savingsPercent: number;
  /** CO₂ avoided versus the gasoline equivalent, in kilograms. */
  co2SavedKg: number;
  /** CO₂ saved expressed as tree-year sequestration equivalents. */
  treeEquiv: number;
  /** Gasoline equivalent of the lifetime energy, in US gallons. */
  gallonsEquiv: number;
  /** Number of charging sessions. */
  count: number;
}

/** Gas-vs-EV comparison for the savings calculator. */
export interface GasComparison {
  /** Modelled gasoline cost for the driven distance, in the display currency. */
  gasCost: number;
  /** Modelled EV energy cost at the user's electricity rate, display currency. */
  evCost: number;
  /** Actual metered charging spend, in the display currency. */
  actualCost: number;
  /** `gasCost - actualCost`; positive means real savings against gasoline. */
  savings: number;
  /** Average monthly savings across the observed range, in the display currency. */
  monthlySavings: number;
  /** `monthlySavings * 12`, in the display currency. */
  yearlySavings: number;
  /** Gasoline cost per user display distance unit (name retained for compatibility). */
  costPerMileGas: number;
  /** Actual EV cost per user display distance unit (name retained for compatibility). */
  costPerMileEV: number;
}

/** Per-session lifetime averages and free-charging tallies. */
export interface LifetimeMetrics {
  /** Mean cost per session, in the display currency. */
  avgSessionCost: number;
  /** Mean energy added per session, in kWh. */
  avgSessionEnergy: number;
  /** Mean session duration, in minutes. */
  avgDuration: number;
  /** Number of zero-cost (free) sessions. */
  freeCount: number;
  /** Total energy added by free sessions, in kWh. */
  freeEnergy: number;
  /** Most expensive single session, in the display currency. */
  maxSessionCost: number;
  /** Cheapest paid session (floored at 0), in the display currency. */
  minSessionCost: number;
}

/** Derived insights over the {@link HourBucket} series for time-of-use analysis. */
export interface TouInsights {
  /** Hour bucket with the lowest average cost. */
  cheapest: HourBucket;
  /** Hour bucket with the highest average cost. */
  priciest: HourBucket;
  /** Hour bucket with the most sessions. */
  busiest: HourBucket;
  /** Share of sessions started during off-peak hours (22:00–06:00), 0–100. */
  offPeakPct: number;
}
