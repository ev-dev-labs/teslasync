export interface ParkReserveSetup {
  return_at: string;
  reserve_pct: number;
  push_device_id?: number;
  push_title?: string;
  push_body?: string;
}

export interface ParkReservePlan {
  id: number;
  vehicle_id: number;
  return_at: string;
  action_until: string;
  reserve_pct: number;
  push_device_id?: number;
  push_device_ready: boolean;
  reason?: 'invalid_plan' | 'unknown_state' | 'insufficient_comparable_parks' | 'reserve_not_crossed'
    | 'already_below_reserve' | 'estimated_reserve_crossing' | 'park_conditions_changed' | 'expired';
  estimate?: {
    observed_at: string;
    comparable_episodes: number;
    start_battery_pct: number;
    return_low_pct: number;
    return_high_pct: number;
    reserve_risk: boolean;
  };
}

export interface ParkReserveStatus {
  plan: ParkReservePlan | null;
  setup_available: boolean;
  push_available: boolean;
}
