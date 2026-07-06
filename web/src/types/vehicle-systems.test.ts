/**
 * vehicle-systems wire-type contract tests.
 *
 * `vehicle-systems.ts` is a pure declaration module — no runtime code, only the
 * TypeScript shapes behind the useVehicleSystems query family. A declaration
 * file has nothing to "run", so these cases lock the two load-bearing promises
 * the module makes (see its docstring) instead:
 *
 *   1. The camelCase shapes (ClimateState, TirePressureReading, MaintenanceItem,
 *      ServiceRecord, SoftwareUpdate) name the camelCase MIRROR that the shared
 *      request() client adds. We run realistic snake_case backend fixtures
 *      through the REAL `camelCaseKeys` (lib/resilience.ts) and assert the camel
 *      aliases the interfaces declare actually materialise while the snake_case
 *      originals survive — so `inside_temp` and `insideTemp` both resolve.
 *   2. SafetySnapshot is snake_case (Go tags 1:1) and its ADAS enum fields are
 *      `string | boolean | number | null` on purpose. Every runtime shape is
 *      exercised through the documented choke point (cleanSafetyEnum /
 *      isSafetyEnumActive) so a naive `String(v).toLowerCase()` regression — the
 *      exact bug the funnel exists to prevent — can't pass silently.
 *
 * The string-literal unions (TirePosition, TireStatus, MaintenanceStatus, and
 * SoftwareUpdate['status']) get their membership pinned by exhaustive
 * `Record<Union, …>` maps: widening or narrowing a union fails to compile, and
 * the runtime key assertions catch a drift the type-checker can't (e.g. a typo'd
 * map key). Classifier helpers mirror the branching the pages actually do.
 */

import { describe, it, expect } from 'vitest';

import { camelCaseKeys } from '@/lib/resilience';
import { cleanSafetyEnum, isSafetyEnumActive } from '@/lib/safetyEnum';
import type {
  ClimateState,
  TirePressureReading,
  TirePosition,
  TireStatus,
  MaintenanceItem,
  ServiceRecord,
  MaintenanceStatus,
  SoftwareUpdate,
  SafetySnapshot,
} from './vehicle-systems';

/** Run a fixture through the real client transform and read it as a bag. */
function wire(payload: unknown): Record<string, unknown> {
  return camelCaseKeys(payload) as Record<string, unknown>;
}

/**
 * Assert the transform kept `snake` and added a camelCase mirror pointing at the
 * same value — the invariant every camelCase-declared field in this module
 * depends on for its runtime reads.
 */
function expectMirror(
  wired: Record<string, unknown>,
  snake: string,
  camel: string,
  value: unknown,
): void {
  expect(wired[snake]).toEqual(value);
  expect(wired[camel]).toEqual(value);
}

// ---------------------------------------------------------------------------
// ClimateState — camelCase alias over a snake_case /climate/latest body
// ---------------------------------------------------------------------------

describe('ClimateState camelCase-mirror contract', () => {
  // Exactly what the Go climate handler emits: snake_case, °C temperatures.
  const backend = {
    id: 7,
    created_at: '2025-06-01T00:00:00Z',
    timestamp: '2025-06-01T00:00:05Z',
    inside_temp: 21.5,
    outside_temp: 9,
    driver_temp_setting: 22,
    hvac_power: 'On',
    is_ac_on: true,
    fan_speed: 3,
    seat_heater_left: 2,
  };

  it('adds the camel aliases the interface declares while keeping snake_case', () => {
    const wired = wire(backend);
    expectMirror(wired, 'inside_temp', 'insideTemp', 21.5);
    expectMirror(wired, 'outside_temp', 'outsideTemp', 9);
    expectMirror(wired, 'driver_temp_setting', 'driverTempSetting', 22);
    expectMirror(wired, 'hvac_power', 'hvacPower', 'On');
    expectMirror(wired, 'is_ac_on', 'isAcOn', true);
    expectMirror(wired, 'fan_speed', 'fanSpeed', 3);
    expectMirror(wired, 'seat_heater_left', 'seatHeaterLeft', 2);
  });

  it('lets a consumer read the declared camel fields with the page ?? guard', () => {
    const wired = wire(backend);
    // The exact access ClimateControlPage uses: camel alias then nullish guard.
    const insideTemp = (wired.insideTemp as number | null | undefined) ?? 0;
    const fanSpeed = (wired.fanSpeed as number | null | undefined) ?? 0;
    expect(insideTemp).toBe(21.5);
    expect(fanSpeed).toBe(3);
  });

  it('models an offline sensor via the optional/nullable fields', () => {
    // A sparse reading (sensor offline) still satisfies the type; consumers
    // fall back with ?? rather than crashing on null.
    const sparse: ClimateState = { insideTemp: null, outsideTemp: null, isAcOn: null };
    expect(sparse.insideTemp).toBeNull();
    expect(sparse.insideTemp ?? 0).toBe(0);
    expect(sparse.isAcOn ?? false).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TirePressureReading + TirePosition + TireStatus
// ---------------------------------------------------------------------------

describe('TirePressureReading + position/status unions', () => {
  const reading: TirePressureReading = {
    id: 'tp-1',
    vehicleId: '42',
    frontLeft: 2.9,
    frontRight: 2.9,
    rearLeft: 3.0,
    rearRight: 3.05,
    tpmsHardWarning: false,
    tpmsSoftWarning: false,
    timestamp: '2025-06-01T00:00:00Z',
  };

  it('pins TirePosition to the four corners and indexes the reading by each', () => {
    const positions: TirePosition[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];
    // Exhaustive map — a widened/narrowed union fails to compile.
    const label: Record<TirePosition, string> = {
      frontLeft: 'Front Left',
      frontRight: 'Front Right',
      rearLeft: 'Rear Left',
      rearRight: 'Rear Right',
    };
    expect(Object.keys(label).sort()).toEqual([...positions].sort());
    const pressures = positions.map((p) => reading[p]);
    expect(pressures).toEqual([2.9, 2.9, 3.0, 3.05]);
    expect(pressures.every((v) => typeof v === 'number')).toBe(true);
  });

  it('classifies a corner into the TireStatus union by bar thresholds', () => {
    // Traffic-light logic: <2.4 bar critical, <2.7 bar warning, else normal.
    const classify = (bar: number): TireStatus =>
      bar < 2.4 ? 'critical' : bar < 2.7 ? 'warning' : 'normal';
    const rank: Record<TireStatus, number> = { normal: 0, warning: 1, critical: 2 };
    expect(Object.keys(rank).sort()).toEqual(['critical', 'normal', 'warning']);
    expect(classify(reading.frontLeft)).toBe('normal');
    expect(classify(2.5)).toBe('warning');
    expect(classify(2.1)).toBe('critical');
  });

  it('distinguishes a hard TPMS warning from a soft one', () => {
    const hard: TirePressureReading = { ...reading, tpmsHardWarning: true };
    expect(hard.tpmsHardWarning).toBe(true);
    expect(hard.tpmsSoftWarning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MaintenanceItem + ServiceRecord + MaintenanceStatus
// ---------------------------------------------------------------------------

describe('MaintenanceItem + ServiceRecord + status', () => {
  const item: MaintenanceItem = {
    id: 'm-1',
    name: 'Cabin air filter',
    description: 'Replace cabin air filter',
    intervalKm: 30000,
    intervalMonths: 24,
    category: 'filters',
    estimatedCostUsd: 60,
  };
  const record: ServiceRecord = {
    itemId: 'm-1',
    date: '2025-01-15',
    odometerKm: 24000,
    notes: 'done at service center',
  };

  it('pins MaintenanceStatus and derives it from the interval + last service', () => {
    const rank: Record<MaintenanceStatus, number> = { good: 0, soon: 1, overdue: 2 };
    expect(Object.keys(rank).sort()).toEqual(['good', 'overdue', 'soon']);
    // Next due = last-service odometer + interval; status by proximity to it.
    const dueKm = record.odometerKm + item.intervalKm; // 54000
    const status = (currentKm: number): MaintenanceStatus => {
      if (currentKm >= dueKm) return 'overdue';
      if (currentKm >= dueKm - 2000) return 'soon';
      return 'good';
    };
    expect(status(40000)).toBe('good');
    expect(status(53000)).toBe('soon');
    expect(status(60000)).toBe('overdue');
  });

  it('links a ServiceRecord back to its MaintenanceItem by id', () => {
    expect(record.itemId).toBe(item.id);
    expect(item.intervalKm).toBeGreaterThan(0);
    expect(item.estimatedCostUsd).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// SoftwareUpdate — inline lifecycle-status union + nullable timestamps
// ---------------------------------------------------------------------------

describe('SoftwareUpdate lifecycle status', () => {
  const base: SoftwareUpdate = {
    id: 'su-1',
    vehicleId: '42',
    version: '2025.14.9',
    status: 'installed',
    installedAt: '2025-05-01T00:00:00Z',
    scheduledAt: null,
    createdAt: '2025-04-28T00:00:00Z',
  };
  type UpdateStatus = SoftwareUpdate['status'];

  it('pins the five lifecycle states and marks the terminal one', () => {
    const order: Record<UpdateStatus, number> = {
      available: 0,
      scheduled: 1,
      downloading: 2,
      installing: 3,
      installed: 4,
    };
    expect(Object.keys(order).sort()).toEqual([
      'available',
      'downloading',
      'installed',
      'installing',
      'scheduled',
    ]);
    const isTerminal = (s: UpdateStatus): boolean => s === 'installed';
    expect(isTerminal('installed')).toBe(true);
    expect(isTerminal('downloading')).toBe(false);
  });

  it('carries installedAt for installed, scheduledAt for scheduled', () => {
    expect(base.installedAt).toBe('2025-05-01T00:00:00Z');
    expect(base.scheduledAt).toBeNull();
    const scheduled: SoftwareUpdate = {
      ...base,
      status: 'scheduled',
      installedAt: null,
      scheduledAt: '2025-06-01T00:00:00Z',
    };
    expect(scheduled.installedAt).toBeNull();
    expect(scheduled.scheduledAt).toBe('2025-06-01T00:00:00Z');
  });

  it('null-guards a missing installedAt when rendering a label', () => {
    const pending: SoftwareUpdate = { ...base, status: 'available', installedAt: null };
    expect(pending.installedAt ?? '—').toBe('—');
  });
});

// ---------------------------------------------------------------------------
// SafetySnapshot — snake_case wire + polymorphic ADAS enum funnel
// ---------------------------------------------------------------------------

describe('SafetySnapshot wire + enum funnel', () => {
  const snapshot: SafetySnapshot = {
    id: 1,
    vehicle_id: 42,
    automatic_blind_spot_camera: true,
    forward_collision_warning: 'ForwardCollisionSensitivityHigh',
    cruise_follow_distance: 'FollowDistance3',
    speed_limit_warning: 'SpeedAssistLevelNone',
    lane_departure_avoidance: false,
    pin_to_drive_enabled: true,
    miles_since_reset: 1200,
    created_at: '2025-06-01T00:00:00Z',
  };

  it('mirrors the snake_case tags into camelCase while preserving originals', () => {
    const wired = wire(snapshot);
    expectMirror(wired, 'vehicle_id', 'vehicleId', 42);
    expectMirror(wired, 'pin_to_drive_enabled', 'pinToDriveEnabled', true);
    expectMirror(wired, 'automatic_blind_spot_camera', 'automaticBlindSpotCamera', true);
    expectMirror(
      wired,
      'forward_collision_warning',
      'forwardCollisionWarning',
      'ForwardCollisionSensitivityHigh',
    );
  });

  it('cleans a typed enum STRING through the safetyEnum choke point', () => {
    expect(cleanSafetyEnum(snapshot.cruise_follow_distance, 'cruise_follow_distance')).toBe('3');
    expect(cleanSafetyEnum(snapshot.forward_collision_warning, 'forward_collision_warning')).toBe(
      'High',
    );
    // A "…None" speed-assist level is normalized to Off, not the raw "None".
    expect(cleanSafetyEnum(snapshot.speed_limit_warning, 'speed_limit_warning')).toBe('Off');
  });

  it('handles native boolean + numeric enum shapes without string coercion', () => {
    // These three shapes are why the field is typed string|boolean|number:
    // a naive String(false).toLowerCase() !== 'off' would wrongly read "on".
    expect(cleanSafetyEnum(false, 'forward_collision_warning')).toBe('Off');
    expect(cleanSafetyEnum(true, 'forward_collision_warning')).toBe('On');
    expect(cleanSafetyEnum(3, 'cruise_follow_distance')).toBe('3');
    expect(cleanSafetyEnum(null, 'lane_departure_avoidance')).toBe('—');
  });

  it('classifies active vs inactive across every polymorphic shape', () => {
    expect(isSafetyEnumActive(snapshot.cruise_follow_distance, 'cruise_follow_distance')).toBe(true);
    // …None → Off → inactive.
    expect(isSafetyEnumActive(snapshot.speed_limit_warning, 'speed_limit_warning')).toBe(false);
    expect(isSafetyEnumActive(false, 'forward_collision_warning')).toBe(false);
    expect(isSafetyEnumActive(0, 'cruise_follow_distance')).toBe(false);
    expect(isSafetyEnumActive('FollowDistance2', 'cruise_follow_distance')).toBe(true);
  });

  it('carries nullable ADAS toggles + legacy miles fields as declared', () => {
    const sparse: SafetySnapshot = {
      id: 2,
      vehicle_id: 7,
      forward_collision_warning: null,
      miles_since_reset: null,
    };
    expect(sparse.forward_collision_warning ?? '—').toBe('—');
    expect(sparse.miles_since_reset ?? 0).toBe(0);
  });
});
