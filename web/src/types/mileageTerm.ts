export interface MileageTermSettings {
  id: number;
  time_zone: string;
  first_day: string;
  end_day: string;
  opening_odometer_m: number;
  allowance_m: number;
  minimum_overage_m: number;
  paused: boolean;
}

export interface MileageTermDigest {
  through: string;
  checked_at: string;
  expires_at: string;
  projection: {
    evidence_from: string;
    observed_at: string;
    observed_days: number;
    used_m: number;
    allowed_to_date_m: number;
    lower_m: number;
    upper_m: number;
  };
}

export interface MileageTermReview {
  settings: MileageTermSettings | null;
  digest: MileageTermDigest | null;
  last_checked_at: string | null;
  next_check_at: string | null;
}
