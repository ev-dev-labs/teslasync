import { describe, expect, it } from 'vitest';
import type { DriveDetail, DriveTelemetryPoint } from '@/types/driving';
import { driveEnergyEvidence } from './energyEvidence';

const start = Date.parse('2026-10-29T12:00:00Z');
const point = (seconds: number, power: number | null): DriveTelemetryPoint => ({
  createdAt: new Date(start + seconds * 1000).toISOString(),
  power,
} as DriveTelemetryPoint);
const drive = (telemetry: DriveTelemetryPoint[]): DriveDetail => ({
  startTs: new Date(start).toISOString(),
  endTs: new Date(start + 60000).toISOString(),
  durationS: 60,
  avgPowerW: null,
  energyUsedWh: null,
  regenEnergyWh: null,
  telemetry,
  positions: [],
} as DriveDetail);

describe('drive energy evidence from sparse change events', () => {
  it('weights elapsed signed intervals instead of counting regen emissions', () => {
    const telemetry = [point(0, 16000)];
    for (let second = 52; second < 60; second++) telemetry.push(point(second, -4000));
    const evidence = driveEnergyEvidence(drive(telemetry));
    expect(evidence.energyWh).toBeCloseTo((52 * 16000 - 8 * 4000) / 3600);
    expect(evidence.regenWh).toBeCloseTo(8 * 4000 / 3600);
    expect(evidence.energyWh).toBeGreaterThan(0);
    expect(evidence.regenWh).toBeLessThan(evidence.energyWh!);
  });

  it('does not extrapolate power into missing history or treat null as zero', () => {
    const evidence = driveEnergyEvidence(drive([point(10, -4000), point(20, null), point(40, 0)]));
    expect(evidence.energyWh).toBeCloseTo(-4000 * 10 / 3600);
    expect(evidence.regenWh).toBeCloseTo(4000 * 10 / 3600);
  });

  it('does not invent recovery from samples without usable instants', () => {
    const evidence = driveEnergyEvidence(drive([{ power: -4000 } as DriveTelemetryPoint]));
    expect(evidence.energyWh).toBeNull();
    expect(evidence.regenWh).toBeNull();
  });

  it('preserves observed summary zero and genuine net-regenerating drives', () => {
    const observed = { ...drive([point(0, -4000)]), energyUsedWh: 0, regenEnergyWh: 0 };
    expect(driveEnergyEvidence(observed)).toMatchObject({ energyWh: 0, regenWh: 0, energySource: 'observed' });
    const downhill = driveEnergyEvidence(drive([point(0, -4000)]));
    expect(downhill.energyWh).toBeCloseTo(-4000 / 60);
    expect(downhill.regenWh).toBeCloseTo(4000 / 60);
  });
});
