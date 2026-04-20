export interface ClimateState {
  id: string;
  vehicleId: string;
  insideTemp: number;
  outsideTemp: number;
  hvacPower: number;
  fanSpeed: number;
  driverTempSetting: number;
  passengerTempSetting: number;
  isAcOn: boolean;
  isAutoClimate: boolean;
  climateKeeperMode: string;
  defrostMode: boolean;
  batteryHeater: boolean;
  steeringWheelHeat: boolean;
  seatHeaterLeft: number;
  seatHeaterRight: number;
  seatHeaterRearLeft: number;
  seatHeaterRearRight: number;
  seatHeaterRearCenter: number;
  overheatProtection: string;
  timestamp: string;
}

export interface TirePressureReading {
  id: string;
  vehicleId: string;
  frontLeft: number;
  frontRight: number;
  rearLeft: number;
  rearRight: number;
  tpmsHardWarning: boolean;
  tpmsSoftWarning: boolean;
  timestamp: string;
}

export type TirePosition = 'frontLeft' | 'frontRight' | 'rearLeft' | 'rearRight';

export type TireStatus = 'normal' | 'warning' | 'critical';

export interface MaintenanceItem {
  id: string;
  name: string;
  description: string;
  intervalKm: number;
  intervalMonths: number;
  category: string;
  estimatedCostUsd: number;
}

export interface ServiceRecord {
  itemId: string;
  date: string;
  odometerKm: number;
  notes: string;
}

export type MaintenanceStatus = 'good' | 'soon' | 'overdue';

export interface SoftwareUpdate {
  id: string;
  vehicleId: string;
  version: string;
  status: 'installed' | 'installing' | 'downloading' | 'available' | 'scheduled';
  installedAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
}

export interface SafetySnapshot {
  id: number;
  vehicle_id: number;
  automatic_blind_spot_camera?: boolean | null;
  automatic_emergency_braking_off?: boolean | null;
  blind_spot_collision_warning?: boolean | null;
  cruise_follow_distance?: string | null;
  emergency_lane_departure_avoidance?: boolean | null;
  forward_collision_warning?: string | null;
  lane_departure_avoidance?: string | null;
  speed_limit_warning?: string | null;
  pin_to_drive_enabled?: boolean | null;
  miles_since_reset?: number | null;
  self_driving_miles_since_reset?: number | null;
  created_at: string;
}

export interface MediaSnapshot {
  id: string;
  vehicleId: string;
  title: string;
  artist: string;
  album: string;
  station: string;
  source: string;
  playbackStatus: string;
  volume: number;
  volumeMax: number;
  elapsed: number;
  duration: number;
  timestamp: string;
}
