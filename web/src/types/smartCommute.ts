export interface SmartCommutePoint {
  latitude: number
  longitude: number
}

export interface SmartCommuteSettings {
  vehicle_id: number
  enabled: boolean
  local_analysis_enabled: boolean
  paused: boolean
  time_zone: string
}

export interface SmartCommuteEvidence {
  matching_days: number
  window_start_s: number
  window_end_s: number
  first_observed_at: string
  last_observed_at: string
}

export interface SmartCommuteRoutine {
  id: number
  vehicle_id: number
  status: 'suggested' | 'confirmed' | 'declined'
  name: string
  weekday: number
  departure_s: number
  time_zone: string
  origin: SmartCommutePoint
  destination: SmartCommutePoint
  evidence: SmartCommuteEvidence | null
  snoozed_until: string | null
  created_at: string
  updated_at: string
  traffic_consent?: {
    lead_s: number
    min_savings_s: number
    can_skip_today: boolean
    arrival_deadline_s?: number
    compare_route_energy?: boolean
  }
}

export interface SmartCommuteRoutineInput {
  vehicle_id: number
  name: string
  weekday: number
  departure_s: number
  time_zone: string
  origin: SmartCommutePoint
  destination: SmartCommutePoint
}

export interface SmartCommuteSnapshot {
  settings: SmartCommuteSettings
  routines: SmartCommuteRoutine[] | null
  traffic_available?: boolean
  traffic_decisions?: SmartCommuteTrafficDecision[] | null
  navigation_available?: boolean
}

export type SmartCommuteNavigationOutcome =
  'accepted' | 'rejected' | 'delivery_unknown' | 'expired' | 'not_sent' | 'wake_required' | 'wake_permission_required'

export interface SmartCommuteTrafficDecision {
  occurrence_id: string
  routine_id: number
  vehicle_id: number
  routine_name: string
  vehicle_name: string
  time_zone?: string
  departure_at: string
  usual_s: number
  alternative_s: number
  usual_route_label?: string
  alternative_route_label?: string
  observed_at: string
  expires_at: string
  arrival_deadline_at?: string
  latest_departure_at?: string
  route_energy?: SmartCommuteRouteEnergy
  route_energy_only?: boolean
  navigation_outcome?: SmartCommuteNavigationOutcome
}

export interface SmartCommuteRouteEnergy {
  fastest: SmartCommuteRouteEnergyBand
  saving: SmartCommuteRouteEnergyBand
  outside_c: number
  expires_at: string
}

export interface SmartCommuteRouteEnergyBand {
  eta_s: number
  drive_count: number
  low_wh: number
  median_wh: number
  high_wh: number
}

export interface SmartCommuteTrafficPreview {
  drive_id: number
  trace: SmartCommutePoint[]
  fingerprint: string
}

export interface SmartCommuteTrafficInput {
  drive_id: number
  fingerprint: string
  share_with_here: true
  lead_s: number
  min_savings_s: number
  arrival_deadline_s?: number
  compare_route_energy?: boolean
}
