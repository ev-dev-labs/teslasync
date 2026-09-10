import { describe, expect, it } from 'vitest';

import type { DriveFsdInsight } from '@/types/fsd';
import type { DriveStats } from './types';
import { interpretDriveDebrief } from './drivePhysicsDebrief';

const stats = (overrides: Partial<DriveStats> = {}): DriveStats => ({
  maxSpd: 70,
  avgSpd: 40,
  minSpd: 5,
  powerMax: 120,
  powerMin: -40,
  avgPower: 18,
  energyWh: 12_000,
  regenWh: 2_000,
  consumptionWhKm: 180,
  elevGain: 40,
  elevLoss: 30,
  avgOutsideTemp: null,
  avgInsideTemp: null,
  hasAnyTemp: false,
  insideTemps: [],
  outsideTemps: [],
  driverTemps: [],
  passengerTemps: [],
  climateStatus: null,
  avgFanSpeed: null,
  maxFanSpeed: null,
  startRange: null,
  endRange: null,
  odometerStart: 0,
  odometerEnd: 0,
  hasTirePressure: false,
  efficiencyPctPer100: null,
  ...overrides,
});

describe('interpretDriveDebrief', () => {
  it('tells launch + regen + honest missing pads/thermal', () => {
    const debrief = interpretDriveDebrief(stats(), [{
      time: '10:01',
      speed: 40,
      battery: 70,
      elevation: 10,
      power: 90,
      outsideTemp: null,
      insideTemp: null,
      driverTemp: null,
      passengerTemp: null,
      idealRange: null,
      ratedRange: null,
      estRange: null,
      odometer: null,
      soc: 70,
      usableSoc: null,
      tireFl: null,
      tireFr: null,
      tireRl: null,
      tireRr: null,
      climateOn: null,
      fanStatus: null,
    }], {
      drive_id: 1,
      started_at: '2026-01-01T10:00:00Z',
      ended_at: '2026-01-01T10:40:00Z',
      start_place: 'Home',
      end_place: 'Office',
      distance_m: 20_000,
      energy_used_wh: 4000,
      fsd_distance_m: 8_000,
      fsd_share_pct: 40,
      confidence: 'high',
      reset_affected: false,
      firmware_version: '2026.20.3',
      evidence: [],
      evidence_truncated: false,
    } satisfies DriveFsdInsight);

    expect(debrief.beats.find((beat) => beat.id === 'launch')?.honesty).toBe('live');
    expect(debrief.beats.find((beat) => beat.id === 'blended')?.honesty).toBe('missing');
    expect(debrief.fsdSharePct).toBe(40);
  });

  it('does not invent FSD km', () => {
    const debrief = interpretDriveDebrief(stats({ powerMax: 0, regenWh: 0, energyWh: 0 }), [], undefined);
    expect(debrief.beats.find((beat) => beat.id === 'fsd')?.honesty).toBe('missing');
    expect(debrief.beats.find((beat) => beat.id === 'gap')?.honesty).toBe('missing');
  });
});
