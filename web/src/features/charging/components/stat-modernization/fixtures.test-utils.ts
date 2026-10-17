import { computeChargingPeriodStats } from '@/lib/chargingAggregation';
import type { CostForecastData, BillVarianceReport } from '@/types/charging';
import type { CoreStats, GasComparison, LifetimeMetrics, HourBucket, TouInsights } from '../cost-analysis/types';

// Synthetic test inputs only. No fixture is imported by a production page or query.
export const chargingStats = Object.freeze({
  ...computeChargingPeriodStats([]),
  count: 3, totalEnergyWh: 12345, totalCost: 31.5, totalDurationMin: 178.5,
  avgRateKw: 12.125, avgDurationMin: 59.5, avgPowerW: 18375,
});
export const priorChargingStats = Object.freeze({
  ...chargingStats, count: 2, totalEnergyWh: 10000, totalCost: 15.75,
  avgRateKw: 10, avgDurationMin: 60, avgPowerW: 20000,
});
export const coreStats: CoreStats = Object.freeze({
  totalCost: 88.75, totalEnergy: 320.5, avgCostPerKwh: 0.2769, totalDuration: 300,
  totalDistanceM: 1609344, costPerDist: 0.08875, gasCost: 350, savings: 261.25,
  savingsPercent: 74.642857, co2SavedKg: 84.7, treeEquiv: 3.85, gallonsEquiv: 9.51, count: 7,
});
export const lifetimeMetrics: LifetimeMetrics = Object.freeze({
  avgSessionCost: 12.678571, avgSessionEnergy: 45.785714, avgDuration: 59.87654,
  freeCount: 2, freeEnergy: 11.25, maxSessionCost: 33.75, minSessionCost: 0.25,
});
export const gasComparison: GasComparison = Object.freeze({
  gasCost: 350, evCost: 101.75, actualCost: 88.75, savings: 261.25,
  monthlySavings: 21.7708, yearlySavings: 261.25, costPerMileGas: 0.35, costPerMileEV: 0.08875,
});
export const hourlyData: HourBucket[] = [
  { hour: 2, label: '02:00', sessions: 3, avgCost: 2.5, totalEnergy: 16.75 },
  { hour: 16, label: '16:00', sessions: 1, avgCost: 8.75, totalEnergy: 23.25 },
];
export const touInsights: TouInsights = {
  cheapest: hourlyData[0]!, priciest: hourlyData[1]!, busiest: hourlyData[0]!, offPeakPct: 75,
};
export const bill: BillVarianceReport = Object.freeze({
  vehicle_id: 7, measured_sessions: 3, measured_energy_wh: 50000, measured_cost: 10,
  invoiced_sessions: 2, invoiced_energy_wh: 52000, invoiced_cost: 11.25,
  energy_delta_wh: -2000, energy_delta_pct: -3.846154, cost_delta: -1.25,
  cost_delta_pct: -11.111111, cabinet_loss_pct: 3.846154, verdict: 'review',
  explanation: 'Synthetic explanation: keep the exact returned evidence and reason.',
});
export const forecastData: CostForecastData = {
  historical: [
    { month: '2026-01', cost: 10, kwh: 50, sessions: 2, cost_per_kwh: 0.2 },
    { month: '2026-02', cost: 12, kwh: 50, sessions: 2, cost_per_kwh: 0.24 },
    { month: '2026-03', cost: 14, kwh: 50, sessions: 2, cost_per_kwh: 0.28 },
  ],
  forecast: [
    { month: '2026-04', cost: 16, cost_low: 12, cost_high: 20, kwh: 50 },
    { month: '2026-05', cost: 18, cost_low: NaN, cost_high: 22, kwh: 50 },
  ],
  breakdown: {
    home: { pct: 65, avg_cost_per_kwh: 0.125, monthly_avg: 10 },
    supercharger: { pct: 35, avg_cost_per_kwh: 0.375, monthly_avg: 6 },
  },
  gas_comparison: {
    monthly_savings: 12.3456, annual_savings: 148.1472, lifetime_savings: 950.5,
    gas_cost_per_month: 30.125, ev_cost_per_month: 17.7794, avg_km_per_month: 1609.344,
  },
  insights: ['Synthetic retained insight', '', '  '],
};
