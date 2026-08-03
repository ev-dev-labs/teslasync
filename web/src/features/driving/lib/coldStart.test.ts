import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { summarizeColdStarts, COLD_GAP_HOURS, WARM_GAP_HOURS } from './coldStart';

let nextId = 1;

const HOUR = 3_600_000;

/** Chain builder: each drive starts `gapH` hours after the previous ended. */
function chain(specs: { gapH: number; whPerKm: number }[]): Drive[] {
  const drives: Drive[] = [];
  let cursor = new Date(2026, 0, 5, 8).getTime();
  for (const { gapH, whPerKm } of specs) {
    cursor += gapH * HOUR;
    const start = new Date(cursor);
    const end = new Date(cursor + HOUR);
    drives.push({
      id: nextId++,
      vehicleId: 1,
      startTs: start.toISOString(),
      endTs: end.toISOString(),
      durationS: 3600,
      distanceM: 10_000,
      startAddress: null,
      endAddress: null,
      startLat: null,
      startLon: null,
      endLat: null,
      endLon: null,
      startBatteryPct: 80,
      endBatteryPct: 70,
      energyUsedWh: whPerKm * 10,
      regenEnergyWh: null,
      avgSpeedMps: 15,
      maxSpeedMps: 30,
      avgPowerW: null,
      outsideTempAvgC: 5,
      insideTempAvgC: null,
      score: null,
      endedStatus: null,
      createdAt: '',
      updatedAt: '',
    });
    cursor = end.getTime();
  }
  return drives;
}

describe('summarizeColdStarts', () => {
  it('splits drives into cold and warm groups by preceding gap', () => {
    const drives = chain([
      { gapH: 0, whPerKm: 150 }, // first drive: no preceding gap, not classified
      { gapH: 12, whPerKm: 190 }, // cold
      { gapH: 0.5, whPerKm: 150 }, // warm
      { gapH: 3, whPerKm: 170 }, // ambiguous — excluded
    ]);
    const s = summarizeColdStarts(drives);
    expect(s.cold.drives).toBe(1);
    expect(s.warm.drives).toBe(1);
    expect(s.analyzed).toBe(3);
  });

  it('quantifies the cold-start penalty with enough samples on both sides', () => {
    const specs = [
      { gapH: 0, whPerKm: 150 },
      ...Array.from({ length: 5 }, () => ({ gapH: 12, whPerKm: 190 })),
      ...Array.from({ length: 5 }, () => ({ gapH: 0.5, whPerKm: 150 })),
    ];
    const s = summarizeColdStarts(chain(specs));
    expect(s.cold.whPerKm).toBe(190);
    expect(s.warm.whPerKm).toBe(150);
    expect(s.penaltyWhPerKm).toBe(40);
    expect(s.penaltyShare).toBeCloseTo(40 / 150);
    // 40 Wh/km × 50 km of cold driving.
    expect(s.totalPenaltyWh).toBe(2000);
    expect(s.coldShare).toBeCloseTo(5 / 10);
  });

  it('withholds the penalty when either group is thin', () => {
    const s = summarizeColdStarts(chain([
      { gapH: 0, whPerKm: 150 },
      { gapH: 12, whPerKm: 190 },
      { gapH: 0.5, whPerKm: 150 },
    ]));
    expect(s.penaltyWhPerKm).toBeNull();
    expect(s.totalPenaltyWh).toBeNull();
  });

  it('skips drives without usable energy or distance', () => {
    const drives = chain([
      { gapH: 0, whPerKm: 150 },
      { gapH: 12, whPerKm: 190 },
    ]);
    drives[1] = { ...drives[1]!, energyUsedWh: null };
    expect(summarizeColdStarts(drives).analyzed).toBe(0);
  });

  it('exports sane thresholds', () => {
    expect(COLD_GAP_HOURS).toBeGreaterThan(WARM_GAP_HOURS);
  });

  it('handles empty input', () => {
    const s = summarizeColdStarts([]);
    expect(s.analyzed).toBe(0);
    expect(s.penaltyWhPerKm).toBeNull();
    expect(s.coldShare).toBeNull();
  });
});
