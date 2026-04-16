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

/* ── Charging Optimizer ───────────────────────────────────── */

export interface ChargingOptimizerData {
  current_schedule: OptimizerSchedule;
  cost_analysis: OptimizerCostAnalysis;
  battery_health_score: number;
  recommendations: OptimizerRecommendation[];
  weekly_heatmap: OptimizerHeatmapEntry[];
}

export interface OptimizerSchedule {
  most_common_start_hour: number;
  most_common_day: string;
  avg_sessions_per_week: number;
  home_charging_pct: number;
  avg_charge_to_pct: number;
}

export interface OptimizerCostAnalysis {
  peak_hours: number[];
  offpeak_hours: number[];
  peak_cost_per_kwh: number;
  offpeak_cost_per_kwh: number;
  sessions_during_peak_pct: number;
  potential_monthly_savings: number;
}

export interface OptimizerRecommendation {
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  estimated_savings?: number;
}

export interface OptimizerHeatmapEntry {
  day: number;
  hour: number;
  sessions: number;
  avg_cost_per_kwh: number;
}
