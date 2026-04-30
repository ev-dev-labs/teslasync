export interface Drive {
  id: number;
  start_date: string;
  distance: number;
  duration_min: number;
  efficiency_wh_km: number;
  energy_used: number;
}

export interface ChargingSession {
  id: number;
  start_ts: string;
  energy_added_kwh: number;
  cost: number;
  duration_min: number;
  start_battery_pct: number;
  end_battery_pct: number;
}

export interface Alert {
  id: number;
  severity: string;
  created_at: string;
}

export interface DigestMetrics {
  totalDistance: number;
  prevDistance: number;
  totalDrives: number;
  prevDriveCount: number;
  energyUsed: number;
  prevEnergy: number;
  chargingCost: number;
  prevChargingCost: number;
  co2Saved: number;
  prevCo2: number;
  avgEfficiency: number;
  prevAvgEfficiency: number;
  totalDuration: number;
  topDrive: Drive | undefined;
  chargeEnergyAdded: number;
  prevChargeEnergy: number;
  avgChargeRate: number;
  chargingSessionCount: number;
  batteryStart: number;
  batteryEnd: number;
  alertsByType: Record<string, number>;
  alertTotal: number;
}

export interface FunFact {
  from: string;
  to: string;
  times: string;
}

export interface DailyDistanceEntry {
  day: string;
  distance: number;
}

export interface DailyEnergyEntry {
  day: string;
  energy: number;
}

export interface AlertPieEntry {
  name: string;
  value: number;
  color: string;
}
