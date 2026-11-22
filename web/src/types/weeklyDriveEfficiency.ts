interface ObservedIntensity {
  low_wh_per_m: number;
  high_wh_per_m: number;
}

export interface WeeklyDriveDigest {
  reference_drive_id: number;
  baseline_from: string;
  recent_from: string;
  recent_until: string;
  observed_until: string;
  expires_at: string;
  baseline_days: number;
  recent_days: number;
  baseline: ObservedIntensity;
  recent: ObservedIntensity;
  higher: boolean;
}

export interface WeeklyDriveEfficiencyState {
  plan: {
    revision: number;
    time_zone: string;
    paused: boolean;
    next_check_at: string | null;
  } | null;
  digest: WeeklyDriveDigest | null;
  dismissed: boolean;
  review_allowed_until?: string | null;
}
