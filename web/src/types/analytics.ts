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
  totalChargingCost: number;
  totalKwh: number;
  equivalentGasCost: number;
  totalSavings: number;
  monthlySavings: number;
  costPerKmEv: number;
  costPerKmIce: number;
  maintenanceSavingsEstimate: number;
  monthsOfOwnership: number;
  monthlyBreakdown: MonthlyCostEntry[];
}

export interface MonthlyCostEntry {
  month: string;
  evCost: number;
  equivGasCost: number;
  cumulativeSavings: number;
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
