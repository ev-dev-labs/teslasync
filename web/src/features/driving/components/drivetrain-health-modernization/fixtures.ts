import type { Drive, DrivetrainHealthData, DrivingStats } from '@/types/driving';
import type { MotorSnapshot } from '@/api/types';

/** Authored fixtures only; never passed to a production query or presenter. */
export const healthFixture: DrivetrainHealthData = {
  frontMotorTempC: 0,
  rearMotorTempC: 98,
  inverterTempC: 70,
  batteryTempC: null,
  motorStatus: 'Warm',
  overallHealth: 'warning',
};

export const statsFixture: DrivingStats = {
  totalDrives: 2,
  totalDistanceKm: 12,
  totalDurationS: 600,
  avgEfficiencyWhKm: null,
  avgSpeedKmh: 36,
  topSpeedKmh: 72,
  regenRatio: 0,
  regenEnergyWh: 0,
  co2SavedKg: 0,
};

export function driveFixture(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicleId: 7,
    startTs: '2026-09-01T12:00:00',
    endTs: '2026-09-01T12:10:00',
    durationS: 600,
    distanceM: 0,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: null,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: 0,
    outsideTempAvgC: 0,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '2026-09-01T12:00:00',
    updatedAt: '2026-09-01T12:10:00',
    ...overrides,
  };
}

export function motorFixture(overrides: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    id: 1,
    vehicle_id: 7,
    ts: '2026-09-01T12:00:00',
    created_at: '2026-09-01T12:00:00',
    torque_nm_front: 0,
    torque_nm_rear: 30,
    di_torque: null,
    motor_rpm_front: 0,
    motor_rpm_rear: 40,
    motor_temp_c_front: 0,
    motor_temp_c_rear: 40,
    inverter_temp_c: 45,
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
    power_kw: 0,
    regen_kw: 0,
    battery_temp_c: null,
    source: 'fixture-only',
    ...overrides,
  };
}
