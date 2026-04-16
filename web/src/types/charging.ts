export interface ChargingSession {
  id: string;
  vehicleId: string;
  chargerType: string;
  startBatteryLevel: number;
  endBatteryLevel: number;
  energyAddedKwh: number;
  maxPowerKw: number;
  costCents: number;
  fsmState: string;
  subFsmState?: string;
  startedAt: string;
  completedAt?: string;
}

/* ── Cost Forecast ────────────────────────────────────────── */

export interface CostForecastData {
  historical: CostHistoricalMonth[];
  forecast: CostForecastMonth[];
  breakdown: CostBreakdownData;
  gas_comparison: GasComparisonData;
  insights: string[];
}

export interface CostHistoricalMonth {
  month: string;
  cost: number;
  kwh: number;
  sessions: number;
  cost_per_kwh: number;
}

export interface CostForecastMonth {
  month: string;
  cost: number;
  cost_low: number;
  cost_high: number;
  kwh: number;
}

export interface CostBreakdownData {
  home: ChargerCategoryData;
  supercharger: ChargerCategoryData;
}

export interface ChargerCategoryData {
  pct: number;
  avg_cost_per_kwh: number;
  monthly_avg: number;
}

export interface GasComparisonData {
  avg_km_per_month: number;
  gas_cost_per_month: number;
  ev_cost_per_month: number;
  monthly_savings: number;
  annual_savings: number;
  lifetime_savings: number;
}
