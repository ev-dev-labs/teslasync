/** Read-only, drive-scoped detection over sparse Tesla Fleet Telemetry. */
export interface RoadAnomalyCandidate {
  ts: string;
  latitude: number;
  longitude: number;
  speed_mps: number;
  peak_jerk_g_per_s: number;
}

export interface RoadAnomalyResponse {
  drive_id: number;
  status: 'insufficient_data' | 'no_candidates' | 'candidates';
  analyzed_samples: number;
  candidates: RoadAnomalyCandidate[];
  limitations: string[];
}
