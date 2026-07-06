/**
 * driving-dynamics/helpers — behaviour + hardening coverage.
 *
 * Four pure exports back the Driving Dynamics page. This suite exercises every
 * branch plus the real bug the hardening fixed:
 *   - getThrottleStyle — the three-band classifier and its <20 / <80 kW
 *     boundaries, negative input, and the non-finite guard (NaN / ±Infinity →
 *     'conservative' instead of the pre-fix 'aggressive' fall-through).
 *   - gForceColor — the four-colour intensity ramp. The pre-fix version bucketed
 *     on the *signed* value, so a hard brake (negative longitudinal g — a real
 *     DriveDynamicsSnapshot value) collapsed into the calm green band; it now
 *     ramps on |g| and treats non-finite telemetry as neutral.
 *   - SPEED_BUCKETS_RANGES — the contiguous, open-topped speed-histogram config
 *     consumed by DriveAnalyticsSection.
 *   - computeMotorStats — the MotorSnapshot[] → MotorStats reducer, including its
 *     null / undefined / empty guards, per-axle null handling, temperature-max
 *     logic, power/regen gap filtering, the strict >200 Nm high-torque threshold,
 *     and the documented "0 = no data" numeric sentinel.
 *
 * Pure logic: no components, hooks, network, or timers are involved, so this
 * follows the repo's existing `helpers.test.ts` convention (plain Vitest, no
 * RTL / MSW needed).
 */
import { describe, it, expect } from 'vitest';
import type { MotorSnapshot } from '@/api/types';
import {
  getThrottleStyle,
  gForceColor,
  SPEED_BUCKETS_RANGES,
  computeMotorStats,
} from '../helpers';

const GREEN = '#22c55e';
const BLUE = '#3b82f6';
const YELLOW = '#eab308';
const RED = '#ef4444';

/** Build a fully-typed MotorSnapshot; all telemetry defaults to null/absent. */
function makeSnapshot(overrides: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    ts: '2024-01-01T00:00:00Z',
    created_at: '2024-01-01T00:00:00Z',
    torque_nm_front: null,
    torque_nm_rear: null,
    di_torque: null,
    motor_rpm_front: null,
    motor_rpm_rear: null,
    motor_temp_c_front: null,
    motor_temp_c_rear: null,
    inverter_temp_c: null,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: null,
    motor_current_rear: null,
    state_front: null,
    state_rear: null,
    shift_state: null,
    vbat_front: null,
    vbat_rear: null,
    ...overrides,
  };
}

describe('getThrottleStyle', () => {
  it('classifies avg power below 20 kW as conservative (incl. zero and negative)', () => {
    expect(getThrottleStyle(0)).toBe('conservative');
    expect(getThrottleStyle(19.99)).toBe('conservative');
    expect(getThrottleStyle(-42)).toBe('conservative');
  });

  it('classifies the [20, 80) kW band as moderate at both boundaries', () => {
    expect(getThrottleStyle(20)).toBe('moderate'); // lower boundary is inclusive
    expect(getThrottleStyle(50)).toBe('moderate');
    expect(getThrottleStyle(79.99)).toBe('moderate');
  });

  it('classifies 80 kW and above as aggressive', () => {
    expect(getThrottleStyle(80)).toBe('aggressive'); // upper boundary flips
    expect(getThrottleStyle(250)).toBe('aggressive');
  });

  it('guards non-finite input to conservative (never falls through to aggressive)', () => {
    expect(getThrottleStyle(Number.NaN)).toBe('conservative');
    expect(getThrottleStyle(Number.POSITIVE_INFINITY)).toBe('conservative');
    expect(getThrottleStyle(Number.NEGATIVE_INFINITY)).toBe('conservative');
  });
});

describe('gForceColor', () => {
  it('ramps green → blue → yellow → red across the |g| bands', () => {
    expect(gForceColor(0)).toBe(GREEN);
    expect(gForceColor(0.19)).toBe(GREEN);
    expect(gForceColor(0.3)).toBe(BLUE);
    expect(gForceColor(0.5)).toBe(YELLOW);
    expect(gForceColor(0.75)).toBe(RED);
  });

  it('uses half-open band boundaries (0.2 / 0.4 / 0.6 step up)', () => {
    expect(gForceColor(0.2)).toBe(BLUE);
    expect(gForceColor(0.4)).toBe(YELLOW);
    expect(gForceColor(0.6)).toBe(RED);
  });

  it('buckets by magnitude so braking / left-turn (negative g) escalates too', () => {
    // Pre-fix bug: negative g collapsed into the calm green band regardless of
    // how hard the brake / corner was.
    expect(gForceColor(-0.1)).toBe(GREEN);
    expect(gForceColor(-0.5)).toBe(YELLOW);
    expect(gForceColor(-0.8)).toBe(RED);
    // Symmetry: sign never changes the colour.
    expect(gForceColor(-0.5)).toBe(gForceColor(0.5));
  });

  it('treats non-finite telemetry as the neutral (green) band', () => {
    expect(gForceColor(Number.NaN)).toBe(GREEN);
    expect(gForceColor(Number.POSITIVE_INFINITY)).toBe(GREEN);
    expect(gForceColor(Number.NEGATIVE_INFINITY)).toBe(GREEN);
  });

  it('always returns one of the four defined hex tokens', () => {
    const palette = new Set([GREEN, BLUE, YELLOW, RED]);
    for (const g of [-2, -0.6, -0.4, -0.2, 0, 0.05, 0.2, 0.4, 0.6, 3]) {
      expect(palette.has(gForceColor(g))).toBe(true);
    }
  });
});

describe('SPEED_BUCKETS_RANGES', () => {
  it('exposes five buckets with the expected labels', () => {
    expect(SPEED_BUCKETS_RANGES).toHaveLength(5);
    expect(SPEED_BUCKETS_RANGES.map((b) => b.label)).toEqual([
      '0–30',
      '30–60',
      '60–90',
      '90–120',
      '120+',
    ]);
  });

  it('starts at 0, is gap-free, and is open-topped (last max = Infinity)', () => {
    expect(SPEED_BUCKETS_RANGES[0].min).toBe(0);
    expect(SPEED_BUCKETS_RANGES[SPEED_BUCKETS_RANGES.length - 1].max).toBe(Infinity);
    for (let i = 1; i < SPEED_BUCKETS_RANGES.length; i++) {
      // Each bucket begins exactly where the previous ended — no gaps/overlaps.
      expect(SPEED_BUCKETS_RANGES[i].min).toBe(SPEED_BUCKETS_RANGES[i - 1].max);
    }
  });

  it('has a strictly positive width for every bucket', () => {
    for (const b of SPEED_BUCKETS_RANGES) {
      expect(b.max).toBeGreaterThan(b.min);
    }
  });
});

describe('computeMotorStats', () => {
  it('returns null for undefined input and for an empty history', () => {
    expect(computeMotorStats(undefined)).toBeNull();
    expect(computeMotorStats([])).toBeNull();
  });

  it('reduces a mixed history into the expected aggregate (happy path)', () => {
    const history: MotorSnapshot[] = [
      makeSnapshot({
        torque_nm_front: 100,
        torque_nm_rear: 100,
        motor_temp_c_front: 40,
        motor_temp_c_rear: 60,
        power_kw: 10,
        regen_kw: 5,
      }),
      makeSnapshot({
        torque_nm_front: 150,
        torque_nm_rear: 150,
        motor_temp_c_front: 50,
        motor_temp_c_rear: null,
        power_kw: 30,
        regen_kw: 0,
      }),
      // torque / temp / power all absent → excluded from those aggregates,
      // but the reading (and its regen) still counts.
      makeSnapshot({ regen_kw: 20 }),
    ];

    expect(computeMotorStats(history)).toEqual({
      totalReadings: 3,
      avgTorque: 250,
      maxTorque: 300,
      avgMotorTemp: 55,
      maxMotorTemp: 60,
      avgPower: 20,
      peakPower: 30,
      minPower: 10,
      peakRegen: 20,
      // 1 of 2 torque readings (300) is >200; 200 is NOT (strict >).
      highTorquePct: 50,
    });
  });

  it('sums a single populated axle, treating the missing axle as 0', () => {
    const frontOnly = computeMotorStats([
      makeSnapshot({ torque_nm_front: 120, torque_nm_rear: null }),
    ]);
    expect(frontOnly?.avgTorque).toBe(120);
    expect(frontOnly?.maxTorque).toBe(120);

    const rearOnly = computeMotorStats([
      makeSnapshot({ torque_nm_front: null, torque_nm_rear: 80 }),
    ]);
    expect(rearOnly?.avgTorque).toBe(80);
  });

  it('takes the hotter of the two motor temps, tolerating a null axle', () => {
    const stats = computeMotorStats([
      makeSnapshot({ motor_temp_c_front: 45, motor_temp_c_rear: null }), // → 45
      makeSnapshot({ motor_temp_c_front: null, motor_temp_c_rear: 70 }), // → 70
    ]);
    expect(stats?.maxMotorTemp).toBe(70);
    expect(stats?.avgMotorTemp).toBeCloseTo(57.5);
  });

  it('filters power/regen gaps (null AND undefined) instead of counting them as 0', () => {
    const stats = computeMotorStats([
      makeSnapshot({ power_kw: 40, regen_kw: 8 }),
      makeSnapshot({ power_kw: null }), // explicit gap — excluded
      makeSnapshot({}), // power_kw absent (undefined) — excluded
      makeSnapshot({ power_kw: 20, regen_kw: 12 }),
    ]);
    expect(stats?.totalReadings).toBe(4); // every row still counts as a reading
    expect(stats?.avgPower).toBe(30); // mean of [40, 20], not diluted by the gaps
    expect(stats?.minPower).toBe(20);
    expect(stats?.peakPower).toBe(40);
    expect(stats?.peakRegen).toBe(12);
  });

  it('applies the >200 Nm high-torque threshold strictly (200 does not count)', () => {
    const stats = computeMotorStats([
      makeSnapshot({ torque_nm_front: 200, torque_nm_rear: 0 }), // exactly 200 → excluded
      makeSnapshot({ torque_nm_front: 201, torque_nm_rear: 0 }), // >200 → counted
    ]);
    expect(stats?.highTorquePct).toBe(50);
  });

  it('yields the documented 0 sentinel for aggregates when readings carry no data', () => {
    // A reading with every telemetry field null is still counted, but its absent
    // metrics collapse to 0 (the numeric "no data" sentinel the panels pair with
    // their own "—" placeholder when the whole MotorStats object is null).
    const stats = computeMotorStats([makeSnapshot(), makeSnapshot()]);
    expect(stats).not.toBeNull();
    expect(stats?.totalReadings).toBe(2);
    expect(stats?.avgTorque).toBe(0);
    expect(stats?.maxMotorTemp).toBe(0);
    expect(stats?.avgPower).toBe(0);
    expect(stats?.highTorquePct).toBe(0);
  });

  it('feeds getThrottleStyle a finite avgPower end-to-end', () => {
    const stats = computeMotorStats([
      makeSnapshot({ power_kw: 10 }),
      makeSnapshot({ power_kw: 30 }),
    ]);
    // avgPower = 20 → the moderate band's inclusive lower boundary.
    expect(stats?.avgPower).toBe(20);
    expect(getThrottleStyle(stats?.avgPower ?? 0)).toBe('moderate');
  });
});
