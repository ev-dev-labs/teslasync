// Native parity port of
// web/src/features/analytics/components/weekly-digest/types.ts.
//
// Pure TypeScript type declarations for the Analytics Weekly Digest — no DOM,
// React, browser APIs, or imports — so every exported interface name, member,
// type, and optionality is ported 1:1 from the web source (contract rules 3 &
// 6). The snake_case API field names (start_date, duration_min,
// efficiency_wh_km, total_energy_added_wh, start_ts, …) mirror the Go struct
// JSON tags and are preserved verbatim to keep API/data-shape parity.

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
  total_energy_added_wh: number;
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
