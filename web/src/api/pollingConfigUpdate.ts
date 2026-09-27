import type { PollingConfig } from './hooks/useSettings'

export function pollingConfigUpdate(pc: PollingConfig): Omit<PollingConfig, 'endpoint_catalog'> {
  // camelCaseKeys adds aliases inside endpoint maps too; only catalog keys are valid on write.
  const catalogKeys = new Set(pc.endpoint_catalog.map((endpoint) => endpoint.key))
  const pollableKeys = new Set(pc.endpoint_catalog.filter((endpoint) => endpoint.pollable).map((endpoint) => endpoint.key))
  const fleetEndpoints = Object.fromEntries(
    Object.entries(pc.fleet_endpoints).filter(([key]) => catalogKeys.has(key)),
  )
  const autoEndpoints = Object.fromEntries(
    Object.entries(pc.auto_endpoints).filter(([key]) => pollableKeys.has(key)),
  )
  return {
    auto_polling_enabled: pc.auto_polling_enabled,
    fleet_endpoints: fleetEndpoints,
    auto_endpoints: autoEndpoints,
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
