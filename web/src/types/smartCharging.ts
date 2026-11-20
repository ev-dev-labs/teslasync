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
  scheduled_start?: { at: string; time_zone: string; power_ceiling_w?: number }
  service_appointment?: SmartDepartureWindow
  software_install?: SmartDepartureWindow
  departure_overlap_push?: boolean
  trip_use_low_pct: number
  trip_use_high_pct: number
  trip_legs?: SmartChargingTripLegs
  reserve_pct: number
  compare_site_rates?: boolean
}

export interface SmartDepartureWindow {
  starts_at: string
  ends_at: string
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
export interface SmartChargingSitePerformanceReview {
  charging_place_id: number
  place_name: string
  vehicle_id: number
  latest_session_id: number
  baseline_from_at: string
  observed_at: string
  expires_at: string
  recent_count: number
  baseline_count: number
  recent_w: number
  baseline_w: number
}

export interface SmartChargingSitePerformanceSettings {
  scope: { charging_place_id: number; place_name: string; vehicle_id: number } | null
  review: SmartChargingSitePerformanceReview | null
}

export interface SmartPublicFeeTerms {
  vehicle_id: number
  place_id: number
  place_updated_at: string
  confirmed_unconditional: boolean
  currency: string
  fee_per_minute_minor: number
  grace_s: number
  source_url: string
  confirmed_at: string
  valid_until: string
  push_device_id?: number
}

export interface SmartPublicFeeTermsInput extends Omit<SmartPublicFeeTerms, 'confirmed_at'> {
  confirmed_public_site: boolean
  push_title?: string
  push_body?: string
}

export interface SmartPublicFeeDecision {
  terms: SmartPublicFeeTerms
  session_id: number
  completion_observed_at: string
  earliest_fee_starts_at: string
  observed_at: string
  expires_at: string
}

export interface SmartSolarDecision {
  minimum_export_w: number
  charge_limit_pct: number
  battery_pct: number
  backup_pct: number
  reserve_pct: number
  sample_count: number
  sample_start: string
  observed_at: string
  expires_at: string
}
