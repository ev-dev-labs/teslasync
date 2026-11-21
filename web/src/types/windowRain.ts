export type WindowRainReason = 'monitoring' | 'unknown_state' | 'park_changed' | 'no_fresh_open_window'
  | 'weather_unavailable' | 'no_rain_risk' | 'window_rain_risk' | 'expired';

export interface WindowRainRisk {
  window: {
    position: 'front_driver' | 'front_passenger' | 'rear_driver' | 'rear_passenger';
    observed_at: string;
  };
  forecast_at: string;
  risk_start_at: string;
  risk_end_at: string;
  expires_at: string;
}

export interface WindowRainPlan {
  id: number;
  created_at: string;
  watch_until: string;
  paused: boolean;
  reason: WindowRainReason;
  device_ready: boolean;
  risk?: WindowRainRisk;
}

export interface WindowRainStatus {
  available: boolean;
  plan: WindowRainPlan | null;
}

export interface WindowRainSetup {
  duration_s: number;
  device_id: number;
  push_title: string;
  push_body: string;
  outdoor_confirmed: boolean;
  forecast_consent: boolean;
  free_terms_apply: boolean;
}
