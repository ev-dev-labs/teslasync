/**
 * A charging session as consumed by the list (`/charging-sessions`) and
 * single-session (`/charging/{id}`) views.
 *
 * Field-alias note — the charging endpoints populate several logically-equal
 * fields under different keys, so consumers must coalesce rather than assume a
 * single canonical key:
 *   - Timestamp: `started_at` is the canonical list key; `start_ts` / `startedAt`
 *     are dashboard-activity aliases the same row may also carry. Read
 *     `started_at ?? start_ts`.
 *   - Cost: `cost_decimal` is the SI-canonical column; `cost` is the legacy
 *     alias. Read `cost ?? cost_decimal`.
 * See RecentChargesSection / RecentActivity for the coalescing precedent.
 */
export interface ChargingSession {
  id: string;
  vehicle_id: string;
  charger_type: string | null;
  start_soc_pct: number;
  end_soc_pct: number | null;
  /** Energy added in watt-hours (Wh, SI canonical). */
  total_energy_added_wh: number;
  /** Peak charger power in watts (W, SI canonical). */
  peak_power_w: number | null;
  cost_decimal: number | null;
  started_at: string;
  ended_at?: string | null;
  start_ts: string;
  startedAt: string;
  /** Session duration in minutes (display-derived; present on the activity shape). */
  duration_min: number;
  cost?: number | null;
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

/* ── Smart Charge Planner ─────────────────────────────────── */

export interface OptimizeChargeRequest {
  vehicle_id: number;
  target_soc: number;
  depart_by: string;
  rate_plan_id: string;
  max_amps?: number;
  battery_capacity_kwh?: number;
  charger_voltage?: number;
  prefer_off_peak?: boolean;
}

export interface ChargeWindow {
  start_time: string;
  end_time: string;
  rate_cents_kwh: number;
  estimated_cost: number;
  rate_tier: string;
}

export interface CostComparison {
  charge_now_cost: number;
  optimized_cost: number;
  savings: number;
  savings_percent: number;
}

export interface HourlyRate {
  hour: number;
  rate_cents: number;
  tier: string;
}

export interface OptimizeChargeResponse {
  plan_id: number;
  current_soc: number;
  target_soc: number;
  kwh_needed: number;
  estimated_duration_hours: number;
  schedule: ChargeWindow;
  comparison: CostComparison;
  alternative_windows: ChargeWindow[];
  hourly_rates: HourlyRate[];
}

export interface ApplyScheduleRequest {
  plan_id: number;
}

export interface ApplyScheduleResponse {
  status: string;
  plan_id: number;
  message: string;
}

export interface ChargePlan {
  id: number;
  vehicle_id: number;
  target_soc: number;
  depart_by: string | null;
  scheduled_start: string;
  scheduled_end: string;
  rate_plan: string;
  estimated_kwh: number | null;
  estimated_cost: number | null;
  charge_now_cost: number | null;
  savings: number | null;
  status: string;
  applied_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface RatePlanInfo {
  id: string;
  name: string;
  utility: string;
}
