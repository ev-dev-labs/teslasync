import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { computeAnatomy, layoutSankey } from './energyAnatomy';

let nextId = 1;

function drive(over: Partial<Drive>): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: null,
    durationS: 3600,
    distanceM: 60_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: 10_000,
    regenEnergyWh: 1_000,
    avgSpeedMps: 16.7,
    maxSpeedMps: 33,
    avgPowerW: null,
    outsideTempAvgC: 0,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('computeAnatomy', () => {
  it('components always sum exactly to the measured total', () => {
    const a = computeAnatomy([drive({}), drive({ avgSpeedMps: 33, energyUsedWh: 18_000 })]);
    expect(a.aeroWh + a.rollingWh + a.climateWh + a.otherWh).toBe(a.totalWh);
    expect(a.totalWh).toBe(28_000);
    expect(a.drives).toBe(2);
  });

  it('caps modeled physics at the measured energy (no negative other)', () => {
    // Tiny measured energy despite fast/long driving: modeled terms overshoot
    // and must be rescaled rather than pushing `other` negative.
    const a = computeAnatomy([drive({ energyUsedWh: 500, avgSpeedMps: 33 })]);
    expect(a.otherWh).toBeGreaterThanOrEqual(0);
    expect(a.aeroWh + a.rollingWh + a.climateWh + a.otherWh).toBe(a.totalWh);
    expect(a.totalWh).toBe(500);
  });

  it('gives faster driving a larger aero share', () => {
    const slow = computeAnatomy([drive({ avgSpeedMps: 11, energyUsedWh: 9_000 })]);
    const fast = computeAnatomy([drive({ avgSpeedMps: 33, energyUsedWh: 18_000 })]);
    expect(fast.aeroWh / fast.totalWh).toBeGreaterThan(slow.aeroWh / slow.totalWh);
  });

  it('charges climate only when temperature deviates from comfort', () => {
    const mild = computeAnatomy([drive({ outsideTempAvgC: 20 })]);
    const cold = computeAnatomy([drive({ outsideTempAvgC: -10 })]);
    expect(mild.climateWh).toBe(0);
    expect(cold.climateWh).toBeGreaterThan(0);
  });

  it('collects regen as a separate credit and skips unusable drives', () => {
    const a = computeAnatomy([
      drive({ regenEnergyWh: 2_000 }),
      drive({ energyUsedWh: null }), // unusable
      drive({ distanceM: 500 }), // too short
    ]);
    expect(a.drives).toBe(1);
    expect(a.regenWh).toBe(2_000);
  });

  it('handles empty input', () => {
    const a = computeAnatomy([]);
    expect(a.totalWh).toBe(0);
    expect(a.drives).toBe(0);
  });
});

describe('layoutSankey', () => {
  const flows = [
    { key: 'aero', value: 500 },
    { key: 'rolling', value: 300 },
    { key: 'climate', value: 200 },
  ];

  it('sizes ribbons proportionally to flow values', () => {
    const l = layoutSankey(flows, 640, 320);
    expect(l.links).toHaveLength(3);
    const [aero, rolling] = l.links;
    expect(aero!.thickness / rolling!.thickness).toBeCloseTo(500 / 300, 1);
  });

  it('drops zero and negative flows', () => {
    const l = layoutSankey([...flows, { key: 'zero', value: 0 }, { key: 'neg', value: -5 }]);
    expect(l.links.map((x) => x.key)).toEqual(['aero', 'rolling', 'climate']);
  });

  it('keeps every node inside the viewport', () => {
    const l = layoutSankey(flows, 640, 320);
    for (const node of [l.source, ...l.targets]) {
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y + node.height).toBeLessThanOrEqual(320 + 0.001);
      expect(node.x + node.width).toBeLessThanOrEqual(640);
    }
  });

  it('gives tiny flows a visible minimum thickness', () => {
    const l = layoutSankey([{ key: 'big', value: 10_000 }, { key: 'tiny', value: 1 }]);
    expect(l.links.find((x) => x.key === 'tiny')!.thickness).toBeGreaterThanOrEqual(2);
  });

  it('handles an empty flow list', () => {
    const l = layoutSankey([]);
    expect(l.links).toEqual([]);
    expect(l.targets).toEqual([]);
  });
});
