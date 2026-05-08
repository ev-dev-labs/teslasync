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

export interface MileageStats {
  totalDistance: number;
  avgDaily: number;
  maxDaily: number;
  totalEnergy: number;
  totalDrives: number;
  daysTracked: number;
}

export interface MonthlyStat {
  month: string;
  distance: number;
  drives: number;
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
