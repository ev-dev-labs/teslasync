import { describe, it, expect } from 'vitest';
import { simulateWhatIf, DEFAULT_KNOBS } from './whatIfModel';
import type { Drive, DriveTelemetryPoint } from '@/types/driving';

const drive: Drive = {
  id: 1,
  vehicleId: 1,
  startTs: '2025-01-01T08:00:00Z',
  endTs: '2025-01-01T08:30:00Z',
  durationS: 1800,
  distanceM: 30000, // 30 km
  startAddress: null,
  endAddress: null,
  startLat: null,
  startLon: null,
  endLat: null,
  endLon: null,
  startBatteryPct: 80,
  endBatteryPct: 68,
  energyUsedWh: 6000, // 6 kWh
  regenEnergyWh: 800,
  avgSpeedMps: 30000 / 1800, // ~16.7 m/s
  maxSpeedMps: 25,
} as Drive;

const telemetry: DriveTelemetryPoint[] = Array.from({ length: 20 }, (_, i) =>
  ({ timestamp: '2025-01-01T08:00:00Z', elevation: 100 + i * 4, isClimateOn: true, outsideTemp: 4, speed: 16, power: 12000 } as unknown as DriveTelemetryPoint),
);

describe('simulateWhatIf', () => {
  it('flags drives without energy data instead of returning NaN', () => {
    expect(simulateWhatIf(undefined, telemetry, DEFAULT_KNOBS).ok).toBe(false);
    const noEnergy = { ...drive, energyUsedWh: 0 } as Drive;
    const r = simulateWhatIf(noEnergy, telemetry, DEFAULT_KNOBS);
    expect(r.ok).toBe(false);
    expect(Number.isFinite(r.scenario.total)).toBe(true);
  });

  it('baseline reconciles to the actual observed energy', () => {
    const r = simulateWhatIf(drive, telemetry, DEFAULT_KNOBS);
    expect(r.ok).toBe(true);
    // "other" absorbs the residual so the decomposed total equals reality.
    expect(r.baseline.total).toBeCloseTo(drive.energyUsedWh as number, 0);
    expect(r.baseline.aero).toBeGreaterThan(0);
    expect(r.baseline.rolling).toBeGreaterThan(0);
  });

  it('raising speed increases aero drag quadratically and shortens the drive', () => {
    const base = simulateWhatIf(drive, telemetry, DEFAULT_KNOBS);
    const fast = simulateWhatIf(drive, telemetry, { ...DEFAULT_KNOBS, speedFactor: 1.2 });
    expect(fast.scenario.aero).toBeGreaterThan(base.scenario.aero);
    // aero ∝ v²: +20% speed ⇒ ~+44% aero
    expect(fast.scenario.aero / base.scenario.aero).toBeCloseTo(1.44, 1);
    expect(fast.scenarioDurationS).toBeLessThan(base.scenarioDurationS);
  });

  it('turning HVAC off removes climate load; under-inflation raises rolling', () => {
    const hvacOff = simulateWhatIf(drive, telemetry, { ...DEFAULT_KNOBS, hvac: false });
    expect(hvacOff.scenario.climate).toBe(0);
    expect(hvacOff.scenario.total).toBeLessThan(hvacOff.baseline.total);

    const lowTires = simulateWhatIf(drive, telemetry, { ...DEFAULT_KNOBS, tires: 'low' });
    const nominal = simulateWhatIf(drive, telemetry, DEFAULT_KNOBS);
    expect(lowTires.scenario.rolling).toBeGreaterThan(nominal.scenario.rolling);
  });

  it('infers pack size from SoC drop and computes arrival battery', () => {
    const r = simulateWhatIf(drive, telemetry, DEFAULT_KNOBS);
    // 6 kWh for 12% ⇒ ~50 kWh pack
    expect(r.packWh).toBeGreaterThan(40000);
    expect(r.packWh).toBeLessThan(60000);
    expect(r.baselineArrivalSoc).toBeGreaterThan(0);
    expect(r.baselineArrivalSoc).toBeLessThanOrEqual(80);
  });
});
