export interface WarrantyDistanceProjection {
  warranty_id: number;
  vehicle_id: number;
  recorded_at: string;
  evidence_from: string;
  observed_days: number;
  remaining_m: number;
  pace_mps: number;
  earliest_limit_at: string;
  latest_limit_at: string;
  documented_term_end: string;
  expires_at: string;
}

export interface WarrantyReminderSettings {
  enabled: boolean;
  start_odometer_known?: boolean;
  projection: WarrantyDistanceProjection | null;
}
