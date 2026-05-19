// AUTO-SPLIT from web/src/api/types.ts (P2 #3).
// See @/api/types barrel for the public re-export surface.


// === Media ===

export interface MediaSnapshot {
  id: number
  vehicle_id: number
  now_playing_title?: string
  now_playing_artist?: string
  now_playing_album?: string
  now_playing_station?: string
  now_playing_duration?: number
  now_playing_elapsed?: number
  playback_status?: string
  playback_source?: string
  audio_volume?: number
  audio_volume_max?: number
  audio_volume_increment?: number
  created_at: string
}

// === Vehicle Config ===

export interface VehicleConfigSnapshot {
  id: number
  vehicle_id: number
  car_type?: string
  trim?: string
  exterior_color?: string
  roof_color?: string
  wheel_type?: string
  rear_seat_heaters?: string
  sunroof_installed?: string
  efficiency_package?: string
  europe_vehicle?: boolean
  right_hand_drive?: boolean
  remote_start_enabled?: boolean
  charge_port?: string
  offroad_lightbar_present?: boolean
  version?: string
  vehicle_name?: string
  software_update_version?: string
  software_update_download_pct?: number
  software_update_install_pct?: number
  software_update_expected_duration?: number
  software_update_scheduled_start?: string
  created_at: string
}

// === Location Snapshots ===

export interface LocationSnapshot {
  id: number
  vehicle_id?: number
  // Position & GPS (from signal_log pivot)
  latitude?: number
  longitude?: number
  heading?: number
  gps_state?: string
  /** Elevation in meters (SI). */
  elevation_m?: number
  speed_mph?: number
  // Navigation & route
  destination_name?: string
  miles_to_arrival?: number
  minutes_to_arrival?: number
  route_traffic_delay_s?: number
  route_last_updated?: string
  // Destination/origin coords (Latest only — from unpacked compounds)
  destination_lat?: number
  destination_lon?: number
  origin_lat?: number
  origin_lon?: number
  // Presence
  located_at_home?: boolean
  located_at_work?: boolean
  located_at_favorite?: boolean
  homelink_nearby?: boolean
  // Timestamps
  created_at: string
}

// === Safety ===

export interface SafetySnapshot {
  id: number
  vehicle_id: number
  automatic_blind_spot_camera?: boolean
  automatic_emergency_braking_off?: boolean
  blind_spot_collision_warning?: boolean
  cruise_follow_distance?: string
  emergency_lane_departure_avoidance?: boolean
  forward_collision_warning?: string
  lane_departure_avoidance?: string
  speed_limit_warning?: string
  pin_to_drive_enabled?: boolean
  miles_since_reset?: number
  self_driving_miles_since_reset?: number
  created_at: string
}

// === User Preferences ===

export interface UserPreferenceSnapshot {
  id: number
  vehicle_id: number
  setting_24hr_time?: boolean
  setting_charge_unit?: string
  setting_distance_unit?: string
  setting_temperature_unit?: string
  setting_tire_pressure_unit?: string
  created_at: string
}

// === Backup & Restore ===

export interface BackupConfig {
  id: number
  name: string
  enabled: boolean
  backup_type: string
  frequency_days: number
  max_retention: number
  provider: string
  provider_config: Record<string, string>
  include_tables: string[] | null
  compress: boolean
  encrypt: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export interface BackupRun {
  id: number
  config_id: number | null
  run_type: string
  backup_type: string
  status: string
  provider: string
  file_name: string | null
  file_path: string | null
  file_size: number
  record_count: number
  table_count: number
  checksum: string | null
  duration_ms: number
  error_message: string | null
  metadata: Record<string, unknown>
  started_at: string | null
  completed_at: string | null
  created_at: string
}

// === Vehicle Access (Drivers & Invitations) ===

export interface VehicleDriver {
  id: number
  vehicle_id: number
  share_user_id: number | null
  driver_email: string | null
  driver_name: string | null
  role: string | null
  fetched_at: string
}

export interface VehicleInvitation {
  id: number
  vehicle_id: number
  invitation_id: string
  invite_url: string | null
  status: string
  expires_at: string | null
  created_by: string | null
  fetched_at: string
  created_at: string
}

// === Year in Review Types ===

export interface YearReviewDriveHighlight {
  drive_id: number
  date: string
  /** Distance in kilometers (km, derived SI). */
  distance_km: number
  duration_min: number
  start_address: string
  end_address: string
  /** Energy intensity in watt-hours per kilometer (Wh/km, derived SI). */
  efficiency_wh_km: number
}

export interface YearReviewMonthStat {
  month: number
  drives: number
  /** Distance in kilometers (km, derived SI). */
  distance_km: number
  /** Energy in kilowatt-hours (kWh, derived SI). */
  energy_wh: number
  cost: number
}

export interface YearReviewComparison {
  label: string
  value: string
  emoji: string
}

export interface YearReview {
  year: number
  vehicle: {
    id: number
    display_name: string
    model: string
  }

  // Headline stats
  total_drives: number
  /** Total distance in kilometers (km, derived SI). */
  total_distance_km: number
  /** Total energy in kilowatt-hours (kWh, derived SI). */
  total_energy_kwh: number
  total_charge_sessions: number
  total_driving_minutes: number
  total_charging_cost: number
  gas_savings: number
  /** CO2 offset in kilograms (kg, SI). */
  co2_offset_kg: number

  // Extremes
  longest_drive: YearReviewDriveHighlight | null
  shortest_drive: YearReviewDriveHighlight | null
  most_efficient_drive: YearReviewDriveHighlight | null
  least_efficient_drive: YearReviewDriveHighlight | null
  fastest_speed_kmh: number
  /** Coldest drive temperature in degrees Celsius (SI). */
  coldest_drive_temp_c: number
  /** Hottest drive temperature in degrees Celsius (SI). */
  hottest_drive_temp_c: number

  // Monthly breakdown
  monthly_stats: YearReviewMonthStat[]

  // Patterns
  most_active_day_of_week: string
  most_active_hour: number
  avg_drives_per_week: number
  /** Average distance per drive in kilometers (km, derived SI). */
  avg_distance_per_drive_km: number
  /** Average energy intensity in watt-hours per kilometer (Wh/km, derived SI). */
  avg_efficiency_wh_km: number

  // Charging habits
  supercharger_pct: number
  dc_fast_pct: number
  ac_other_pct: number
  avg_charge_start_soc: number

  // Fun comparisons
  comparisons: YearReviewComparison[]
}

export type {
  SignalObservation,
  SignalSource,
  SignalCatalogEntry,
  SignalValueType,
} from '@/types/signals';

/** One result from the global /search endpoint. */
export type SearchHitType =
  | 'vehicle'
  | 'drive'
  | 'charging'
  | 'alert'
  | 'notification'
  | 'geofence'
  | 'automation'
  | 'location'
  | 'trip';

export interface SearchHit {
  type: SearchHitType
  id: number
  title: string
  subtitle?: string
  url: string
  score: number
  when?: string
}

export interface SearchResponse {
  hits: SearchHit[]
  query: string
}

export type {
  AutomationActionInput,
  AutomationActionStep,
  AutomationConditionInput,
  AutomationConditionStep,
  AutomationFull,
  AutomationStep,
  AutomationStepBase,
  AutomationStepKind,
  AutomationStepLane,
  AutomationStepSummary,
  AutomationTriggerInput,
  AutomationTriggerStep,
} from '@/types/automations';
