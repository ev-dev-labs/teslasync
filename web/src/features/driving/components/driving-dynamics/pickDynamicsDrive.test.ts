import { describe, expect, it } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  isOpenDrive,
  mergeOpenDrives,
  motorWindowForDrive,
  pickDynamicsDrive,
} from './pickDynamicsDrive';

function drive(over: Partial<Drive> & { id: number }): Drive {
  return {
    vehicleId: 1,
    startTs: '2026-09-07T10:00:00Z',
    endTs: '2026-09-07T11:00:00Z',
    durationS: 3600,
    distanceM: 10_000,
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
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '2026-09-07T10:00:00Z',
    updatedAt: '2026-09-07T11:00:00Z',
    ...over,
  };
}

describe('pickDynamicsDrive', () => {
  it('returns null for an empty list', () => {
    expect(pickDynamicsDrive([])).toBeNull();
  });

  it('honours a requested id when present', () => {
    const older = drive({ id: 1, startTs: '2026-09-06T10:00:00Z' });
    const newer = drive({ id: 2, startTs: '2026-09-07T10:00:00Z' });
    expect(pickDynamicsDrive([older, newer], '1')?.id).toBe(1);
  });

  it('prefers an in-progress drive over a newer completed one', () => {
    const open = drive({ id: 9, startTs: '2026-09-07T08:00:00Z', endTs: null, live: true });
    const done = drive({ id: 10, startTs: '2026-09-07T12:00:00Z' });
    expect(isOpenDrive(open)).toBe(true);
    expect(pickDynamicsDrive([done, open])?.id).toBe(9);
  });

  it('falls back to the newest start when nothing is open', () => {
    const a = drive({ id: 1, startTs: '2026-09-01T10:00:00Z' });
    const b = drive({ id: 2, startTs: '2026-09-07T10:00:00Z' });
    expect(pickDynamicsDrive([a, b])?.id).toBe(2);
  });
});

describe('mergeOpenDrives', () => {
  it('keeps an in-progress drive that started before the date filter', () => {
    const open = drive({ id: 3, startTs: '2026-08-01T10:00:00Z', endTs: null });
    const inRange = drive({ id: 4, startTs: '2026-09-07T10:00:00Z' });
    const merged = mergeOpenDrives([inRange], [open, inRange]);
    expect(merged.map((d) => d.id)).toEqual([4, 3]);
  });
});

describe('motorWindowForDrive', () => {
  it('extends a completed end by 1s so the exclusive API bound keeps the last sample', () => {
    const window = motorWindowForDrive(
      drive({ id: 1, startTs: '2026-09-07T10:00:00.000Z', endTs: '2026-09-07T11:00:00.000Z' }),
    );
    expect(window?.start).toBe('2026-09-07T10:00:00.000Z');
    expect(window?.end).toBe('2026-09-07T11:00:01.000Z');
  });

  it('uses now for an open drive', () => {
    const now = new Date('2026-09-07T15:00:00.000Z');
    const window = motorWindowForDrive(
      drive({ id: 1, startTs: '2026-09-07T14:00:00.000Z', endTs: null }),
      now,
    );
    expect(window?.end).toBe('2026-09-07T15:00:01.000Z');
  });
});
