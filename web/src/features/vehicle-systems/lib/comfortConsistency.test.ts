import { describe, expect, it } from 'vitest';
import {
  summarizeComfortConsistency,
  type ComfortSample,
} from './comfortConsistency';

const BASE = Date.UTC(2026, 6, 1, 12);

function row(
  minute: number,
  insideTemp: number,
  overrides: Partial<ComfortSample> = {},
): ComfortSample {
  return {
    timestamp: new Date(BASE + minute * 60_000).toISOString(),
    insideTemp,
    driverTempSetting: 21,
    passengerTempSetting: 21,
    hvacPower: true,
    ...overrides,
  };
}

describe('summarizeComfortConsistency', () => {
  it('measures active-HVAC cabin deviation from the mean front-row setpoint', () => {
    const result = summarizeComfortConsistency([
      row(0, 22, { driverTempSetting: 20, passengerTempSetting: 22 }),
      row(5, 23, { driverTempSetting: 20, passengerTempSetting: 22 }),
      row(10, 21, { driverTempSetting: 20, passengerTempSetting: 22 }),
    ]);
    expect(result.analyzedSamples).toBe(3);
    expect(result.meanAbsDeviationC).toBe(1);
    expect(result.medianAbsDeviationC).toBe(1);
    expect(result.meanSetpointDisagreementC).toBe(2);
    expect(result.disagreementSampleShare).toBe(1);
    expect(result.withinComfortBandShare).toBeCloseTo(2 / 3);
  });

  it('excludes HVAC-off and unknown samples from consistency scoring', () => {
    const result = summarizeComfortConsistency([
      row(0, 40, { hvacPower: false, isAcOn: false, fanSpeed: 0 }),
      row(5, 22, { hvacPower: null, isAcOn: null, fanSpeed: null }),
      row(10, 21, { hvacPower: true }),
    ]);
    expect(result.analyzedSamples).toBe(1);
    expect(result.meanAbsDeviationC).toBe(0);
  });

  it('finds sustained stabilization and opposite-side overshoot', () => {
    const result = summarizeComfortConsistency(
      [row(0, 30), row(5, 25), row(10, 21.5), row(15, 20.5), row(20, 19)],
      { comfortBandC: 1.5, sustainSamples: 2 },
    );
    expect(result.stabilizationWindows).toHaveLength(1);
    expect(result.stabilizationWindows[0]).toMatchObject({
      direction: 'hot',
      timeToBandS: 600,
      overshootC: 2,
    });
    expect(result.medianStabilizationS).toBe(600);
    expect(result.medianOvershootC).toBe(2);
    expect(result.overshootDistribution.reduce((sum, bin) => sum + bin.windows, 0)).toBe(1);
  });

  it('separates cold starts and reports windows that never stabilize', () => {
    const result = summarizeComfortConsistency([row(0, 10), row(10, 14), row(20, 17)]);
    expect(result.stabilizationWindows[0]!.direction).toBe('cold');
    expect(result.stabilizationWindows[0]!.timeToBandS).toBeNull();
    expect(result.stabilizedWindows).toBe(0);
  });

  it('splits windows across long gaps and material target changes', () => {
    const result = summarizeComfortConsistency(
      [
        row(0, 30),
        row(5, 28),
        row(60, 30),
        row(65, 28),
        row(70, 28, { driverTempSetting: 17, passengerTempSetting: 17 }),
        row(75, 25, { driverTempSetting: 17, passengerTempSetting: 17 }),
      ],
      { maxGapS: 600, maxTargetShiftC: 2 },
    );
    expect(result.stabilizationWindows).toHaveLength(3);
  });

  it('shrinks sparse scores toward neutral and gains confidence with evidence', () => {
    const sparse = summarizeComfortConsistency([row(0, 21)]);
    const dense = summarizeComfortConsistency(
      Array.from({ length: 100 }, (_, index) => row(index * 2, 21)),
    );
    expect(sparse.confidence).toBeLessThan(dense.confidence);
    expect(sparse.consistencyScore).toBeGreaterThanOrEqual(50);
    expect(dense.consistencyScore).toBeGreaterThan(sparse.consistencyScore!);
  });

  it('is null-safe when temperatures, setpoints, or timestamps are absent', () => {
    const result = summarizeComfortConsistency([
      { timestamp: null, insideTemp: 21, driverTempSetting: 21, hvacPower: true },
      { timestamp: 'bad', insideTemp: 21, driverTempSetting: 21, hvacPower: true },
      row(0, 21, { insideTemp: null }),
      row(1, 21, { driverTempSetting: null, passengerTempSetting: null }),
    ]);
    expect(result.analyzedSamples).toBe(0);
    expect(result.consistencyScore).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
