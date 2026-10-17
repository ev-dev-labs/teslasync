import { describe, expect, it } from 'vitest';
import type { Drive } from '@/types/driving';
import { driveSeries } from './model';

function drive(id: number, startTs: string, overrides: Partial<Drive> = {}): Drive {
  return {
    id, vehicleId: 42, startTs, endTs: null, durationS: 60, distanceM: 1000,
    startAddress: null, endAddress: null, startLat: null, startLon: null,
    endLat: null, endLon: null, startBatteryPct: null, endBatteryPct: null,
    energyUsedWh: null, regenEnergyWh: null, avgSpeedMps: null, maxSpeedMps: null,
    avgPowerW: 5000, outsideTempAvgC: 10, insideTempAvgC: null, score: null,
    endedStatus: null, createdAt: startTs, updatedAt: startTs, ...overrides,
  };
}

describe('driveSeries exact workspace instants', () => {
  it.each([
    { name: 'rolling subsecond window', start: '2024-03-10T15:42:19.125Z', end: '2024-03-11T15:42:19.125Z' },
    { name: 'spring DST calendar', start: '2024-03-10T00:00:00-08:00', end: '2024-03-11T00:00:00-07:00' },
    { name: 'fall DST calendar', start: '2024-11-03T00:00:00-07:00', end: '2024-11-04T00:00:00-08:00' },
    { name: 'UTC final millisecond', start: '2024-01-31T00:00:00Z', end: '2024-02-01T00:00:00Z' },
  ])('includes the lower boundary and final millisecond but excludes the upper boundary for $name', ({ start, end }) => {
    const lower = new Date(start).toISOString();
    const last = new Date(Date.parse(end) - 1).toISOString();
    const source = [
      drive(1, new Date(Date.parse(start) - 1).toISOString()),
      drive(2, lower), drive(3, last), drive(4, new Date(end).toISOString()),
      drive(5, new Date(Date.parse(end) + 1).toISOString()), drive(6, 'invalid'),
    ];
    expect(driveSeries(source, start, end, value => value)).toEqual([
      { date: lower, powerMax: 5000, powerMin: null, outsideTemp: 10, distance: 1000 },
      { date: last, powerMax: 5000, powerMin: null, outsideTemp: 10, distance: 1000 },
    ]);
  });

  it('keeps the latest 30 chronological SI records and preserves source order and unknowns', () => {
    const source = Array.from({ length: 35 }, (_, id) => drive(
      id, new Date(Date.UTC(2024, 0, 1, 0, id)).toISOString(),
      { avgPowerW: id === 34 ? null : -id * 1000, outsideTempAvgC: id === 34 ? null : 0 },
    )).reverse();
    const originalIds = source.map(item => item.id);
    const rows = driveSeries(source, '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z', value => value);
    expect(rows).toHaveLength(30);
    expect(rows[0]).toEqual({ date: '2024-01-01T00:05:00.000Z', powerMax: -5000, powerMin: null, outsideTemp: 0, distance: 1000 });
    expect(rows[29]).toEqual({ date: '2024-01-01T00:34:00.000Z', powerMax: null, powerMin: null, outsideTemp: null, distance: 1000 });
    expect(source.map(item => item.id)).toEqual(originalIds);
  });

  it('returns no records for empty, invalid, reversed or equal ranges', () => {
    expect(driveSeries(null, '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z', value => value)).toEqual([]);
    for (const [start, end] of [
      ['invalid', '2024-01-02T00:00:00Z'],
      ['2024-01-01T00:00:00Z', 'invalid'],
      ['2024-01-02T00:00:00Z', '2024-01-01T00:00:00Z'],
      ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'],
    ]) {
      expect(driveSeries([drive(1, '2024-01-01T00:00:00Z')], start, end, value => value)).toEqual([]);
    }
  });
});
