export interface MonthlyTariffSettings {
  id: number;
  site_id: number;
  site_revision: string;
  current_tariff_id: number;
  current_version: number;
  alternative_tariff_id: number;
  alternative_version: number;
  time_zone: string;
  minimum_savings_minor: number;
  switch_fee_minor: number;
  paused: boolean;
}

export interface MonthlyTariffCostRange {
  lower_minor: number;
  upper_minor: number;
}

export interface MonthlyTariffDigest {
  from: string;
  through: string;
  checked_at: string;
  expires_at: string;
  comparison: {
    days: number;
    sessions: number;
    energy_wh: number;
    current: MonthlyTariffCostRange;
    alternative: MonthlyTariffCostRange;
    current_fixed_minor: number;
    alternative_fixed_minor: number;
    switch_fee_minor: number;
    net_savings: MonthlyTariffCostRange;
  };
}

export interface MonthlyTariffReview {
  settings?: MonthlyTariffSettings;
  last_checked_at?: string;
  needs_review: boolean;
  currency?: string;
  site_name?: string;
  current_name?: string;
  alternative_name?: string;
  digest?: MonthlyTariffDigest;
}
