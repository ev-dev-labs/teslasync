import { describe, expect, it } from 'vitest';

import type { DriveDynamicsSnapshot, MotorSnapshot } from '@/api/types';
import { interpretGrokDynamics, rearTorqueSharePct } from '../grokDynamics';

function motor(over: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    ts: '2026-03-01T12:00:00Z',
    created_at: '2026-03-01T12:00:00Z',
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
    shift_state: 'D',
    vbat_front: null,
    vbat_rear: null,
    ...over,
  };
}

function dynamics(over: Partial<DriveDynamicsSnapshot> = {}): DriveDynamicsSnapshot {
  return { ...over };
}

describe('rearTorqueSharePct', () => {
  it('returns null when both axles are missing or near zero', () => {
    expect(rearTorqueSharePct(null, null)).toBeNull();
    expect(rearTorqueSharePct(0, 0)).toBeNull();
  });

  it('uses absolute torque so regen still reports a split', () => {
    expect(rearTorqueSharePct(-100, -300)).toBe(75);
  });
});

describe('interpretGrokDynamics', () => {
  it('stays unknown when nothing was measured', () => {
    const read = interpretGrokDynamics(null, null);
    expect(read.hasSignal).toBe(false);
    expect(read.mode).toBe('unknown');
    expect(read.findings).toEqual([]);
  });

  it('classifies Park even when residual torque is present', () => {
    const read = interpretGrokDynamics(
      motor({ shift_state: 'P', torque_nm_front: 5, torque_nm_rear: 5 }),
      dynamics(),
    );
    expect(read.mode).toBe('parked');
    expect(read.findings.map((f) => f.id)).toContain('parked');
  });

  it('classifies regen and one-pedal when the brake switch is off', () => {
    const read = interpretGrokDynamics(
      motor({
        torque_nm_front: -80,
        torque_nm_rear: -40,
        regen_kw: 12,
        power_kw: 0,
      }),
      dynamics({ brake_pedal_active: false, pedal_position: 0 }),
    );
    expect(read.mode).toBe('regen');
    expect(read.regenPowerW).toBe(12_000);
    expect(read.findings.map((f) => f.id)).toEqual(
      expect.arrayContaining(['regen_harvest', 'one_pedal', 'awd_front']),
    );
  });

  it('classifies blended braking when the hydraulic pedal is in during regen', () => {
    const read = interpretGrokDynamics(
      motor({ torque_nm_front: -120, torque_nm_rear: -80, regen_kw: 20 }),
      dynamics({ brake_pedal_active: true, brake_pedal_position: 40 }),
    );
    expect(read.mode).toBe('blended_brake');
    expect(read.findings.map((f) => f.id)).toContain('blended_brake');
    expect(read.findings.map((f) => f.id)).not.toContain('one_pedal');
  });

  it('classifies launch from pedal, torque, and longitudinal g', () => {
    const read = interpretGrokDynamics(
      motor({ torque_nm_front: 200, torque_nm_rear: 350, power_kw: 180 }),
      dynamics({
        pedal_position: 92,
        longitudinal_acceleration: 0.55,
        lateral_acceleration: 0.05,
      }),
    );
    expect(read.mode).toBe('launch');
    expect(read.drivePowerW).toBe(180_000);
    expect(read.rearTorqueSharePct).toBeCloseTo(63.64, 1);
  });

  it('classifies cornering from lateral g when not launching or regen', () => {
    const read = interpretGrokDynamics(
      motor({ torque_nm_front: 80, torque_nm_rear: 90, power_kw: 40 }),
      dynamics({
        pedal_position: 30,
        lateral_acceleration: 0.42,
        longitudinal_acceleration: 0.1,
      }),
    );
    expect(read.mode).toBe('cornering');
    expect(read.combinedG).toBeCloseTo(Math.sqrt(0.42 * 0.42 + 0.1 * 0.1), 5);
  });

  it('flags hot stator temperature without inventing a zero when temps are missing', () => {
    const hot = interpretGrokDynamics(
      motor({ torque_nm_front: 50, torque_nm_rear: 50, motor_temp_c_rear: 125 }),
      dynamics({ pedal_position: 20 }),
    );
    expect(hot.thermal).toBe('hot');
    expect(hot.findings.map((f) => f.id)).toContain('thermal_hot');

    const unknown = interpretGrokDynamics(
      motor({ torque_nm_front: 50, torque_nm_rear: 50 }),
      dynamics({ pedal_position: 20 }),
    );
    expect(unknown.thermal).toBe('unknown');
    expect(unknown.maxMotorTempC).toBeNull();
  });

  it('does not coerce a missing accelerometer axis to zero combined g', () => {
    const read = interpretGrokDynamics(
      motor({ torque_nm_front: 40, torque_nm_rear: 40 }),
      dynamics({ lateral_acceleration: 0.2 }),
    );
    expect(read.combinedG).toBeNull();
    expect(read.longitudinalG).toBeNull();
  });
});
