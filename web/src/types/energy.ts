/**
 * Battery & energy domain types.
 *
 * Every interface here mirrors the JSON wire contract emitted by the Go
 * energy/battery/analytics handlers (snake_case keys — keep these in sync with
 * the handler response maps in internal/api/{energy,battery,batterycells,
 * batterydegradation,energyflow,rangeproj,sleep}).
 *
 * Units are mixed and intentional. Most figures are SI base units
 * (`*_wh`, `*_m`, `*_wh_per_m`, `*_kg`), but a handful of fields still carry the
 * legacy display-unit suffixes the backend continues to emit today
 * (`*_km`, `*_min`, `*_kwh`). Read whatever the API returns verbatim — never
 * convert inside a hook — and apply the user's unit preference at the render
 * boundary via `useUnits()` + `@/lib/unitConversion`.
 */

export interface EnergyStats {
  /** Echoed by the backend energy handler; optional for callers that don't need it. */
  vehicle_id?: number;
  /** Inclusive day count of the requested trailing window. */
  period_days?: number;
  total_energy_used_wh: number;
  total_energy_charged_wh: number;
  total_wh: number;
  total_cost: number;
  total_distance_m: number;
  avg_efficiency_wh_per_m: number;
  co2_saved_kg: number;
  daily_breakdown: DailyEnergy[];
}

export interface DailyEnergy {
  date: string;
  energy_wh: number;
  cost: number;
  distance_m: number;
  efficiency_wh_per_m: number;
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
  capacity_wh: number;
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

export interface SleepStateDistributionRow {
  state?: string | null;
  /** Count of FSM transitions whose destination was `state`. */
  count?: number | null;
  /**
   * Reconstructed dwell minutes. The current backend intentionally emits
   * zero until transition-pair dwell reconstruction is implemented.
   */
  total_minutes?: number | null;
}

export interface SleepSentryGroup {
  sentry_mode?: boolean | null;
  count?: number | null;
  avg_drain_rate?: number | null;
  avg_duration_hours?: number | null;
  avg_battery_lost?: number | null;
  /** Average outside temperature in SI degrees Celsius. */
  avg_temp?: number | null;
}

export interface SleepEfficiencyData {
  vehicle_id?: number | null;
  period_days?: number | null;
  sleep_efficiency_pct?: number | null;
  time_to_sleep_avg_min?: number | null;
  sentry_on_drain_rate?: number | null;
  sentry_off_drain_rate?: number | null;
  sentry_monthly_cost?: number | null;
  sentry_monthly_kwh?: number | null;
  sentry_extra_drain_rate?: number | null;
  sentry_extra_monthly_kwh?: number | null;
  sentry_extra_monthly_cost?: number | null;
  /** Estimated battery capacity in SI watt-hours. */
  battery_capacity_wh?: number | null;
  capacity_source?: string | null;
  base_cost_per_kwh?: number | null;
  total_events?: number | null;
  avg_sentry_duration_hours?: number | null;
  state_distribution?: SleepStateDistributionRow[] | null;
  sentry_comparison?: SleepSentryGroup[] | null;
  recent_events?: SleepDrainEvent[] | null;
}

export interface SleepDrainEvent {
  id?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  duration_hours?: number | null;
  battery_lost?: number | null;
  drain_rate?: number | null;
  sentry_mode?: boolean | null;
  /** Outside temperature in SI degrees Celsius. */
  outside_temp?: number | null;
  start_battery?: number | null;
  end_battery?: number | null;
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
  site_info_fetched_at: string | null;
}

// Tesla Energy Site Info (detailed site configuration from /site_info)

export interface TeslaEnergySiteInfo {
  site_name?: string;
  time_zone_offset?: number;
  installation_time_zone?: string;
  backup_reserve_percent?: number;
  default_real_mode?: string;
  version?: string;
  battery_count?: number;
  nameplate_power?: number;
  nameplate_energy?: number;
  components?: {
    solar?: boolean;
    battery?: boolean;
    grid?: boolean;
    load_meter?: boolean;
    tou_capable?: boolean;
    storm_mode_capable?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface TeslaEnergySiteInfoResponse {
  data: TeslaEnergySiteInfo | null;
  fetched_at: string | null;
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

// Time-of-Use settings payload sent to Tesla API

/** Wraps the full tou_settings object expected by POST /time_of_use_settings. */
export interface TOUSettingsPayload {
  tou_settings: {
    optimization_strategy?: string;
    tariff_content_v2?: TariffContentV2;
    [key: string]: unknown;
  };
}

/** Rate plan / tariff structure inside tou_settings. */
export interface TariffContentV2 {
  name?: string;
  utility?: string;
  daily_charges?: Array<{ amount: number; name?: string }>;
  demand_charges?: Record<string, Record<string, number>>;
  energy_charges?: Record<string, Record<string, Array<{ rate: number; start: number; end: number }>>>;
  seasons?: Record<string, { fromMonth: number; fromDay: number; toMonth: number; toDay: number }>;
  [key: string]: unknown;
}

/** Preset tariff for the TOU settings UI. */
export interface TOUPreset {
  id: string;
  name: string;
  utility: string;
  settings: TOUSettingsPayload;
}
