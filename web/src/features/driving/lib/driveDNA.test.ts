import { describe, it, expect } from 'vitest';
import { generateDriveDNA, petalLine, DNA_CENTER } from './driveDNA';
import type { DriveTelemetryPoint } from '@/types/driving';

function pt(over: Partial<DriveTelemetryPoint>): DriveTelemetryPoint {
  return {
    timestamp: '2025-01-01T00:00:00Z',
    speed: 20,
    power: 10000,
    batteryLevel: 70,
    outsideTemp: 18,
    insideTemp: 21,
    driverTemp: 21,
    passengerTemp: 21,
    elevation: 100,
    idealRange: null,
    ratedRange: null,
    estRange: null,
    odometer: null,
    soc: 70,
    usableSoc: 70,
    tirePressureFl: null,
    tirePressureFr: null,
    tirePressureRl: null,
    tirePressureRr: null,
    isClimateOn: true,
    fanStatus: null,
    latitude: null,
    longitude: null,
    ...over,
  } as DriveTelemetryPoint;
}

const spiritedDrive: DriveTelemetryPoint[] = Array.from({ length: 40 }, (_, i) =>
  pt({ speed: 10 + (i % 8) * 5, power: i % 3 === 0 ? -6000 : 40000, soc: 80 - i, elevation: 100 + i * 6 }),
);

describe('generateDriveDNA', () => {
  it('is deterministic — identical telemetry yields the same signature and petal count', () => {
    const a = generateDriveDNA(spiritedDrive);
    const b = generateDriveDNA(spiritedDrive.map((p) => ({ ...p }))); // structural clone
    expect(a.signature).toBe(b.signature);
    expect(a.petals.length).toBe(b.petals.length);
    expect(a.petals.length).toBe(spiritedDrive.length);
    expect(a.signature).toMatch(/^[0-9A-Z]{7}$/);
  });

  it('returns coherent empty art for empty / single-point input without throwing', () => {
    const empty = generateDriveDNA([]);
    expect(empty.petals).toHaveLength(0);
    expect(empty.rings).toHaveLength(0);
    expect(empty.signature).toBe('0000000');
    expect(generateDriveDNA(undefined).stats.points).toBe(0);
    expect(generateDriveDNA([pt({})]).petals).toHaveLength(0); // needs >= 2 points
  });

  it('is null-safe — missing channels collapse to neutral geometry, never NaN', () => {
    const sparse = [pt({ speed: null, power: null, soc: null, elevation: null }), pt({ speed: null, power: null })];
    const g = generateDriveDNA(sparse);
    expect(g.petals.length).toBe(2);
    for (const p of g.petals) {
      expect(Number.isFinite(p.r1)).toBe(true);
      expect(Number.isFinite(p.width)).toBe(true);
      expect(p.color).toMatch(/^hsl\(/);
    }
  });

  it('derives traits from how the car was driven', () => {
    const g = generateDriveDNA(spiritedDrive);
    // maxSpeed 45 m/s (>33) => Spirited; big climb => Mountainous
    expect(g.traits).toContain('Spirited');
    expect(g.traits).toContain('Mountainous');
    expect(g.stats.topSpeedKph).toBeGreaterThan(120);

    const gentle = generateDriveDNA(Array.from({ length: 20 }, () => pt({ speed: 8, power: 3000, elevation: 100 })));
    expect(gentle.traits).toContain('Gentle');
  });

  it('petalLine maps a petal to finite coordinates radiating from centre', () => {
    const [p] = generateDriveDNA(spiritedDrive).petals;
    const line = petalLine(p);
    for (const v of Object.values(line)) expect(Number.isFinite(v)).toBe(true);
    // outer point is further from centre than inner point
    const d0 = Math.hypot(line.x1 - DNA_CENTER, line.y1 - DNA_CENTER);
    const d1 = Math.hypot(line.x2 - DNA_CENTER, line.y2 - DNA_CENTER);
    expect(d1).toBeGreaterThanOrEqual(d0);
  });
});
