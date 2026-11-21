import type { BillingPeriod, UsageMetric } from './ownership';

export interface RenewalTerms {
  renewal_day: string;
  time_zone: string;
  lead_days: number;
}

export interface RenewalPlan extends RenewalTerms {
  revision: string;
  subscription_version: number;
  paused: boolean;
  next_check_at: string | null;
}

export interface RenewalReview {
  renewal_day: string;
  expires_at: string;
  name: string;
  price_minor: number;
  currency: string;
  billing_period: BillingPeriod;
  evidence: {
    from: string;
    through: string;
    metric: UsageMetric;
    quantity: number | null;
    observed_days: number;
    excluded: number;
    coverage: 'observed_only' | 'no_evidence' | 'not_measured' | 'uncertain_coverage';
  };
}

export interface RenewalState {
  plan: RenewalPlan | null;
  review: RenewalReview | null;
  needs_review: boolean;
  dismissed: boolean;
}
