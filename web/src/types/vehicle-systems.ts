/**
 * Vehicle-systems wire types — the query surface behind useVehicleSystems.ts
 * (climate, tire pressure, maintenance, service records, software updates,
 * safety).
 *
 * Two key-casing conventions live here on purpose, mirroring how each shape is
 * read at runtime:
 *
 *  - camelCase shapes (ClimateState, TirePressureReading, MaintenanceItem,
 *    ServiceRecord, SoftwareUpdate) name the camelCase MIRROR that the shared
 *    request() client adds. The backend emits snake_case JSON; client.ts runs
 *    camelCaseKeys() (lib/resilience.ts) which KEEPS every snake_case key AND
 *    adds a camelCase alias pointing at the same value, so `inside_temp` and
 *    `insideTemp` both resolve. These interfaces declare the camelCase alias.
 *  - snake_case shape (SafetySnapshot) mirrors the Go JSON tags 1:1, matching
 *    the /safety/latest handler which serializes raw signal values verbatim.
 *
 * SafetySnapshot's ADAS enum fields are deliberately typed `string | boolean |
 * number | null`: the backend forwards raw signal.SignalValue, so the same
 * field can arrive as a typed enum string, a native boolean toggle, or a
 * legacy numeric. NEVER call `.toLowerCase()`/`.startsWith()` on them directly
 * — funnel through cleanSafetyEnum() / isSafetyEnumActive() in lib/safetyEnum.ts.
 *
 * Phase-48 (SI canonical): the `*_mi`/`miles_*` fields below are grandfathered.
 * Do NOT add new unit-suffixed fields — new distances are meters, speeds m/s.
 */

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
  hvacPower?: boolean | null;
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
  id?: number;
  vehicle_id?: number;
  automatic_blind_spot_camera?: boolean | null;
  automatic_emergency_braking_off?: boolean | null;
  blind_spot_collision_warning?: boolean | null;
  // Backend serializes raw signal.SignalValue (interface{}) so these enum
  // fields may arrive as `string`, native `boolean`, or `number`.
  // Always run through cleanSafetyEnum() / isSafetyEnumActive() — never
  // call .startsWith/.toLowerCase directly. See lib/safetyEnum.ts.
  cruise_follow_distance?: string | boolean | number | null;
  emergency_lane_departure_avoidance?: boolean | null;
  forward_collision_warning?: string | boolean | number | null;
  lane_departure_avoidance?: string | boolean | number | null;
  speed_limit_warning?: string | boolean | number | null;
  pin_to_drive_enabled?: boolean | null;
  miles_since_reset?: number | null;
  self_driving_miles_since_reset?: number | null;
  created_at?: string;
}
