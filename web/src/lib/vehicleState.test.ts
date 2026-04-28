import { describe, it, expect } from 'vitest';
import {
  parseDoorState,
  parseWindowState,
  parseTurnSignal,
  buildTwinState,
  mapLiveToTwinState as _mapLiveToTwinState,
} from './vehicleState';

describe('parseDoorState', () => {
  it('null/undefined → all null', () => {
    const r = parseDoorState(null);
    expect(r.driverFront).toBeNull();
    expect(r.passengerFront).toBeNull();
    expect(parseDoorState(undefined).driverFront).toBeNull();
  });

  it('"ClosedAll" → all false', () => {
    const r = parseDoorState('ClosedAll');
    expect(r.driverFront).toBe(false);
    expect(r.passengerFront).toBe(false);
    expect(r.driverRear).toBe(false);
    expect(r.passengerRear).toBe(false);
  });

  it('"Closed" → all false', () => {
    const r = parseDoorState('Closed');
    expect(r.driverFront).toBe(false);
    expect(r.passengerRear).toBe(false);
  });

  it('"0" → all false', () => {
    const r = parseDoorState('0');
    expect(r.driverFront).toBe(false);
  });

  it('JSON compound → parsed', () => {
    const r = parseDoorState('{"DriverFront":true,"PassengerFront":false,"DriverRear":false,"PassengerRear":true}');
    expect(r.driverFront).toBe(true);
    expect(r.passengerFront).toBe(false);
    expect(r.driverRear).toBe(false);
    expect(r.passengerRear).toBe(true);
  });

  it('JSON with snake_case keys → parsed', () => {
    const r = parseDoorState('{"driver_front":true,"passenger_rear":true}');
    expect(r.driverFront).toBe(true);
    expect(r.passengerRear).toBe(true);
    expect(r.passengerFront).toBeNull();
  });

  it('invalid JSON → falls back to string matching', () => {
    const r = parseDoorState('{invalid}');
    expect(r.driverFront).toBeNull();
    expect(r.passengerFront).toBeNull();
  });

  it('empty string → all null', () => {
    const r = parseDoorState('');
    expect(r.driverFront).toBeNull();
  });
});

describe('parseWindowState', () => {
  it('null/undefined → null', () => {
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState(undefined)).toBeNull();
  });

  it('"WindowStateClosed" → closed', () => {
    expect(parseWindowState('WindowStateClosed')).toBe('closed');
  });

  it('"WindowStatePartiallyOpen" → partial', () => {
    expect(parseWindowState('WindowStatePartiallyOpen')).toBe('partial');
  });

  it('"WindowStateOpen" → open', () => {
    expect(parseWindowState('WindowStateOpen')).toBe('open');
  });

  it('"WindowStateOpened" → open', () => {
    expect(parseWindowState('WindowStateOpened')).toBe('open');
  });

  it('"Venting" → partial', () => {
    expect(parseWindowState('Venting')).toBe('partial');
  });
});

describe('parseTurnSignal', () => {
  it('null/undefined → null', () => {
    expect(parseTurnSignal(null)).toBeNull();
    expect(parseTurnSignal(undefined)).toBeNull();
  });

  it('"TurnSignalLeft" → left', () => {
    expect(parseTurnSignal('TurnSignalLeft')).toBe('left');
  });

  it('"TurnSignalRight" → right', () => {
    expect(parseTurnSignal('TurnSignalRight')).toBe('right');
  });

  it('"TurnSignalOff" → off', () => {
    expect(parseTurnSignal('TurnSignalOff')).toBe('off');
  });

  it('"Off" → off', () => {
    expect(parseTurnSignal('Off')).toBe('off');
  });
});

describe('buildTwinState', () => {
  it('null inputs → empty state', () => {
    const result = buildTwinState(null, null, null);
    expect(result.locked).toBeNull();
    expect(result.sentryMode).toBeNull();
    expect(result.windowFD).toBeNull();
    expect(result.isCharging).toBe(false);
    expect(result.isDriving).toBe(false);
  });

  it('maps SecurityEvent fields correctly', () => {
    const ev = {
      id: 1,
      vehicle_id: 1,
      door_state: '{"DriverFront":true}',
      fd_window: 'WindowStateClosed',
      fp_window: 'WindowStatePartiallyOpen',
      rd_window: undefined,
      rp_window: 'WindowStateOpen',
      locked: true,
      sentry_mode: true,
      lights_hazards_active: false,
      lights_high_beams: true,
      lights_turn_signal: 'TurnSignalLeft',
      driver_seat_occupied: true,
      created_at: '2024-01-01',
    };
    const result = buildTwinState(ev, { is_charging: true }, null);

    expect(result.doors.driverFront).toBe(true);
    expect(result.doors.passengerFront).toBeNull();
    expect(result.windowFD).toBe('closed');
    expect(result.windowFP).toBe('partial');
    expect(result.windowRD).toBeNull();
    expect(result.windowRP).toBe('open');
    expect(result.locked).toBe(true);
    expect(result.sentryMode).toBe(true);
    expect(result.headlights).toBe(true);
    expect(result.hazards).toBe(false);
    expect(result.turnSignal).toBe('left');
    expect(result.driverSeatOccupied).toBe(true);
    expect(result.isCharging).toBe(true);
    expect(result.isDriving).toBe(false);
  });

  it('maps motion, charge, trunk, and window summary fields', () => {
    const result = buildTwinState(
      {
        vehicle_id: 1,
        ts: '2024-01-01',
        event_type: 'security',
        doors_open: 'driver_front,trunk_rear',
        windows_open: 'fd,rp',
        locked: false,
        sentry_mode: false,
        user_present: null,
        detail: null,
        source: 'test',
      },
      { state: 'driving', speed: 12, is_charging: false },
      { vehicle_id: 1, ts: '2024-01-01', session_id: null, battery_level: null, battery_range_mi: null, charging_state: 'Charging', charger_voltage: null, charger_actual_current: null, charger_power_kw: 7, charger_phases: null, charge_energy_added_kwh: null, charge_miles_added: null, charge_rate_mph: null, charger_pilot_current: null, scheduled_charging_at: null, source: 'test' },
    );

    expect(result.isDriving).toBe(true);
    expect(result.isCharging).toBe(true);
    expect(result.chargePortOpen).toBe(true);
    expect(result.doors.driverFront).toBe(true);
    expect(result.trunkOpen).toBe(true);
    expect(result.windowFD).toBe('open');
    expect(result.windowRP).toBe('open');
  });

  it('maps charging state when only charging telemetry is available', () => {
    const result = buildTwinState(
      null,
      null,
      { vehicle_id: 1, ts: '2024-01-01', session_id: null, battery_level: null, battery_range_mi: null, charging_state: 'Charging', charger_voltage: null, charger_actual_current: null, charger_power_kw: 3, charger_phases: null, charge_energy_added_kwh: null, charge_miles_added: null, charge_rate_mph: null, charger_pilot_current: null, scheduled_charging_at: null, source: 'test' },
    );

    expect(result.isCharging).toBe(true);
    expect(result.chargePortOpen).toBe(true);
  });
});
