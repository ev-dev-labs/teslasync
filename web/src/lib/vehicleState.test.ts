import { describe, it, expect } from 'vitest';
import type { ChargingTelemetry, SecurityEvent } from '@/api/types';
import {
  parseDoorState,
  parseWindowState,
  parseTurnSignal,
  buildTwinState,
  buildTwinSourceObservations,
  resolveTwinSourceObservation,
  mapLiveToTwinState as _mapLiveToTwinState,
} from './vehicleState';

describe('twin source observations', () => {
  const now = Date.parse('2026-10-14T20:00:00Z');
  const observedAt = now - 60_000;
  const observation = { vehicleId: 1, observedAt };

  it('distinguishes active initial loading from paused without data', () => {
    const active = resolveTwinSourceObservation('security', {
      isPending: true, fetchStatus: 'fetching',
    }, observation, now);
    expect(active.isLoading).toBe(true);
    expect(active.query.status).toBe('initial');
    expect(active.observedAt).toBeNull();
    const paused = resolveTwinSourceObservation('security', {
      isPending: true, fetchStatus: 'paused',
    }, observation, now);
    expect(paused.isLoading).toBe(false);
    expect(paused.query.isRefreshBlocked).toBe(true);
    expect(paused.query.fatalError).toBeNull();
    expect(paused.identity).toBeNull();
  });

  it.each([null, []])('preserves successful empty %j without creating an observation', (data) => {
    const result = resolveTwinSourceObservation('security', {
      data, isSuccess: true, dataUpdatedAt: now,
    }, observation, now);
    expect(result.query.status).toBe('unavailable');
    expect(result.query.data).toBe(data);
    expect(result.observedAt).toBeNull();
    expect(result.ageMs).toBeNull();
    expect(result.identity).toBeNull();
  });

  it.each([0, false])('preserves measured %j as data, not an empty result', (data) => {
    const result = resolveTwinSourceObservation('vehicle-state', {
      data, isSuccess: true, dataUpdatedAt: now,
    }, observation, now);
    expect(result.query.status).toBe('ok');
    expect(result.query.data).toBe(data);
    expect(result.ageMs).toBe(60_000);
  });

  it('retains source identity and growing age through refresh failure, pause and recovery', () => {
    const data = { locked: false };
    const error = new Error('refresh failed');
    const initial = resolveTwinSourceObservation('security', { data, dataUpdatedAt: now }, observation, now);
    const failed = resolveTwinSourceObservation('security', {
      data, dataUpdatedAt: now, isError: true, error,
    }, observation, now + 30_000);
    expect(failed.identity).toBe(initial.identity);
    expect(failed.ageMs).toBe(90_000);
    expect(failed.query.data).toBe(data);
    expect(failed.query.refreshError).toBe(error);
    expect(failed.query.fatalError).toBeNull();
    const paused = resolveTwinSourceObservation('security', {
      data, dataUpdatedAt: now, fetchStatus: 'paused',
    }, observation, now + 40_000);
    expect(paused.query.isRefreshBlocked).toBe(true);
    expect(paused.query.refreshError).toBeNull();
    expect(paused.ageMs).toBe(100_000);
    const recovered = resolveTwinSourceObservation('security', {
      data, isSuccess: true, dataUpdatedAt: now + 50_000,
    }, observation, now + 50_000);
    expect(recovered.query.status).toBe('ok');
    expect(recovered.query.refreshError).toBeNull();
    expect(recovered.identity).toBe(initial.identity);
    expect(recovered.ageMs).toBe(110_000);
    expect(recovered.query.ageMs).toBe(0);
  });

  it('distinguishes fatal failure and retained active refresh', () => {
    const error = new Error('initial failed');
    const failed = resolveTwinSourceObservation('charging', { isError: true, error }, observation, now);
    expect(failed.query.fatalError).toBe(error);
    expect(failed.query.refreshError).toBeNull();
    const refreshing = resolveTwinSourceObservation('charging', {
      data: 0, isFetching: true, fetchStatus: 'fetching',
    }, observation, now);
    expect(refreshing.isLoading).toBe(false);
    expect(refreshing.query.isRefreshing).toBe(true);
    expect(refreshing.ageMs).toBe(60_000);
  });

  it.each([undefined, null, '', 'invalid', Infinity, NaN, now + 1, new Date(NaN)])(
    'does not substitute fetch success for invalid or absent observation %j', (observedAt) => {
      const result = resolveTwinSourceObservation('charging', {
        data: { charger_power_w: 0 }, dataUpdatedAt: now, isSuccess: true,
      }, { vehicleId: 1, observedAt }, now);
      expect(result.observedAt).toBeNull();
      expect(result.ageMs).toBeNull();
      expect(result.identity).toBeNull();
    },
  );

  it('keeps each source timestamp, vehicle identity and independent recovery separate', () => {
    const security: SecurityEvent = {
      vehicle_id: 1, ts: new Date(observedAt).toISOString(),
      created_at: new Date(now).toISOString(),
      event_type: 'security', doors_open: null, windows_open: null,
      locked: false, sentry_mode: false, user_present: null, detail: null, source: 'test',
    };
    const sources = buildTwinSourceObservations(
      { data: security, dataUpdatedAt: now },
      { data: { state: { vehicle_id: 1 }, observedAt: now - 20_000 }, dataUpdatedAt: now },
      { data: chargingTelemetry(0), dataUpdatedAt: now, error: new Error('charging failed') },
      now,
    );
    expect(sources.security.ageMs).toBe(60_000);
    expect(sources.vehicleState.ageMs).toBe(20_000);
    expect(sources.charging.observedAt).toBe(Date.parse('2024-01-01'));
    expect(sources.charging.query.refreshError).not.toBeNull();
    expect(sources.security.query.refreshError).toBeNull();
    expect(new Set(Object.values(sources).map((source) => source.identity)).size).toBe(3);
    const otherVehicle = resolveTwinSourceObservation('security', { data: security }, {
      vehicleId: 2, observedAt,
    }, now);
    expect(otherVehicle.identity).not.toBe(sources.security.identity);
    expect(buildTwinState(security, null, chargingTelemetry(0)).lastUpdated).toBe(security.ts);
  });

  it('changes identity only when the source supplies a new observation', () => {
    const data = { charger_power_w: 0 };
    const before = resolveTwinSourceObservation('charging', { data }, observation, now);
    const after = resolveTwinSourceObservation('charging', { data, dataUpdatedAt: now }, {
      vehicleId: 1, observedAt: now,
    }, now);
    expect(after.identity).not.toBe(before.identity);
    expect(after.ageMs).toBe(0);
    const unknown = buildTwinSourceObservations(
      { data: null, dataUpdatedAt: now },
      { data: { state: { vehicle_id: 1 } }, dataUpdatedAt: now },
      { data: null, dataUpdatedAt: now },
      now,
    );
    expect(unknown.vehicleState.observedAt).toBeNull();
    expect(unknown.vehicleState.identity).toBeNull();
    expect(buildTwinState(null, { speed: 0 }, chargingTelemetry(0)).lastUpdated).toBeNull();
  });
});

function chargingTelemetry(charger_power_w: number | null): ChargingTelemetry {
  return {
    vehicle_id: 1,
    ts: '2024-01-01',
    session_id: null,
    battery_level: null,
    battery_range_mi: null,
    charging_state: null,
    charger_voltage: null,
    charger_actual_current: null,
    charger_power_w,
    charger_phases: null,
    charge_energy_added_wh: null,
    range_added_meters: null,
    range_added_meters_per_hour: null,
    charger_pilot_current: null,
    scheduled_charging_at: null,
    source: 'test',
  };
}

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
      { ...chargingTelemetry(7), charging_state: 'Charging' },
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
      { ...chargingTelemetry(3), charging_state: 'Charging' },
    );

    expect(result.isCharging).toBe(true);
    expect(result.chargePortOpen).toBe(true);
  });

  describe.each(['vehicle', 'telemetry'] as const)('%s power-only charging', (source) => {
    function stateWithPower(power: unknown) {
      const vehicle = { charger_power: null };
      const charging = chargingTelemetry(null);
      const input = source === 'vehicle' ? vehicle : charging;
      const key = source === 'vehicle' ? 'charger_power' : 'charger_power_w';
      Reflect.set(input, key, power);
      const result = buildTwinState(
        null,
        source === 'vehicle' ? vehicle : null,
        source === 'telemetry' ? charging : null,
      );
      expect(Reflect.get(input, key)).toBe(power);
      return result;
    }

    it.each([undefined, null])('does not infer charging from missing power %s', (power) => {
      expect(stateWithPower(power).isCharging).toBe(false);
    });

    it.each([NaN, Infinity, -Infinity, '7000', true, {}, []])(
      'does not infer charging from invalid power %j',
      (power) => {
        expect(stateWithPower(power).isCharging).toBe(false);
      },
    );

    it.each([0, -0])('preserves measured zero %s without inferring charging', (power) => {
      const result = stateWithPower(power);
      expect(result.isCharging).toBe(false);
      expect(result.chargePortOpen).toBeNull();
    });

    it.each([
      [7000, true],
      [-7000, false],
      [0.5, true],
      [-0.5, false],
      [Number.MIN_VALUE, true],
    ])('uses signed watts %s directly (charging: %s)', (power, expected) => {
      const result = stateWithPower(power);
      expect(result.isCharging).toBe(expected);
      expect(result.chargePortOpen).toBe(expected ? true : null);
    });
  });

  it.each([null, 0, -7000])('does not fall back to legacy kilowatts with canonical power %s', (power) => {
    const charging = { ...chargingTelemetry(power), charger_power_kw: 7 };
    expect(buildTwinState(null, null, charging).isCharging).toBe(false);
  });

  it.each(['Charging', 'Starting'])('preserves explicit %s state with zero power', (charging_state) => {
    expect(buildTwinState(null, null, { ...chargingTelemetry(0), charging_state }).isCharging).toBe(true);
  });

  it('preserves the explicit charging flag with negative power', () => {
    expect(buildTwinState(null, { is_charging: true, charger_power: -1 }, chargingTelemetry(-1)).isCharging).toBe(true);
  });
});
