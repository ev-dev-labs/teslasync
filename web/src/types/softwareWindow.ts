export interface SoftwareWindowSetup {
  departure_at: string;
  version: string;
  estimated_duration_s: number;
  checked_ready_unscheduled: boolean;
}

export type SoftwareWindowReason = 'missing_evidence' | 'update_not_ready' | 'not_observed_idle'
  | 'insufficient_margin' | 'held' | 'expired' | 'fits';

export interface SoftwareWindowPlan {
  id: number;
  vehicle_id: number;
  departure_at: string;
  confirmed_at: string;
  version: string;
  estimated_duration_s: number;
  paused: boolean;
  snoozed_until?: string;
  reason: SoftwareWindowReason;
  review?: {
    margin_s: number;
    parked_at: string;
    idle_observed_from: string;
    last_idle_observed_at: string;
    update_observed_at: string;
    action_until: string;
  };
}

export interface SoftwareWindowStatus {
  plan: SoftwareWindowPlan | null;
  available: boolean;
}
