export interface ClimateState {
  id?: number;
  created_at?: string;
  timestamp?: string;
  // Temperatures (°C from Fleet Telemetry)
  insideTemp?: number | null;
  outsideTemp?: number | null;
  driverTempSetting?: number | null;
  passengerTempSetting?: number | null;
  // HVAC system
  hvacPower?: string | null;
  isAcOn?: boolean | null;
  hvacAutoMode?: string | null;
  fanSpeed?: number | null;
  hvacFanStatus?: number | null;
  // Climate modes
  climateKeeperMode?: string | null;
  defrostMode?: string | null;
  defrostForPreconditioning?: boolean | null;
  rearDefrostEnabled?: boolean | null;
  wiperHeatEnabled?: boolean | null;
  rearDisplayHvacEnabled?: boolean | null;
  // Battery & protection
  batteryHeater?: boolean | null;
  overheatProtection?: string | null;
  cabinOverheatProtectionTempLimit?: string | null;
  // Steering wheel
  hvacSteeringWheelHeatAuto?: boolean | null;
  hvacSteeringWheelHeatLevel?: number | null;
  // Seat heaters
  seatHeaterLeft?: number | null;
  seatHeaterRight?: number | null;
  seatHeaterRearLeft?: number | null;
  seatHeaterRearRight?: number | null;
  seatHeaterRearCenter?: number | null;
  // Seat climate
  autoSeatClimateLeft?: boolean | null;
  autoSeatClimateRight?: boolean | null;
  climateSeatCoolingFrontLeft?: number | null;
  climateSeatCoolingFrontRight?: number | null;
  seatVentEnabled?: boolean | null;
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
