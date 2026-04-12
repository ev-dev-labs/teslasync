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
  created_at: string;
  updated_at: string;
  // Extended fields (from vehicle detail/state endpoints)
  battery_level?: number;
  battery_range?: number;
  odometer?: number;
  latitude?: number;
  longitude?: number;
  charging_state?: string;
}
