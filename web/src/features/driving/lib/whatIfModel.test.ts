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
  avgPowerW: null,
  outsideTempAvgC: null,
  insideTempAvgC: null,
  score: null,
  endedStatus: null,
  createdAt: '2025-01-01T08:00:00Z',
  updatedAt: '2025-01-01T08:30:00Z',
};

const telemetry: DriveTelemetryPoint[] = Array.from({ length: 20 }, (_, i) =>
  ({
    timestamp: '2025-01-01T08:00:00Z', elevation: 100 + i * 4,
    isClimateOn: true, outsideTemp: 4, speed: 16, power: 12000,
    batteryLevel: null, insideTemp: null, driverTemp: null, passengerTemp: null,
    idealRange: null, ratedRange: null, estRange: null, odometer: null,
    soc: null, usableSoc: null, tirePressureFl: null, tirePressureFr: null,
    tirePressureRl: null, tirePressureRr: null, fanStatus: null,
    latitude: null, longitude: null,
  }),
);

describe('simulateWhatIf', () => {
  it('flags drives without energy data instead of returning NaN', () => {
    expect(simulateWhatIf(undefined, telemetry, DEFAULT_KNOBS).ok).toBe(false);
    const noEnergy = { ...drive, energyUsedWh: null };
    const r = simulateWhatIf(noEnergy, telemetry, DEFAULT_KNOBS);
    expect(r.ok).toBe(false);
    expect(Number.isFinite(r.scenario.total)).toBe(true);
    expect(r.reconciliation).toBe('unavailable');
  });

  it.each([null, NaN, Infinity, -Infinity])('rejects unavailable or invalid energy %s', (energyUsedWh) => {
    const r = simulateWhatIf({ ...drive, energyUsedWh }, telemetry, DEFAULT_KNOBS);
    expect(r.ok).toBe(false);
    expect(r.reconciliation).toBe('unavailable');
  });

  it.each([0, -250.125, 0.125, 6000.375])('preserves measured signed and fractional Wh: %s', (energyUsedWh) => {
    const r = simulateWhatIf({ ...drive, energyUsedWh }, telemetry, { ...DEFAULT_KNOBS, ambientC: 4 });
    expect(r.ok).toBe(true);
    expect(r.baseline.total).toBe(energyUsedWh);
    expect(r.scenario.total).toBeCloseTo(energyUsedWh, 10);
    expect(r.energyDeltaWh).toBeCloseTo(0, 10);
    expect(r.baseline.aero).toBeGreaterThan(0);
    expect(r.baseline.other).toBe(energyUsedWh -
      (r.baseline.aero + r.baseline.rolling + r.baseline.elevation + r.baseline.climate));
  });

  it.each(['above', 'below', 'equal'] as const)('reconciles observations %s the modeled loads without deleting categories', (relation) => {
    const estimate = simulateWhatIf(drive, telemetry, DEFAULT_KNOBS).baseline;
    const modeled = estimate.aero + estimate.rolling + estimate.elevation + estimate.climate;
    const energyUsedWh = modeled + (relation === 'above' ? 123.456 : relation === 'below' ? -123.456 : 0);
    const r = simulateWhatIf({ ...drive, energyUsedWh }, telemetry, DEFAULT_KNOBS);
    expect(r.baseline.total).toBe(energyUsedWh);
    expect(r.baseline.aero).toBe(estimate.aero);
    expect(r.baseline.rolling).toBe(estimate.rolling);
    expect(r.baseline.elevation).toBe(estimate.elevation);
    expect(r.baseline.climate).toBe(estimate.climate);
    expect(r.baseline.other).toBeCloseTo(energyUsedWh - modeled, 10);
    expect(r.reconciliation).toBe(relation === 'below' ? 'model-exceeds-observed' : 'estimated');
    for (const breakdown of [r.baseline, r.scenario]) {
      expect(Object.keys(breakdown).sort()).toEqual(['aero', 'climate', 'elevation', 'other', 'rolling', 'total']);
      expect(breakdown.aero + breakdown.rolling + breakdown.elevation + breakdown.climate + breakdown.other)
        .toBeCloseTo(breakdown.total, 10);
    }
  });

  it.each([0, -123.5, 6000.25])('keeps signed scenario-minus-baseline deltas for %s Wh', (energyUsedWh) => {
    const input = { ...drive, energyUsedWh };
    const knobs = { ...DEFAULT_KNOBS, ambientC: 4 };
    const saving = simulateWhatIf(input, telemetry, { ...knobs, hvac: false });
    const increase = simulateWhatIf(input, telemetry, { ...knobs, tires: 'low' });
    expect(saving.energyDeltaWh).toBeLessThan(0);
    expect(increase.energyDeltaWh).toBeGreaterThan(0);
    for (const r of [saving, increase]) {
      expect(r.energyDeltaWh).toBe(r.scenario.total - r.baseline.total);
      expect(r.scenario.other).toBe(r.baseline.other);
    }
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid duration and distance %s', (value) => {
    expect(simulateWhatIf({ ...drive, durationS: value }, telemetry, DEFAULT_KNOBS).ok).toBe(false);
    expect(simulateWhatIf({ ...drive, distanceM: value }, telemetry, DEFAULT_KNOBS).ok).toBe(false);
  });

  it('retains fractional SI distance and duration, deriving only missing speed', () => {
    const input = { ...drive, distanceM: 2.5, durationS: 0.25, avgSpeedMps: null, energyUsedWh: 0.125 };
    const r = simulateWhatIf(input, [], DEFAULT_KNOBS);
    expect(r.ok).toBe(true);
    expect(r.scenarioDurationS).toBe(0.25);
    expect(r.baseline.aero).toBeCloseTo(0.5 * 1.225 * 0.58 * 10 ** 2 * 2.5 / 3600 / 0.9, 12);
    expect(simulateWhatIf({ ...input, avgSpeedMps: 0 }, [], DEFAULT_KNOBS).ok).toBe(false);
    expect(simulateWhatIf({ ...input, avgSpeedMps: NaN }, [], DEFAULT_KNOBS).ok).toBe(false);
  });

  it('keeps unchanged cold scenarios neutral even when recorded speed and duration differ', () => {
    const r = simulateWhatIf({ ...drive, avgSpeedMps: 20 }, telemetry, { ...DEFAULT_KNOBS, ambientC: 4 });
    for (const key of ['aero', 'rolling', 'elevation', 'climate', 'other', 'total'] as const) {
      expect(r.scenario[key]).toBeCloseTo(r.baseline[key], 10);
    }
    expect(r.scenarioDurationS).toBe(drive.durationS);
    expect(r.energyDeltaWh).toBeCloseTo(0, 10);
  });

  it.each([
    { name: 'missing telemetry', points: undefined },
    { name: 'empty telemetry', points: [] },
    { name: 'missing temperatures', points: telemetry.map((p) => ({ ...p, outsideTemp: null })) },
    { name: 'invalid temperatures', points: telemetry.map((p, i) => ({
      ...p, outsideTemp: [NaN, Infinity, -Infinity][i % 3],
    })) },
    { name: 'recorded temperatures', points: telemetry },
  ])('keeps the recorded baseline fixed with $name when scenario ambient changes', ({ points }) => {
    const base = simulateWhatIf(drive, points, DEFAULT_KNOBS);
    const cold = simulateWhatIf(drive, points, { ...DEFAULT_KNOBS, ambientC: -10 });
    const warm = simulateWhatIf(drive, points, { ...DEFAULT_KNOBS, ambientC: 30 });

    expect(base.ok).toBe(true);
    expect(base.ambientNativeC).toBe(points === telemetry ? 4 : 18);
    for (const result of [cold, warm]) {
      expect(result.ok).toBe(true);
      expect(result.ambientNativeC).toBe(base.ambientNativeC);
      expect(result.baseline).toEqual(base.baseline);
      expect(result.reconciliation).toBe(base.reconciliation);
      expect(result.baselineArrivalSoc).toBe(base.baselineArrivalSoc);
      expect(result.scenario.other).toBe(base.baseline.other);
      expect(result.energyDeltaWh).toBe(result.scenario.total - base.baseline.total);
    }
    expect(cold.scenario.climate).toBeGreaterThan(warm.scenario.climate);
    expect(cold.scenario.aero).toBeGreaterThan(warm.scenario.aero);
    expect(cold.scenario.total).toBeGreaterThan(warm.scenario.total);
  });

  it.each([NaN, Infinity, -Infinity])('flags invalid knob values %s', (value) => {
    expect(simulateWhatIf(drive, telemetry, { ...DEFAULT_KNOBS, speedFactor: value }).ok).toBe(false);
    expect(simulateWhatIf(drive, telemetry, { ...DEFAULT_KNOBS, ambientC: value }).ok).toBe(false);
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
