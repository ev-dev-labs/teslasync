export interface TripReviewSetup {
  journey_id: number
  plan_version: number
  origin_updated_at: string
  destination_id: number
  destination_updated_at: string
  stop_place_id: number | null
  stop_place_updated_at: string | null
  planned_arrival_pct: number
  planned_stop_s: number
}

export interface TripReviewAdjustment {
  saved_at: string
  extra_stop_s: number
  extra_arrival_pct: number
}

export interface TripReviewComparison {
  arrived_at: string
  expires_at: string
  planned_arrival_pct: number
  observed_arrival_pct: number
  planned_stop_s: number
  observed_stop_s: number
  observed_charge_s: number
}

export interface TripReviewState {
  has_setup: boolean
  setup: TripReviewSetup | null
  review: TripReviewComparison | null
  adjustment_key?: string
  adjustment: TripReviewAdjustment | null
  similar_adjustment: (TripReviewAdjustment & { expires_at: string }) | null
}
