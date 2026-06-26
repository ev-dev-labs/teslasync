// Native parity port of web/src/types/vehicle.ts.
//
// Pure TypeScript wire-type declarations for the vehicle domain — no DOM,
// React, Recharts, Leaflet, browser APIs, or runtime imports — so the single
// exported interface is ported 1:1 with identical names, members, types,
// optionality, and field names (contract rules 3 & 6). Both the snake_case
// fields (matching the Go JSON tags) and the camelCase aliases (populated by
// the API response transformer) are preserved verbatim so consuming native
// hooks/screens reference identical fields. SI-canonical numeric fields are
// kept as-is; any display-unit conversion happens only at the render boundary.

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
