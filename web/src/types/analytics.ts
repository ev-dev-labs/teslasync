export interface AnalyticsSummary {
  totalVehicles: number;
  totalDrives: number;
  totalChargingSessions: number;
  totalDistanceKm: number;
  totalEnergyKwh: number;
  totalCost: number;
  avgEfficiencyWhKm: number;
  co2SavedKg: number;
  vehicleComparison: VehicleComparisonEntry[];
}

export interface VehicleComparisonEntry {
  id: string;
  name: string;
  distance: number;
  energy: number;
  efficiency: number;
}

/**
 * MileageStats matches the backend `MileageStatsResponse`
 * (internal/api/mileage_handler.go) — Phase-43a / Prompt 0004
 * restored the endpoint with the snake_case lifetime + window
 * rollup shape. Distances are kilometres (SI conversion happens
 * in the SELECT list); times are RFC3339 strings nullable for
 * vehicles with zero recorded drives.
 */
export interface MileageStats {
  vehicle_id: number;
  lifetime_km: number;
  last_7d_km: number;
  last_30d_km: number;
  last_365d_km: number;
  drive_count_lifetime: number;
  drive_count_30d: number;
  first_drive_at: string | null;
  last_drive_at: string | null;
}

/**
 * MonthlyMileageBucket matches the backend `MileageMonthlyBucket`
 * (internal/api/mileage_handler.go) — one bucket per UTC calendar
 * month, year_month rendered as 'YYYY-MM', distances in kilometres,
 * energy in watt-hours.
 */
export interface MonthlyMileageBucket {
  year_month: string;
  drive_count: number;
  total_km: number;
  total_wh_consumed: number | null;
  avg_efficiency_wh_per_km: number | null;
}

/** Envelope returned by GET /mileage/monthly. */
export interface MonthlyMileageResponse {
  vehicle_id: number;
  months: MonthlyMileageBucket[];
}

/**
 * DailyMileageBucket matches the backend `MileageDailyBucket`
 * (internal/api/mileage_handler.go) — Phase-43a / Prompt 0009
 * (fix/misc-fixes) restored per-day buckets so MileagePage can
 * render its Odometer Over Time and Daily Distance charts.
 * Date is 'YYYY-MM-DD'; end_odometer_km is null when no qualifying
 * drive in the bucket recorded a final odometer reading.
 */
export interface DailyMileageBucket {
  date: string;
  drive_count: number;
  total_km: number;
  end_odometer_km: number | null;
}

/** Envelope returned by GET /mileage/daily. */
export interface DailyMileageResponse {
  vehicle_id: number;
  days: DailyMileageBucket[];
}

export interface CostBreakdown {
  total_charging_cost: number;
  total_wh: number;
  total_sessions: number;
  total_km: number;
  first_date: string;
  last_date: string;
  equivalent_gas_cost: number;
  total_savings: number;
  monthly_savings: number;
  cost_per_km_ev: number;
  cost_per_km_ice: number;
  maintenance_savings_estimate: number;
  months_of_ownership: number;
  gas_price: number;
  gas_efficiency_mpg: number;
  monthly_breakdown: MonthlyCostEntry[];
}

export interface MonthlyCostEntry {
  month: string;
  ev_cost: number;
  equiv_gas_cost: number;
  cumulative_savings: number;
  energy_wh: number;
}

export interface TimelineEvent {
  id: string;
  state: string;
  startDate: string;
  durationMin: number;
}

export interface StateSummary {
  state: string;
  totalMin: number;
  count: number;
}

export interface WeeklyDigestData {
  drives: number;
  distanceKm: number;
  energyKwh: number;
  cost: number;
  efficiency: number;
  prevDrives: number;
  prevDistanceKm: number;
  prevEnergyKwh: number;
  prevCost: number;
  prevEfficiency: number;
}
