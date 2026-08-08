import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  buildLandscape,
  lerpHex,
  scalePosition,
  MIN_CELL_DISTANCE_M,
  SPEED_BANDS_KPH,
  TEMP_BANDS_C,
} from './efficiencyLandscape';

let nextId = 1;

function drive(speedKph: number, tempC: number, whPerKm: number, distanceM = 20_000): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: null,
    durationS: (distanceM / 1000 / speedKph) * 3600,
    distanceM,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: whPerKm * (distanceM / 1000),
    regenEnergyWh: null,
    avgSpeedMps: speedKph / 3.6,
    maxSpeedMps: (speedKph + 20) / 3.6,
    avgPowerW: null,
    outsideTempAvgC: tempC,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('buildLandscape', () => {
  it('routes drives into the right speed × temp cell', () => {
    const l = buildLandscape([drive(60, 18, 150), drive(60, 18, 170)]);
    // 60 km/h → speed band 2 (50–70); 18 °C → temp band 3 (15–25).
    const cell = l.cells[3]![2]!;
    expect(cell.drives).toBe(2);
    expect(cell.whPerKm).toBe(160);
    expect(l.analyzed).toBe(2);
  });

  it('weights cell consumption by distance', () => {
    const l = buildLandscape([
      drive(60, 18, 100, 90_000),
      drive(60, 18, 200, 10_000),
    ]);
    expect(l.cells[3]![2]!.whPerKm).toBe(110);
  });

  it('handles band extremes: freezing fast vs mild slow', () => {
    const l = buildLandscape([
      drive(120, -10, 260, MIN_CELL_DISTANCE_M),
      drive(20, 18, 140, MIN_CELL_DISTANCE_M),
    ]);
    expect(l.cells[0]![SPEED_BANDS_KPH.length - 1]!.whPerKm).toBe(260);
    expect(l.cells[3]![0]!.whPerKm).toBe(140);
    expect(l.worst!.whPerKm).toBe(260);
    expect(l.best!.whPerKm).toBe(140);
  });

  it('excludes thin cells from best/worst and the color range', () => {
    const l = buildLandscape([
      drive(60, 18, 150, MIN_CELL_DISTANCE_M),
      drive(90, 18, 999, 3_000), // populated but under the evidence floor
    ]);
    expect(l.maxWhPerKm).toBe(150);
    expect(l.worst!.whPerKm).toBe(150);
    // The thin cell still reports its value for display, just not the scale.
    expect(l.cells[3]![4]!.whPerKm).toBe(999);
  });

  it('skips drives without temperature or speed', () => {
    const noTemp = drive(60, 18, 150);
    noTemp.outsideTempAvgC = null;
    const l = buildLandscape([noTemp]);
    expect(l.analyzed).toBe(0);
  });

  it('has full grid dimensions even when empty', () => {
    const l = buildLandscape([]);
    expect(l.cells).toHaveLength(TEMP_BANDS_C.length);
    expect(l.cells[0]).toHaveLength(SPEED_BANDS_KPH.length);
    expect(l.best).toBeNull();
  });
});

describe('color scale helpers', () => {
  it('interpolates hex endpoints and midpoint', () => {
    expect(lerpHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(lerpHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(lerpHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(lerpHex('#ff0000', '#00ff00', 2)).toBe('#00ff00'); // clamped
  });

  it('normalizes scale positions with degenerate-range fallback', () => {
    expect(scalePosition(150, 100, 200)).toBe(0.5);
    expect(scalePosition(100, 100, 200)).toBe(0);
    expect(scalePosition(250, 100, 200)).toBe(1);
    expect(scalePosition(150, 150, 150)).toBe(0.5);
  });
});
