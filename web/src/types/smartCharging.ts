export interface SmartChargingTripLegs {
  outbound_use_low_pct: number
  outbound_use_high_pct: number
  return_use_low_pct: number
  return_use_high_pct: number
  destination_charge_pct: number | null
}

export interface SmartChargingTripProjection {
  starting_battery_pct: number
  destination_low_pct: number
  destination_high_pct: number
  destination_reachability: 'estimated_reachable' | 'uncertain' | 'unreachable'
  return_low_pct: number | null
  return_high_pct: number | null
  return_reachability: 'estimated_reachable' | 'uncertain' | 'unreachable' | 'unknown'
  destination_charge_pct: number | null
}

export interface SmartChargingPlanInput {
  vehicle_id: number
  charging_place_id: number | null
  enabled: boolean
  notify_at: string
  departure_at: string
  scheduled_start?: { at: string; time_zone: string }
  trip_use_low_pct: number
  trip_use_high_pct: number
  trip_legs?: SmartChargingTripLegs
  reserve_pct: number
  compare_site_rates?: boolean
}

export interface SmartChargingPlan extends SmartChargingPlanInput {
  id: number
  version?: number
  snoozed_until: string | null
  created_at: string
  updated_at: string
}

export interface SmartChargingLatestStart {
  plan_id: number
  plan_version?: number
  vehicle_id: number
  status: 'unavailable' | 'sufficient' | 'unachievable' | 'estimate' | 'overdue'
  reason?: 'unknown_state' | 'not_charging' | 'unknown_location' | 'outside_site'
  required_low_pct: number
  required_high_pct: number
  charging_power_w: number
  earliest_safe_start_at?: string
  latest_safe_start_at?: string
  observed_at?: string
  expires_at?: string
  trip_projection?: SmartChargingTripProjection
  cost_comparison?: {
    lower_rate_start_at: string
    required_energy_wh: number
    cost_now_decimal: string
    cost_later_decimal: string
    saving_decimal: string
    currency: string
  }
}
