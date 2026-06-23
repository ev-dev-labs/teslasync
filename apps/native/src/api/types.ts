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
  timezone?: string;
  created_at: string;
  updated_at: string;
}

export interface Alert {
  id: number;
  vehicle_id?: number | null;
  type?: string | null;
  severity: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface SystemStatus {
  status?: string;
  healthy?: boolean;
  version?: string;
  uptime?: string;
  services?: Record<string, string | boolean | number | null>;
}
