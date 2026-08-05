import { describe, expect, it } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  buildDestinationTransitions,
  normalizeDestination,
} from './destinationTransitions';

let id = 1;

function drive(destination: string | null, hour: number, overrides: Partial<Drive> = {}): Drive {
  return {
    id: id++,
    vehicleId: 1,
    startTs: `2026-02-01T${String(hour).padStart(2, '0')}:00:00Z`,
    endTs: `2026-02-01T${String(hour).padStart(2, '0')}:30:00Z`,
    durationS: 1800,
    distanceM: 10_000,
    startAddress: 'Origin',
    endAddress: destination,
    startLat: 1,
    startLon: 1,
    endLat: destination == null ? null : 2,
    endLon: destination == null ? null : 2,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: 1800,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('normalizeDestination', () => {
  it('groups equivalent address spellings before considering GPS', () => {
    const a = normalizeDestination(drive('  Work, HQ ', 1, { endLat: 3 }));
    const b = normalizeDestination(drive('WORK HQ', 2, { endLat: 9 }));
    expect(a?.key).toBe(b?.key);
    expect(a?.label).toBe('Work, HQ');
  });

  it('falls back to rounded coordinates and rejects invalid locations', () => {
    expect(normalizeDestination(drive(null, 1, { endLat: 10.1234, endLon: -20.9876 }))).toEqual({
      key: 'geo:10.123,-20.988',
      label: '10.123, -20.988',
    });
    expect(normalizeDestination(drive(null, 2, { endLat: 100, endLon: 0 }))).toBeNull();
  });
});

describe('buildDestinationTransitions', () => {
  it('sorts drives chronologically before building transitions', () => {
    const result = buildDestinationTransitions([
      drive('C', 3),
      drive('A', 1),
      drive('B', 2),
    ]);
    expect(result.transitions).toBe(2);
    const rowA = result.matrix.find((row) => row.fromLabel === 'A')!;
    const rowB = result.matrix.find((row) => row.fromLabel === 'B')!;
    expect(rowA.cells.find((cell) => cell.toLabel === 'B')?.count).toBe(1);
    expect(rowB.cells.find((cell) => cell.toLabel === 'C')?.count).toBe(1);
  });

  it('returns complete matrix rows, visit shares, and entropy rate', () => {
    const result = buildDestinationTransitions([
      drive('A', 1),
      drive('B', 2),
      drive('A', 3),
      drive('B', 4),
      drive('C', 5),
    ]);
    const rowA = result.matrix.find((row) => row.fromLabel === 'A')!;
    const rowB = result.matrix.find((row) => row.fromLabel === 'B')!;
    expect(rowA.cells).toHaveLength(3);
    expect(rowA.entropyBits).toBe(0);
    expect(rowB.entropyBits).toBe(1);
    expect(result.entropyRateBits).toBeCloseTo(0.5);
    expect(result.states.reduce((sum, state) => sum + state.visitShare, 0)).toBeCloseTo(1);
  });

  it('computes normalized predictability', () => {
    const deterministic = buildDestinationTransitions([
      drive('A', 1), drive('B', 2), drive('A', 3), drive('B', 4),
    ]);
    expect(deterministic.predictability).toBe(1);

    const branching = buildDestinationTransitions([
      drive('A', 1), drive('B', 2), drive('A', 3), drive('C', 4),
    ]);
    expect(branching.predictability).not.toBeNull();
    expect(branching.predictability!).toBeLessThan(1);
  });

  it('predicts from the latest destination when that state has history', () => {
    const result = buildDestinationTransitions([
      drive('Home', 1),
      drive('Work', 2),
      drive('Home', 3),
      drive('Work', 4),
      drive('Home', 5),
    ]);
    expect(result.prediction).toMatchObject({
      fromLabel: 'Home',
      toLabel: 'Work',
      probability: 1,
      count: 2,
    });
  });

  it('ranks rare observed edges as surprising', () => {
    const result = buildDestinationTransitions([
      drive('A', 1), drive('B', 2),
      drive('A', 3), drive('B', 4),
      drive('A', 5), drive('B', 6),
      drive('A', 7), drive('C', 8),
    ]);
    expect(result.surprisingTransitions[0]).toMatchObject({
      fromLabel: 'A',
      toLabel: 'C',
      probability: 0.25,
      surpriseBits: 2,
    });
  });

  it('lets an unknown destination break rather than bridge the sequence', () => {
    const result = buildDestinationTransitions([
      drive('A', 1),
      drive(null, 2),
      drive('B', 3),
    ]);
    expect(result.visits).toBe(2);
    expect(result.transitions).toBe(0);
    expect(result.entropyRateBits).toBeNull();
    expect(result.predictability).toBeNull();
    expect(result.prediction).toBeNull();
  });

  it('handles empty and invalid-time input without fabricating states', () => {
    const result = buildDestinationTransitions([
      drive('A', 1, { startTs: 'invalid' }),
    ]);
    expect(result.states).toEqual([]);
    expect(result.matrix).toEqual([]);
    expect(buildDestinationTransitions([]).transitions).toBe(0);
  });
});
