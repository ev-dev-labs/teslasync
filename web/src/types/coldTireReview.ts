export type ColdTireCorner = 'front_left' | 'front_right' | 'rear_left' | 'rear_right';

export interface ColdTireReading {
  observed_at: string;
  ambient_c: number;
  front_left_pa: number;
  front_right_pa: number;
  rear_left_pa: number;
  rear_right_pa: number;
  cold_gauge_confirmed: true;
}

export interface ColdTireDrift {
  corner: ColdTireCorner;
  count: number;
  baseline_at: string;
  observed_at: string;
  expires_at: string;
  relative_drop_pa: number;
  last_gauge_pressure_pa: number;
}

export interface ColdTireReview {
  series_id: number;
  reading_count: number;
  last_reading_at?: string;
  drift: ColdTireDrift | null;
}
