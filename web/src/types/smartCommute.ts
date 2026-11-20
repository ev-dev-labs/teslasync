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
}
