import { request } from '../../api/client';

export interface EnergyStats {
  total_energy_used_wh: number;
  total_energy_charged_wh: number;
  total_wh: number;
  avg_efficiency_wh_per_m: number;
  total_distance_m: number;
  total_cost: number;
  co2_saved_kg: number;
  daily_breakdown: {
    date: string;
    energy_wh: number;
    distance_m: number;
    efficiency_wh_per_m: number;
  }[];
}

export interface BatteryReport {
  vehicle_id: number;
  current_capacity_pct: number;
  degradation_pct: number;
  estimated_range_new_km: number;
  estimated_range_current_km: number;
  total_cycles: number;
  health_score: number;
  monthly_trend: { month: string; capacity_pct: number; range_km: number }[];
}

export interface StatsSummary {
  min: number;
  max: number;
  avg: number;
  median: number;
  p95: number;
  count: number;
}

export interface FleetAnalytics {
  period_days: number;
  total_vehicles: number;
  total_distance_km: number;
  total_drives: number;
  total_charging_sessions: number;
  total_energy_kwh: number;
  total_cost: number;
  avg_efficiency_wh_km: number;
  most_efficient_vehicle: {
    id: number;
    name: string;
    efficiency: number;
  } | null;
  vehicle_comparison: {
    id: number;
    name: string;
    distance: number;
    energy: number;
    efficiency: number;
    drives: number;
  }[];
  drive_analytics: {
    hourly_pattern: { hour: number; drives: number; distance: number }[];
    day_of_week: {
      day: string;
      drives: number;
      distance: number;
      avg_distance: number;
    }[];
    speed_distribution: { range: string; count: number }[];
    distance_distribution: { range: string; count: number }[];
    speed_stats: StatsSummary;
    power_stats: StatsSummary;
    regen_stats: StatsSummary;
    duration_stats: StatsSummary;
    distance_stats: StatsSummary;
    efficiency_stats: StatsSummary;
    daily_trend: {
      date: string;
      drives: number;
      distance: number;
      efficiency?: number;
    }[];
    temp_vs_efficiency: {
      temp: number;
      efficiency: number;
      distance: number;
    }[];
    duration_distribution?: { range: string; count: number }[];
    temperature: { inside: StatsSummary; outside: StatsSummary };
  };
  charging_analytics: {
    hourly_pattern: { hour: number; charges: number; energy: number }[];
    charger_types: { type: string; count: number }[];
    charger_brands: { brand: string; count: number }[];
    monthly_trend: {
      month: string;
      energy: number;
      cost: number;
      sessions: number;
      avg_power: number;
      gas_cost: number;
      savings: number;
    }[];
    power_stats: StatsSummary;
    duration_stats: StatsSummary;
    energy_stats: StatsSummary;
    cost_stats: StatsSummary;
    start_battery_dist: { range: string; count: number }[];
    efficiency_stats: StatsSummary;
  };
  battery_trend: {
    date: string;
    health_score: number;
    capacity_wh: number;
    degradation_pct: number;
    range_km: number;
    cycle_count: number;
  }[];
}

export interface ChargingHeatmapCell {
  day_of_week: number;
  hour_of_day: number;
  session_count: number;
  avg_energy_wh: number;
  avg_cost: number;
}

export interface ChargingLocationBreakdown {
  location: string;
  count: number;
  total_wh: number;
  total_cost: number;
  avg_power_w: number;
}

export interface ChargingHeatmapSummary {
  total_sessions: number;
  total_wh: number;
  total_cost: number;
  avg_duration_s: number;
}

export interface ChargingHeatmapData {
  heatmap: ChargingHeatmapCell[];
  locations: ChargingLocationBreakdown[];
  summary: ChargingHeatmapSummary;
}

export interface SpeedBucket {
  speed_bucket: string;
  readings: number;
  avg_power_kw: number;
}

export interface EfficiencyCategory {
  category: string;
  drive_count: number;
  avg_speed: number;
  battery_pct_per_100km: number;
}

export interface EfficiencyPoint {
  speed_avg: number;
  distance: number;
  efficiency: number;
}

export interface SpeedProfileData {
  distribution: SpeedBucket[];
  categories: EfficiencyCategory[];
  points: EfficiencyPoint[];
  avgSpeedMps: number;
  peakSpeedMps: number;
  optimalSpeedMps: number;
}

export interface TempEfficiencyBucket {
  temp_bucket: string;
  drive_count: number;
  avg_distance_km: number;
  avg_duration_s: number;
  avg_battery_pct_per_100km: number;
  avg_temp: number;
}

export interface VampireDrainBucket {
  temp_bucket: string;
  avg_drain_rate: number;
  event_count: number;
}

export interface MonthlyTempTrend {
  month: string;
  avg_temp: number;
  avg_efficiency: number;
  drive_count: number;
  total_distance: number;
}

export interface TemperatureImpactData {
  efficiency: TempEfficiencyBucket[];
  vampire_drain: VampireDrainBucket[];
  monthly_trend: MonthlyTempTrend[];
}

export interface RouteSummary {
  start_location: string;
  end_location: string;
  trip_count: number;
  avg_distance_km: number;
  avg_duration_s: number;
  avg_efficiency: number;
  best_efficiency: number;
  worst_efficiency: number;
  avg_speed: number;
  avg_temp: number;
}

export interface RouteDriveDetail {
  id: number;
  start_date: string;
  distance: number;
  duration_s: number;
  avg_speed_mps: number;
  start_battery_level: number;
  end_battery_level: number;
  outside_temp_avg: number;
  efficiency: number;
}

export interface RouteEfficiencyData {
  routes: RouteSummary[];
}

export interface RouteDetailData {
  drives: RouteDriveDetail[];
}

export interface TCOAnalytics {
  vehicle_id: number;
  total_charging_cost: number;
  total_wh: number;
  total_sessions: number;
  total_km: number;
  first_date: string;
  last_date: string;
  months_of_ownership: number;
  cost_per_km_ev: number;
  cost_per_km_ice: number;
  equivalent_gas_cost: number;
  total_savings: number;
  monthly_savings: number;
  maintenance_savings_estimate: number;
  gas_price: number;
  gas_efficiency_mpg: number;
  base_cost_per_kwh: number;
  monthly_breakdown: {
    month: string;
    ev_cost: number;
    equiv_gas_cost: number;
    savings: number;
    cumulative_savings: number;
    energy_wh: number;
  }[];
}

export interface SleepAnalytics {
  vehicle_id: number;
  period_days: number;
  state_distribution: { state: string; count: number; total_minutes: number }[];
  sleep_efficiency_pct: number;
  time_to_sleep_avg_min: number;
  sentry_comparison: {
    sentry_mode: boolean;
    count: number;
    avg_drain_rate: number;
    avg_duration_hours: number;
    avg_battery_lost: number;
    avg_temp: number;
  }[];
  sentry_on_drain_rate: number;
  sentry_off_drain_rate: number;
  sentry_monthly_kwh: number;
  sentry_monthly_cost: number;
  sentry_extra_drain_rate: number;
  sentry_extra_monthly_kwh: number;
  sentry_extra_monthly_cost: number;
  battery_capacity_wh: number;
  base_cost_per_kwh: number;
  recent_events: {
    id: number;
    start_date: string;
    end_date: string;
    duration_hours: number;
    battery_lost: number;
    drain_rate: number;
    sentry_mode: boolean;
    outside_temp: number | null;
    start_battery: number;
    end_battery: number;
  }[];
  total_events: number;
  avg_sentry_duration_hours: number;
}

export interface RegenData {
  vehicle_id: number;
  total_regen_wh: number;
  total_drive_wh: number;
  regen_ratio: number;
  monthly_avg_regen: number;
  free_charges: number;
  monthly_summary: {
    month: string;
    drive_count: number;
    avg_regen_power_kw: number;
    avg_speed: number;
    avg_efficiency: number;
  }[];
  drives: {
    id: number;
    start_date: string;
    distance: number;
    duration_min: number;
    speed_avg: number | null;
    power_max: number | null;
    power_min: number | null;
    start_battery_level: number | null;
    end_battery_level: number | null;
    efficiency: number;
    regen_score: number;
  }[];
}

export interface BatteryDegradationData {
  vehicle_id: number;
  current_health: number;
  current_capacity: number;
  current_degradation: number;
  current_range: number;
  current_cycles: number;
  current_temp: number;
  monthly_trend: {
    month: string;
    avg_health: number;
    avg_capacity: number;
    avg_degradation: number;
    avg_range: number;
    max_cycles: number;
    avg_cell_temp: number;
  }[];
  snapshots: {
    id: number;
    health_score: number;
    capacity_wh: number;
    degradation_pct: number;
    est_range_km: number;
    cycle_count: number;
    avg_cell_temp_c: number;
    created_at: string;
  }[];
  charging_habits: {
    fast_charge_count: number;
    slow_charge_count: number;
    deep_discharge_count: number;
    charge_to_full_count: number;
    avg_energy_per_session: number;
  };
  prediction: {
    slope_per_year: number;
    years_to_80_pct: number;
    predicted_date: string;
    has_enough_data: boolean;
    projection_points: { month: string; health: number }[];
  };
  stress_level: string;
  fast_charge_ratio: number;
}

export interface DailyMileage {
  id: number;
  vehicle_id: number;
  date: string;
  distance_km: number;
  odometer_start: number;
  odometer_end: number;
  drive_count: number;
  energy_used_kwh: number;
}

export interface MonthlyMileage {
  month: string;
  distance: number;
  drives: number;
  energy: number;
  odometer: number;
}

export interface MileageStats {
  total_distance: number;
  avg_daily: number;
  max_daily: number;
  total_energy: number;
  total_drives: number;
  days_tracked: number;
}

export interface VampireDrainEvent {
  id: number;
  vehicle_id: number;
  start_date: string;
  end_date: string | null;
  start_battery: number;
  end_battery: number | null;
  battery_lost: number;
  range_lost_km: number;
  duration_hours: number;
  drain_rate_pct_per_hour: number;
  outside_temp_avg: number | null;
  sentry_mode: boolean;
  created_at: string;
}

export interface VampireDrainStats {
  avg_drain_rate: number;
  max_drain_rate: number;
  total_range_lost: number;
  total_hours: number;
  event_count: number;
  avg_sentry_drain: number;
  avg_nosentry_drain: number;
}

export interface VisitedLocation {
  id: number;
  vehicle_id: number;
  address_id: number | null;
  address_name: string;
  visit_count: number;
  total_duration_s: number;
  last_visited: string | null;
  created_at: string;
}

export interface Trip {
  id: number;
  vehicle_id: number;
  name: string | null;
  start_date: string;
  end_date: string | null;
  started_at: string;
  ended_at: string | null;
  total_distance_m: number;
  total_energy_wh: number;
  total_duration_s: number;
  total_cost: number;
  drive_count: number;
  charge_count: number;
  created_at: string;
  created_by_user?: number | null;
  auto_generated?: boolean;
  notes?: string | null;
}

// === Energy ===
/** Fetches energy consumption and efficiency stats for a vehicle. */
export const getEnergyStats = (vehicleId: number, days = 30, start?: string) =>
  request<EnergyStats>(
    `/vehicles/${vehicleId}/energy?${
      start ? `start=${start}` : `days=${days}`
    }`,
  );

// === Battery Health ===
/** Fetches the battery health report including degradation and capacity trends. */
export const getBatteryReport = (vehicleId: number) =>
  request<BatteryReport>(`/vehicles/${vehicleId}/battery`);

// === Fleet Analytics ===
/** Fetches aggregated fleet-wide analytics (drives, charging, efficiency, trends). */
export const getFleetAnalytics = (days = 30, start?: string) =>
  request<FleetAnalytics>(
    `/analytics/fleet?${start ? `start=${start}` : `days=${days}`}`,
  );

// === Charging Heatmap ===
export const getChargingHeatmap = (vehicleId: number) =>
  request<ChargingHeatmapData>(
    `/analytics/charging-heatmap?vehicle_id=${vehicleId}`,
  );

// === Speed Profile ===
export const getSpeedProfile = (vehicleId: number) =>
  request<SpeedProfileData>(`/analytics/speed-profile?vehicle_id=${vehicleId}`);

// === Temperature Impact ===
export const getTemperatureImpact = (vehicleId: number) =>
  request<TemperatureImpactData>(
    `/analytics/temperature-impact?vehicle_id=${vehicleId}`,
  );

// === Route Efficiency ===
export const getRouteEfficiency = (vehicleId: number) =>
  request<RouteEfficiencyData>(
    `/analytics/route-efficiency?vehicle_id=${vehicleId}`,
  );

export const getRouteEfficiencyDetail = (
  vehicleId: number,
  start: string,
  end: string,
) => {
  const params = new URLSearchParams({
    vehicle_id: String(vehicleId),
    start,
    end,
  });
  return request<RouteDetailData>(
    `/analytics/route-efficiency/detail?${params}`,
  );
};

// === True Cost of Ownership (TCO) ===
export const getTCOAnalytics = (vehicleId: number) =>
  request<TCOAnalytics>(`/analytics/tco?vehicle_id=${vehicleId}`);

// === Sleep Efficiency ===
export const getSleepAnalytics = (vehicleId: number, days = 30) =>
  request<SleepAnalytics>(
    `/analytics/sleep?vehicle_id=${vehicleId}&days=${days}`,
  );

// === Regen Braking ===
export const getRegenStats = (vehicleId: number) =>
  request<RegenData>(`/analytics/regen?vehicle_id=${vehicleId}`);

// === Battery Degradation ===
export const getBatteryDegradation = (vehicleId: number) =>
  request<BatteryDegradationData>(
    `/analytics/battery-degradation?vehicle_id=${vehicleId}`,
  );

// === Mileage ===
/** Fetches daily mileage records for a vehicle (up to 365 days). */
export const getDailyMileage = (vehicleId: number, limit = 365, offset = 0) =>
  request<DailyMileage[]>(
    `/mileage/daily?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`,
  );

/** Fetches monthly mileage aggregates for a vehicle. */
export const getMonthlyMileage = (vehicleId: number) =>
  request<MonthlyMileage[]>(`/mileage/monthly?vehicle_id=${vehicleId}`);

/** Fetches lifetime mileage statistics for a vehicle. */
export const getMileageStats = (vehicleId: number) =>
  request<MileageStats>(`/mileage/stats?vehicle_id=${vehicleId}`);

// === Vampire Drain ===
/** Fetches vampire drain events for a vehicle, optionally filtered by date range. */
export const getVampireDrainEvents = (
  vehicleId: number,
  limit = 100,
  offset = 0,
  start?: string,
  end?: string,
) => {
  const params = new URLSearchParams({
    vehicle_id: String(vehicleId),
    limit: String(limit),
    offset: String(offset),
  });
  if (start) {
    params.append('start', start);
  }
  if (end) {
    params.append('end', end);
  }
  return request<VampireDrainEvent[]>(`/vampire-drain?${params}`);
};

/** Fetches aggregate vampire drain statistics (avg/max rate, total range lost). */
export const getVampireDrainStats = (vehicleId: number) =>
  request<VampireDrainStats>(`/vampire-drain/stats?vehicle_id=${vehicleId}`);

// === Visited Locations ===
/** Fetches frequently visited locations, optionally filtered by vehicle. */
export const getVisitedLocations = (
  vehicleId?: number,
  limit = 100,
  offset = 0,
) =>
  request<VisitedLocation[]>(
    `/locations?${
      vehicleId ? `vehicle_id=${vehicleId}&` : ''
    }limit=${limit}&offset=${offset}`,
  );

// === Trips ===
/** Fetches multi-drive trips, optionally filtered by vehicle and date range. */
export const getTrips = (
  vehicleId?: number,
  limit = 50,
  offset = 0,
  start?: string,
  end?: string,
) => {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (vehicleId) {
    params.append('vehicle_id', String(vehicleId));
  }
  if (start) {
    params.append('start', start);
  }
  if (end) {
    params.append('end', end);
  }
  return request<Trip[]>(`/trips?${params}`);
};
