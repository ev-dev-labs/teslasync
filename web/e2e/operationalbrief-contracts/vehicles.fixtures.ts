import type {
  ChargingTelemetry, DayLogEvent, DayLogResponse, SecurityEvent, VehicleStateReadings,
} from '../../src/api/types';
import { mockVehicle } from '../mockApi';

export type DayReading = 'recorded' | 'zero' | 'unknown';
export type TwinReading = 'reported' | 'mixed' | 'unknown' | 'charging';
export type DistancePreference = 'km' | 'mi';

export const vehicle = { ...mockVehicle, timezone: 'UTC' };
export const day = '2026-09-14';
export const dayBounds = '[2026-09-14T00:00:00Z, 2026-09-15T00:00:00Z) · end exclusive';

const ledgerEvents: DayLogEvent[] = [
  {
    id: 'drive:101:start', ts: '2026-09-14T08:00:00Z', type: 'drive_start',
    layer: 'default', source: 'drives', vehicle_id: 7, ref_kind: 'drive', ref_id: 101,
    payload: { start_place: 'Home' },
  },
  {
    id: 'drive:101:end', ts: '2026-09-14T09:30:00Z', type: 'drive_end',
    layer: 'default', source: 'drives', vehicle_id: 7, ref_kind: 'drive', ref_id: 101,
    payload: { distance_m: 25123, duration_s: 5400, energy_used_wh: -5200 },
  },
  {
    id: 'charge:201:end', ts: '2026-09-14T11:00:00Z', type: 'charge_end',
    layer: 'default', source: 'charging_sessions', vehicle_id: 7,
    ref_kind: 'charge', ref_id: 201, payload: { energy_added_wh: 42050 },
  },
  {
    id: 'signal:Locked:1', ts: '2026-09-14T12:00:00Z', type: 'locked',
    layer: 'default', source: 'security_events', vehicle_id: 7,
    payload: { from: false, to: true },
  },
];

export function dayFixture(reading: DayReading, selectedDay = day): DayLogResponse {
  const nextDay = new Date(`${selectedDay}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const events = reading === 'recorded' ? ledgerEvents : [];
  const measure = reading === 'zero' ? 0 : null;
  return {
    vehicle_id: 7, date: selectedDay, timezone: 'UTC',
    day_start: `${selectedDay}T00:00:00Z`,
    day_end: `${nextDay.toISOString().slice(0, 10)}T00:00:00Z`,
    truncated: false, total_events: events.length, limit: 2000, offset: 0,
    layers: ['turn_signals', 'lights', 'doors_windows', 'hvac', 'gear',
      'homelink', 'navigation', 'charge_port', 'access', 'tires'],
    events: events.map((event) => ({
      ...event, ts: `${selectedDay}${event.ts.slice(10)}`,
    })),
    summary: reading === 'recorded' ? {
      drive_count: 1, charge_count: 1, drive_duration_s: 5400,
      drive_distance_m: 25123, energy_added_wh: 42050, energy_used_wh: -5200,
    } : {
      drive_count: 0, charge_count: 0, drive_duration_s: measure,
      drive_distance_m: measure, energy_added_wh: measure, energy_used_wh: measure,
    },
    sources: [
      { source: 'drives', status: events.length ? 'ok' : 'empty', count: events.length ? 1 : 0 },
      { source: 'charging_sessions', status: events.length ? 'ok' : 'empty', count: events.length ? 1 : 0 },
      { source: 'signal_log', status: 'empty', count: 0 },
      { source: 'security_events', status: events.length ? 'ok' : 'empty', count: events.length ? 1 : 0 },
      ...(reading === 'recorded' ? [] : [
        { source: 'user_presence', status: 'unavailable' as const, count: 0, reason: 'No signal or table records occupant presence' },
      ]),
    ],
  };
}

export interface StateEnvelope {
  state: VehicleStateReadings;
  live: boolean;
  data_source: 'live_signal_store';
  observed_at: string;
  freshness: 'fresh';
  verified_fields: (keyof VehicleStateReadings)[];
}

// Latest handlers project mapped signals only: history timestamps/source aliases
// and charge-port state are not emitted by these two live endpoints.
type LatestSecurity = Partial<Pick<SecurityEvent,
  'door_state' | 'fd_window' | 'fp_window' | 'rd_window' | 'rp_window'
  | 'locked' | 'sentry_mode' | 'lights_high_beams' | 'lights_hazards_active' | 'lights_turn_signal'
>>;
type LatestCharging = Partial<Pick<ChargingTelemetry,
  'battery_level' | 'charging_state' | 'charger_voltage' | 'charger_actual_current'
  | 'charger_power_w' | 'charger_phases' | 'charge_energy_added_wh' | 'range_added_meters_per_hour'
>>;

export interface TwinFixture {
  security: LatestSecurity;
  state: StateEnvelope | null;
  charging: LatestCharging;
}

export function twinFixture(reading: TwinReading): TwinFixture {
  if (reading === 'unknown') return { security: {}, state: null, charging: {} };
  const now = Date.now();
  const security: LatestSecurity = {
    door_state: reading === 'mixed' ? '{"DriverFront":false}' : JSON.stringify({
      DriverFront: reading === 'reported', PassengerFront: false,
      DriverRear: false, PassengerRear: false, TrunkFront: false, TrunkRear: false,
    }),
    fd_window: reading === 'mixed' ? null : 'Partial',
    fp_window: reading === 'mixed' ? null : 'Closed',
    rd_window: reading === 'mixed' ? null : 'Open',
    rp_window: reading === 'mixed' ? null : 'Closed',
    locked: false, sentry_mode: false,
    lights_high_beams: false, lights_hazards_active: false, lights_turn_signal: 'Off',
  };
  if (reading === 'mixed') return { security, state: null, charging: {} };
  const state: VehicleStateReadings = {
    vehicle_id: 7, state: 'online', latitude: 37.4, longitude: -122.1,
    speed: 0, power: 0, battery_level: 72, rated_range: 400000,
    ideal_range: 420000, odometer: 12345678, inside_temp: 21, outside_temp: -8,
    is_climate_on: false, is_charging: reading === 'charging',
    charger_power: reading === 'charging' ? 7200 : 0, charge_rate: 0,
    time_to_full_charge: 0, is_locked: false, sentry_mode: false,
    software_version: '2026.4.1',
  };
  return {
    security,
    state: {
      state, live: true, data_source: 'live_signal_store',
      observed_at: new Date(now).toISOString(), freshness: 'fresh',
      verified_fields: Object.keys(state) as (keyof VehicleStateReadings)[],
    },
    charging: {
      battery_level: 72, charging_state: reading === 'charging' ? 'Charging' : 'Stopped',
      charger_voltage: null, charger_actual_current: null,
      charger_power_w: reading === 'charging' ? 7200 : 0, charger_phases: null,
      charge_energy_added_wh: 0, range_added_meters_per_hour: 0,
    },
  };
}

export const recordedDisplays: Record<DistancePreference, Record<string, string>> = {
  km: {
    drives: '1', charges: '1', 'drive-time': '1.50 h', distance: '25.12 km',
    'energy-added': '42.05 kWh', 'energy-used': '-5.20 kWh',
  },
  mi: {
    drives: '1', charges: '1', 'drive-time': '1.50 h', distance: '15.61 mi',
    'energy-added': '42.05 kWh', 'energy-used': '-5.20 kWh',
  },
};
