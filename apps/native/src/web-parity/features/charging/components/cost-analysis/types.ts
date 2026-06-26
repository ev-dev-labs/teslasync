/**
 * Native parity port of
 * web/src/features/charging/components/cost-analysis/types.ts.
 *
 * Pure TypeScript type definitions with no runtime behavior, no DOM, and no
 * imports — the web source is platform-agnostic, so every interface is ported
 * verbatim and is fully React Native compatible. These shapes describe the
 * cost-analysis domain data (monthly cost buckets, charger-type breakdown,
 * time-of-use hour buckets, core/lifetime stats, gas comparison, and time-of-use
 * insights) shared by the cost-analysis building blocks. Units follow the SI
 * canonical contract already used on the web (e.g. totalDistanceM in meters).
 */

export interface MonthlyBucket {
  month: string;
  cost: number;
  energy: number;
  sessions: number;
  avgCostPerKwh: number;
  gasEquiv: number;
  savings: number;
}

export interface ChargerTypeData {
  name: string;
  cost: number;
  energy: number;
  sessions: number;
  color: string;
}

export interface HourBucket {
  hour: number;
  label: string;
  sessions: number;
  avgCost: number;
  totalEnergy: number;
}

export interface CoreStats {
  totalCost: number;
  totalEnergy: number;
  avgCostPerKwh: number;
  totalDuration: number;
  totalDistanceM: number;
  costPerDist: number;
  gasCost: number;
  savings: number;
  savingsPercent: number;
  co2SavedKg: number;
  treeEquiv: number;
  gallonsEquiv: number;
  count: number;
}

export interface GasComparison {
  gasCost: number;
  evCost: number;
  actualCost: number;
  savings: number;
  monthlySavings: number;
  yearlySavings: number;
  costPerMileGas: number;
  costPerMileEV: number;
}

export interface LifetimeMetrics {
  avgSessionCost: number;
  avgSessionEnergy: number;
  avgDuration: number;
  freeCount: number;
  freeEnergy: number;
  maxSessionCost: number;
  minSessionCost: number;
}

export interface TouInsights {
  cheapest: HourBucket;
  priciest: HourBucket;
  busiest: HourBucket;
  offPeakPct: number;
}
