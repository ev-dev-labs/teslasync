import type { PollingConfig } from './hooks/useSettings'

export function pollingConfigUpdate(pc: PollingConfig): PollingConfig {
  // Read responses also expose camelCase aliases; the strict Go decoder only accepts these JSON tags.
  return {
    vehicle_discovery: pc.vehicle_discovery,
    charge_state: pc.charge_state,
    climate_state: pc.climate_state,
    drive_state: pc.drive_state,
    location_data: pc.location_data,
    vehicle_state: pc.vehicle_state,
    vehicle_config: pc.vehicle_config,
    on_demand_vehicle_discovery: pc.on_demand_vehicle_discovery,
    on_demand_charge_state: pc.on_demand_charge_state,
    on_demand_climate_state: pc.on_demand_climate_state,
    on_demand_drive_state: pc.on_demand_drive_state,
    on_demand_location_data: pc.on_demand_location_data,
    on_demand_vehicle_state: pc.on_demand_vehicle_state,
    on_demand_vehicle_config: pc.on_demand_vehicle_config,
    nearby_charging_sites: pc.nearby_charging_sites,
    release_notes: pc.release_notes,
    recent_alerts: pc.recent_alerts,
    service_data: pc.service_data,
    wake_up: pc.wake_up,
    commands: pc.commands,
    telemetry_capture: pc.telemetry_capture,
    telemetry_capture_retention_days: pc.telemetry_capture_retention_days,
  }
}
