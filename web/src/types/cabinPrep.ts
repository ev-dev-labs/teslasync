export interface CabinPrepEstimate {
  comparable_mornings: number;
  lead_low_s: number;
  lead_high_s: number;
  observed_at: string;
  target_c: number;
}

export interface CabinPrepPlan {
  id: number;
  vehicle_id: number;
  departure_at: string;
  time_zone: string;
  target_c: number;
  push_device_id: number;
  push_device_ready: boolean;
  setup_available: boolean;
  reason?: 'eligible' | 'invalid_plan' | 'unknown_state' | 'already_active'
    | 'within_comfort_band' | 'insufficient_comparable_mornings' | 'variable_prep_time'
    | 'departure_observed' | 'changed_conditions' | 'expired';
  estimate?: CabinPrepEstimate;
  expires_at?: string;
}

export interface CabinPrepSetup {
  departure_at: string;
  time_zone: string;
  target_c: number;
  push_device_id: number;
  push_title: string;
  push_body: string;
}
