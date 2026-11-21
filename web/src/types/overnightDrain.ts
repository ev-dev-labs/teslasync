export type OvernightFactor = 'sentry' | 'climate' | 'wake_requested';

export interface OvernightDrainReview {
  morning_at: string;
  expires_at: string;
  start_at: string;
  end_at: string;
  measured_loss_pct: number;
  typical_loss_low_pct: number;
  typical_loss_high_pct: number;
  comparable_nights: number;
  factors: { kind: OvernightFactor; observed_at: string }[];
}

export interface OvernightDrainPlan {
  id: number;
  time_zone: string;
  paused: boolean;
  review?: OvernightDrainReview;
}

export interface OvernightDrainSettings {
  plan: OvernightDrainPlan | null;
}
