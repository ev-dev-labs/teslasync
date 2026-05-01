export interface Vehicle {
  id: number;
  vehicle_id: number;
  vin: string;
  display_name: string;
  model: string;
  trim_badging: string;
  exterior_color: string;
  wheel_type: string;
  state: string;
  healthy: boolean;
  /** IANA tz database name (e.g. "America/Los_Angeles"). 'UTC' = unknown / not yet learned. */
  timezone?: string;
  created_at: string;
  updated_at: string;
  // Extended fields (from vehicle detail/state endpoints)
  battery_level?: number;
  battery_range?: number;
  odometer?: number;
  latitude?: number;
  longitude?: number;
  charging_state?: string;
  // camelCase aliases (populated by API response transformer)
  vehicleId?: number;
  displayName?: string;
  trimBadging?: string;
  exteriorColor?: string;
  wheelType?: string;
  createdAt?: string;
  updatedAt?: string;
  batteryLevel?: number;
  batteryRange?: number;
  chargingState?: string;
}
