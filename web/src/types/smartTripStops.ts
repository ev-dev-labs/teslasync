export interface TripStopWait {
  arrived_at: string
  wait_s: number
}

export interface TripStopInput {
  place_id: number
  place_updated_at: string
  time_zone: string
  waits: TripStopWait[]
}

export interface TripStopSetup {
  plan_version: number
  origin_updated_at: string
  destination_place_id: number
  destination_updated_at: string
  capacity_wh: number
  start_pct: number
  limit_pct: number
  high_usage_wh_per_m: number
  stops: TripStopInput[]
}

export interface TripStopResult {
  compared_at: string
  expires_at: string
  stops: Array<{
    place_id: number
    place_name: string
    detour_m: number
    detour_s: number
    arrive_at: string
    station_arrival_wh: number
    destination_charge_wh: number
    expected_wait_s: number
    estimated_charge_s: number
    wait_sample_count: number
    charge_sample_count: number
  }>
}

export interface TripStopSettings {
  available: boolean
  has_setup: boolean
  setup: TripStopSetup | null
  result: TripStopResult | null
  next_check_at: string | null
}
