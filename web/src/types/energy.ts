/** Types for battery & energy domain */

export interface EnergyStats {
  total_energy_kwh: number;
  total_cost: number;
  avg_efficiency_wh_km: number;
  total_distance_km: number;
  co2_saved_kg: number;
  cost_per_km: number;
  cost_per_kwh: number;
  gas_equivalent_cost: number;
  daily_breakdown: DailyEnergy[];
}

export interface DailyEnergy {
  date: string;
  energy_kwh: number;
  cost: number;
  distance_km: number;
  efficiency_wh_km: number;
}

export interface BatteryHealth {
  health_score: number;
  degradation_pct: number;
  current_capacity_pct: number;
  total_cycles: number;
  estimated_range_current_km: number;
  estimated_range_new_km: number;
  monthly_trend: MonthlyTrend[];
}

export interface MonthlyTrend {
  month: string;
  capacity_pct: number;
  range_km: number;
}

export interface BatteryCell {
  cell_id: number;
  module: number;
  voltage: number;
  temperature: number;
}

export interface BatteryCellSummary {
  total_cells: number;
  avg_voltage: number;
  min_voltage: number;
  max_voltage: number;
  voltage_spread: number;
  avg_temperature: number;
  min_temperature: number;
  max_temperature: number;
  temp_spread: number;
  cells: BatteryCell[];
}

export interface DegradationData {
  current_health: number;
  current_capacity: number;
  current_cycles: number;
  current_range: number;
  current_temp: number;
  stress_level: 'Low' | 'Medium' | 'High';
  fast_charge_ratio: number;
  snapshots: unknown[];
  monthly_trend: DegradationTrend[];
  prediction: DegradationPrediction | null;
  charging_habits: ChargingHabits | null;
  // Predictive model fields
  current_health_pct: number;
  degradation_rate_pct_per_month: number;
  projected_80pct_date: string | null;
  projections: PredictiveProjection[];
  risk_factors: RiskFactorData[];
  recommendations: string[];
}

export interface DegradationTrend {
  month: string;
  avg_health: number;
  avg_capacity: number;
  avg_range: number;
}

export interface DegradationPrediction {
  has_enough_data: boolean;
  slope_per_year: number;
  years_to_80_pct: number;
  predicted_date: string | null;
  projection_points: { month: string; health: number }[];
}

export interface ChargingHabits {
  fast_charge_count: number;
  slow_charge_count: number;
  deep_discharge_count: number;
  charge_to_full_count: number;
  high_soc_count: number;
  total_count: number;
}

export interface PredictiveProjection {
  date: string;
  health_pct: number;
  confidence_low: number;
  confidence_high: number;
}

export interface RiskFactorData {
  name: string;
  score: number;
  label: string;
  detail: string;
}

export interface BatteryHealthAnalytics {
  current_soh: number;
  estimated_capacity: number;
  original_capacity: number;
  degradation_rate_yr: number;
  battery_age_months: number;
  total_cycles: number;
  avg_depth_of_discharge: number;
  fast_charge_pct: number;
  full_charge_pct: number;
  charge_habits_score: number;
  temp_exposure_score: number;
  history: BatteryHealthSnapshot[];
}

export interface BatteryHealthSnapshot {
  date: string;
  odometer: number;
  soh_pct: number;
  capacity_kwh: number;
  range_km: number;
}

export interface EnergyFlowData {
  dc_charging_power: number | null;
  ac_charging_power: number | null;
  energy_remaining: number | null;
  pack_voltage: number | null;
  pack_current: number | null;
  soc: number | null;
  charge_state: string | null;
}

export interface VampireDrainStats {
  avg_drain_rate: number;
  total_range_lost: number;
  total_hours: number;
  event_count: number;
  avg_sentry_drain: number;
  avg_nosentry_drain: number;
}

export interface VampireDrainEvent {
  id: number;
  start_date: string;
  duration_hours: number;
  battery_lost: number;
  drain_rate_pct_per_hour: number;
  outside_temp_avg: number | null;
  sentry_mode: boolean;
}

export interface ProjectedRangeData {
  current_range_km: number;
  new_range_km: number;
  degradation_pct: number;
  total_cycles: number;
  health_score: number;
  current_capacity_pct: number;
  avg_daily_km: number;
}

export interface SleepEfficiencyData {
  sleep_efficiency_pct: number;
  time_to_sleep_avg_min: number;
  sentry_on_drain_rate: number;
  sentry_off_drain_rate: number;
  sentry_monthly_cost: number;
  sentry_monthly_kwh: number;
  sentry_extra_drain_rate: number;
  sentry_extra_monthly_kwh: number;
  sentry_extra_monthly_cost: number;
  state_distribution: { state: string; total_minutes: number }[];
  sentry_comparison: { sentry_mode: boolean; avg_drain_rate: number; avg_battery_lost: number }[];
  recent_events: SleepDrainEvent[];
}

export interface SleepDrainEvent {
  id: number;
  start_date: string;
  duration_hours: number;
  battery_lost: number;
  drain_rate: number;
  sentry_mode: boolean;
  outside_temp: number | null;
}

// Tesla Energy Site History types

export interface TeslaEnergyHistoryEntry {
  id: number;
  energy_site_id: number;
  period: string;
  timestamp: string;
  solar_energy_wh: number | null;
  battery_energy_in_wh: number | null;
  battery_energy_out_wh: number | null;
  grid_energy_in_wh: number | null;
  grid_energy_out_wh: number | null;
  consumer_energy_wh: number | null;
  fetched_at: string;
}

export interface TeslaBackupEvent {
  id: number;
  energy_site_id: number;
  period: string;
  timestamp: string;
  duration_seconds: number;
  fetched_at: string;
}

export interface TeslaWCChargingEntry {
  id: number;
  energy_site_id: number;
  din: string | null;
  timestamp: string;
  energy_wh: number | null;
  fetched_at: string;
}

// Tesla Energy Site (product from /products endpoint)

export interface TeslaEnergySite {
  id: number;
  energy_site_id: number;
  resource_type: string;
  site_name: string;
  gateway_id: string | null;
  total_pack_energy: number | null;
  percentage_charged: number | null;
  battery_type: string | null;
  backup_capable: boolean;
  storm_mode_enabled: boolean;
  has_solar: boolean;
  has_battery: boolean;
  has_grid: boolean;
  has_load_meter: boolean;
  tou_capable: boolean;
  storm_mode_capable: boolean;
  fetched_at: string;
  created_at: string;
  updated_at: string;
}

// Tesla Energy Live Status (power flow snapshot)

export interface TeslaEnergyLiveStatus {
  id: number;
  energy_site_id: number;
  solar_power: number | null;
  battery_power: number | null;
  load_power: number | null;
  grid_power: number | null;
  grid_services_power: number | null;
  energy_left: number | null;
  total_pack_energy: number | null;
  percentage_charged: number | null;
  grid_status: string | null;
  backup_capable: boolean | null;
  storm_mode_active: boolean | null;
  raw_json?: string;
  timestamp: string;
  fetched_at: string;
}
