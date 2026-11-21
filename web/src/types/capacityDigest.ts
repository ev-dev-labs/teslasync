export interface CapacityRange {
  low_wh: number;
  high_wh: number;
}

export interface CapacityDigest {
  baseline_from: string;
  recent_from: string;
  recent_to: string;
  observed_to: string;
  expires_at: string;
  baseline: CapacityRange;
  recent: CapacityRange;
  change: CapacityRange;
  baseline_days: number;
  recent_days: number;
}

export interface CapacityDigestSettings {
  plan: {
    id: number;
    time_zone: string;
    paused: boolean;
    digest?: CapacityDigest;
  } | null;
}
