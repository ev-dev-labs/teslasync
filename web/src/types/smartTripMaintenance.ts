export interface TripMaintenanceSetup {
  plan_version: number
  service_label: string
  service_completed_at: string
  service_odometer_m: number
  interval_m: number
  trip_distance_low_m: number
  trip_distance_high_m: number
}

export interface TripMaintenanceProjection extends Omit<TripMaintenanceSetup, 'plan_version'> {
  plan_id: number
  vehicle_id: number
  departure_at: string
  due_odometer_m: number
  recorded_odometer_m: number
  recorded_at: string
  arrival_odometer_low_m: number
  arrival_odometer_high_m: number
  expires_at: string
}

export interface TripMaintenanceSettings {
  setup: TripMaintenanceSetup | null
  projection: TripMaintenanceProjection | null
  needs_review: boolean
}
