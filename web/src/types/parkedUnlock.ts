export interface ParkedUnlockRisk {
  park_id: number;
  parked_at: string;
  unlocked_since: string;
  last_observed_at: string;
  expires_at: string;
}

export interface ParkedUnlockPlan {
  id: number;
  place_id: number;
  place_revision: string;
  place_name?: string;
  place_ready: boolean;
  paused: boolean;
  snoozed_until?: string;
  reason: 'monitoring' | 'place_changed' | 'unknown_state' | 'outside_place' | 'locked' | 'grace_period' | 'parked_unlocked';
  device_ready: boolean;
  risk?: ParkedUnlockRisk;
}

export interface ParkedUnlockStatus {
  available: boolean;
  plan: ParkedUnlockPlan | null;
}

export interface ParkedUnlockSetup {
  confirmed: boolean;
  place_id: number;
  place_revision: string;
  device_id: number;
  push_title: string;
  push_body: string;
}
