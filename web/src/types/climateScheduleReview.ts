export interface ClimateScheduleEvidence {
  week_of: string;
  expires_at: string;
  observed_through: string;
  run_times: string[];
}

export interface ClimateScheduleOption {
  id: number;
  name: string;
  cron: string;
  time_zone: string;
  updated_at: string;
}

export interface ClimateScheduleSettings {
  options: ClimateScheduleOption[];
  plan?: {
    id: number;
    automation_id: number;
    current: boolean;
    evidence?: ClimateScheduleEvidence;
  };
}
