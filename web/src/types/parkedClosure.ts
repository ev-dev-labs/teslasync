export type ParkedClosurePosition =
  | 'driver_front_door' | 'passenger_front_door' | 'driver_rear_door' | 'passenger_rear_door'
  | 'front_trunk' | 'rear_trunk';

export interface ParkedClosureRisk {
  park_id: number;
  position: ParkedClosurePosition;
  parked_at: string;
  open_since: string;
  last_observed_at: string;
  expires_at: string;
}

export interface ParkedClosurePlan {
  id: number;
  grace_s: number;
  paused: boolean;
  snoozed_until?: string;
  reason: 'monitoring' | 'unknown_state' | 'active_use' | 'all_closed' | 'grace_period' | 'parked_closure_open';
  device_ready: boolean;
  risk?: ParkedClosureRisk;
}

export interface ParkedClosureStatus {
  available: boolean;
  plan: ParkedClosurePlan | null;
}

export interface ParkedClosureSetup {
  grace_s: number;
  confirmed: boolean;
  device_id: number;
  push_title: string;
  push_body: string;
}
