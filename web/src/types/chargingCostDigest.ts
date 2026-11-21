export interface ChargingCostDigestSettings {
  id: number;
  time_zone: string;
  currency: string;
  material_change_minor: number;
  paused: boolean;
}

export interface ChargingCostCoverage {
  sessions: number;
  recorded_costs: number;
  compared_sessions: number;
  recorded_spend_minor: number;
  compared_spend_minor: number;
  recorded_distance_m?: number;
}

export interface ChargingCostDigest {
  prior_from: string;
  current_from: string;
  through: string;
  checked_at: string;
  expires_at: string;
  attribution: {
    currency: string;
    prior: ChargingCostCoverage;
    current: ChargingCostCoverage;
    comparable_sites: number;
    distance_minor: number;
    purchase_intensity_minor: number;
    site_mix_minor: number;
    effective_price_minor: number;
    unattributed_minor: number;
  };
}

export interface ChargingCostReview {
  settings?: ChargingCostDigestSettings;
  last_checked_at?: string;
  digest?: ChargingCostDigest;
}
