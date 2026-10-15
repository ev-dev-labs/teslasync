import type {
  ChargingSession, ChargeTelemetryReading, ChargingTelemetry, ClimateSnapshot, MediaSnapshot,
  TirePressureSnapshot, LocationSnapshot, Position,
} from '../src/api/types';
import type { TeslaChargingHistoryResponse } from '../src/api/hooks/useCharging';
import type { CommandLogEntry } from '../src/api/hooks/useCommands';
import type { ChargingOptimizerData, ChargePlan, RatePlanInfo, NextChargeDecision } from '../src/types/charging';
import type { ClimateState } from '../src/types/vehicle-systems';
import type { Location, Geofence } from '../src/types/location';
import { catalogueWire, type CatalogueSources } from './dashboardCatalogueRemainingSources';
import { mockVehicle } from './mockApi';

export function catalogueOperationalSources(now: string): CatalogueSources {
  const earlier = new Date(Date.parse(now) - 14_400_000).toISOString();
  const session: ChargingSession = {
    id: 701, vehicle_id: 7, started_at: earlier, ended_at: now, startedAt: earlier,
    start_ts: earlier, end_ts: now, start_soc_pct: 30, end_soc_pct: 72, delta_soc_pct: 42,
    start_odometer_m: 32_100_000, end_odometer_m: 32_100_000,
    start_lat: 37.4, start_lng: -122.1, start_place: 'Catalogue home',
    total_energy_added_wh: 42_000, peak_power_w: 11000, avg_power_w: 10500,
    cost_decimal: 6.72, cost: 6.72, cost_currency: 'USD', charger_type: 'AC',
    cable_type: 'IEC', duration_min: 240, live: false,
  };
  const telemetry: ChargeTelemetryReading[] = [0, 1, 2].map(index => {
    const ts = new Date(Date.parse(earlier) + index * 7_200_000).toISOString();
    return {
      session_id: 701, vehicle_id: 7, ts, created_at: ts,
      ac_charging_power_w: 10000 + index * 500, dc_charging_power_w: null,
      ac_charging_energy_in_wh: index * 21000, dc_charging_energy_in_wh: null,
      charger_voltage_v: 230, charger_actual_current_a: 16, charger_pilot_current_a: 16,
      charger_phases: 3, battery_heater_on: false, battery_heater_power_w: 0,
      charge_limit_soc_pct: 80, charge_request: 'Start', fast_charger_type: null,
      charging_cable_type: 'IEC', charge_port_door_open: true, charge_port_latch: 'Engaged',
      power_w: 10000 + index * 500, battery_level: 30 + index * 21,
      soc: 30 + index * 21, energy_added: index * 21000, voltage: 230, current_amps: 16,
    };
  });
  const charging: ChargingTelemetry = {
    vehicle_id: 7, ts: now, session_id: 702, battery_level: 72, battery_range_mi: null,
    charging_state: 'Charging', charger_voltage: 230, charger_actual_current: 16,
    charger_power_w: 11000, charger_phases: 3, charge_energy_added_wh: 6000,
    range_added_meters: 30_000, range_added_meters_per_hour: 60_000,
    charger_pilot_current: 16, scheduled_charging_at: null, source: 'telemetry',
  };
  const optimizer: ChargingOptimizerData = {
    current_schedule: { most_common_start_hour: 1, most_common_day: 'Saturday',
      avg_sessions_per_week: 3, home_charging_pct: 80, avg_charge_to_pct: 80 },
    cost_analysis: { peak_hours: [17, 18], offpeak_hours: [0, 1, 2], peak_cost_per_kwh: 0.4,
      offpeak_cost_per_kwh: 0.16, sessions_during_peak_pct: 10, potential_monthly_savings: 12 },
    battery_health_score: 94,
    recommendations: [{ type: 'offpeak', priority: 'high', title: 'Catalogue off-peak window',
      detail: 'Use the observed local low-rate window', estimated_savings: 12 }],
    weekly_heatmap: [{ day: 6, hour: 1, sessions: 3, avg_cost_per_kwh: 0.16 }],
  };
  const plans: ChargePlan[] = [{
    id: 1, vehicle_id: 7, target_soc: 80, depart_by: now,
    scheduled_start: earlier, scheduled_end: now, rate_plan: 'catalogue-offpeak',
    estimated_kwh: 6, estimated_cost: 0.96, charge_now_cost: 2.4, savings: 1.44,
    status: 'applied', applied_at: earlier, completed_at: null, created_at: earlier,
  }];
  const rates: RatePlanInfo[] = [{ id: 'catalogue-offpeak', name: 'Catalogue off-peak', utility: 'Local fake utility' }];
  const decision: NextChargeDecision = {
    verdict: 'wait', reason_key: 'catalogue_wait', reason: 'Catalogue low-rate window starts soon',
    current_soc: 72, target_soc: 80, kwh_needed: 6, horizon_hours: 12,
    home_now_cost: 2.4, home_wait_cost: 0.96, home_wait_start: now, home_savings: 1.44,
    ready_by: now, capped_by_health_guardrail: false,
  };
  const billed: TeslaChargingHistoryResponse = {
    entries: [{
      id: 1, session_id: 801, vin: mockVehicle.vin, site_location_name: 'Catalogue Supercharger',
      charge_start_datetime: earlier, charge_stop_datetime: now, country: 'US', state: 'CA',
      county: null, postal_code: null, billing_type: 'charging', fee_type: 'charging',
      currency_code: 'USD', pricing_type: 'energy', rate_base: 0.4,
      usage_wh: 30000, total_due: 12, has_invoice: false, invoice_content_id: null,
      fetched_at: now, created_at: now,
    }],
    summary: { total_sessions: 1, total_wh: 30000, total_spend: 12, avg_cost_per_kwh: 0.4 },
  };
  const climate: ClimateSnapshot = {
    vehicle_id: 7, ts: now, inside_temp_c: 21, outside_temp_c: 18,
    driver_setpoint_c: 22, passenger_setpoint_c: 22, hvac_state: 'On',
    defrost_mode: 'Off', is_climate_on: true, is_preconditioning: false, fan_status: 3,
    seat_heater_left: 1, seat_heater_right: 0, seat_heater_rear_left: 0, seat_heater_rear_right: 0,
    steering_wheel_heater: false, cabin_overheat_protection: true, source: 'telemetry',
    inside_temp: 21, outside_temp: 18, driver_temp_setting: 22, passenger_temp_setting: 22,
    fan_speed: 3, hvac_power: true, hvac_ac_enabled: true, hvac_steering_wheel_heat_level: 0,
  };
  const history: ClimateState[] = [20, 21].map((insideTemp, index) => ({
    id: index + 1, created_at: index ? now : earlier,
    insideTemp, outsideTemp: 18, hvacPower: true, fanSpeed: 3,
  }));
  const media: MediaSnapshot = {
    id: 1, vehicle_id: 7, now_playing_title: 'Catalogue evening drive',
    now_playing_artist: 'Synthetic ensemble', now_playing_album: 'Local fixtures',
    now_playing_duration: 240, now_playing_elapsed: 60, playback_status: 'Playing',
    playback_source: 'Bluetooth', audio_volume: 5, audio_volume_max: 10, created_at: now,
  };
  const tires: TirePressureSnapshot = {
    id: 1, vehicle_id: 7, front_left: 280000, front_right: 285000,
    rear_left: 290000, rear_right: 295000, created_at: now,
    last_seen_time_fl: now, last_seen_time_fr: now, last_seen_time_rl: now, last_seen_time_rr: now,
  };
  const tireHistory: TirePressureSnapshot[] = [0, 1].map(index => ({
    id: index + 1, vehicle_id: 7, front_left: 279000 + index * 1000,
    front_right: 284000 + index * 1000, rear_left: 289000 + index * 1000,
    rear_right: 294000 + index * 1000, created_at: index ? now : earlier,
  }));
  const location: LocationSnapshot = {
    id: 1, vehicle_id: 7, latitude: 37.4, longitude: -122.1,
    heading: 90, destination_name: 'Catalogue library', minutes_to_arrival: 12,
    miles_to_arrival: 12_000, located_at_home: true, located_at_work: false,
    located_at_favorite: true, route_traffic_delay_s: 60, created_at: now,
  };
  const favorites: Location[] = [{
    id: '1', addressName: 'Catalogue home', latitude: 37.4, longitude: -122.1,
    visitCount: 8, totalDurationS: 7200, lastVisited: now,
  }];
  const fences: Geofence[] = [{
    id: '1', name: 'Catalogue home', latitude: 37.4, longitude: -122.1, radius: 200,
    alertOnEntry: true, alertOnExit: true, enabled: true, origin: 'manual',
    needsReview: false, createdAt: earlier,
  }];
  const positions: Position[] = [0, 0, 0.01].map((delta, index) => ({
    vehicle_id: 7, ts: new Date(Date.parse(earlier) + index * 60_000).toISOString(),
    latitude: 37.4 + delta, longitude: -122.1 + delta, heading: 90,
    speed_mph: null, elevation_m: 30, gps_state: 'Active', source: 'telemetry',
  }));
  const commands: CommandLogEntry[] = [{
    id: 1, vehicle_id: 7, command: 'flash_lights', params: '{}',
    status: 'success', error: '', created_at: now,
  }];
  return {
    '/charging': [session], '/charging-sessions': [session], '/charging/701': session,
    '/charging/701/telemetry': telemetry, '/charging-telemetry/latest': charging,
    '/analytics/charging-optimizer': optimizer, '/charge-planner/history': plans,
    '/charge-planner/rate-plans': rates, '/charge-autopilot/decision': decision,
    '/tesla/charging/history': billed,
    '/climate/latest': climate, '/climate': catalogueWire(history),
    '/media/latest': media, '/media': [media],
    '/tire-pressure/latest': tires, '/tire-pressure': tireHistory,
    '/location-snapshots/latest': location, '/locations': catalogueWire(favorites),
    '/geofences': catalogueWire(fences), '/vehicles/7/positions': positions,
    '/vehicles/7/commands/history': commands,
  };
}
