export interface RecallWatchSetup {
  model: string;
  model_year: number;
}

export interface RecallCampaignMatch extends RecallWatchSetup {
  campaign: string;
  component: string;
  remedy: string;
  source_url: string;
  reported_at: string;
  checked_at: string;
  fresh_until: string;
  verify_vin_url: string;
}

export interface RecallWatch {
  id: number;
  setup: RecallWatchSetup;
  last_success: string | null;
  last_failed: boolean;
  matches: RecallCampaignMatch[] | null;
}
