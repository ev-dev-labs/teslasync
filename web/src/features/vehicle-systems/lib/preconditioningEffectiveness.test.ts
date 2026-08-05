import { describe, expect, it } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  summarizePreconditioningEffectiveness,
  type PreconditioningClimateSample,
} from './preconditioningEffectiveness';

const DEPARTURE = Date.UTC(2026, 6, 1, 8);

function climate(
  minutesBefore: number,
  insideTemp: number,
  hvacPower: string | null,
  overrides: Partial<PreconditioningClimateSample> = {},
): PreconditioningClimateSample {
  return {
    timestamp: new Date(DEPARTURE - minutesBefore * 60_000).toISOString(),
    insideTemp,
    driverTempSetting: 21,
    passengerTempSetting: 21,
    hvacPower,
    ...overrides,
  };
}

function drive(id = 1, startMs = DEPARTURE): Drive {
  return {
    id,
    vehicleId: 1,
    startTs: new Date(startMs).toISOString(),
    endTs: null,
    durationS: 600,
    distanceM: 1000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: null,
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
  };
}

describe('summarizePreconditioningEffectiveness', () => {
  it('joins only the 45 minutes immediately before a drive', () => {
    const result = summarizePreconditioningEffectiveness(
      [
        climate(50, 40, 'On'),
        climate(45, 35, 'Off'),
        climate(10, 30, 'Off'),
        climate(-1, 20, 'On'),
      ],
      [drive()],
    );
    expect(result.departures).toHaveLength(1);
    expect(result.departures[0]).toMatchObject({
      conditioned: false,
      sampleCount: 2,
      initialDeltaC: 14,
      startDeltaC: 9,
      improvementC: 5,
    });
  });

  it('detects observed HVAC activity and averages driver/passenger setpoints', () => {
    const result = summarizePreconditioningEffectiveness(
      [
        climate(30, 35, 'Off', { driverTempSetting: 20, passengerTempSetting: 22 }),
        climate(10, 24, 'On', { driverTempSetting: 20, passengerTempSetting: 22 }),
      ],
      [drive()],
    );
    expect(result.departures[0]).toMatchObject({
      conditioned: true,
      regime: 'hot',
      initialDeltaC: 14,
      startDeltaC: 3,
      improvementC: 11,
      hvacOnSamples: 1,
    });
  });

  it('stratifies hot and cold departures and compares group medians', () => {
    const samples: PreconditioningClimateSample[] = [
      climate(30, 35, 'Off'),
      climate(5, 24, 'On'),
      {
        ...climate(30, 5, 'Off'),
        timestamp: new Date(DEPARTURE + 60 * 60_000 - 30 * 60_000).toISOString(),
      },
      {
        ...climate(5, 18, 'On'),
        timestamp: new Date(DEPARTURE + 60 * 60_000 - 5 * 60_000).toISOString(),
      },
      {
        ...climate(30, 6, 'Off'),
        timestamp: new Date(DEPARTURE + 2 * 60 * 60_000 - 30 * 60_000).toISOString(),
      },
      {
        ...climate(5, 7, 'Off'),
        timestamp: new Date(DEPARTURE + 2 * 60 * 60_000 - 5 * 60_000).toISOString(),
      },
    ];
    const result = summarizePreconditioningEffectiveness(samples, [
      drive(1),
      drive(2, DEPARTURE + 60 * 60_000),
      drive(3, DEPARTURE + 2 * 60 * 60_000),
    ]);
    const hot = result.strata.find((row) => row.regime === 'hot')!;
    const cold = result.strata.find((row) => row.regime === 'cold')!;
    expect(hot.conditionedCount).toBe(1);
    expect(cold.conditionedCount).toBe(1);
    expect(cold.unconditionedCount).toBe(1);
    expect(cold.startDeltaAdvantageC).not.toBeNull();
    expect(cold.improvementLiftC).not.toBeNull();
  });

  it('does not assign unknown HVAC state to the unconditioned control', () => {
    const result = summarizePreconditioningEffectiveness(
      [climate(30, 35, null), climate(5, 30, 'mystery')],
      [drive()],
    );
    expect(result.joinedDepartures).toBe(0);
    expect(result.unclassifiedDepartures).toBe(1);
  });

  it('requires at least two samples and a meaningful initial temperature gap', () => {
    const sparse = summarizePreconditioningEffectiveness([climate(10, 35, 'On')], [drive()]);
    const comfortable = summarizePreconditioningEffectiveness(
      [climate(30, 21.2, 'Off'), climate(5, 21, 'Off')],
      [drive()],
    );
    expect(sparse.joinedDepartures).toBe(0);
    expect(comfortable.joinedDepartures).toBe(0);
  });

  it('reports balanced evidence strength without inventing a comparison', () => {
    const none = summarizePreconditioningEffectiveness(
      [climate(30, 35, 'On'), climate(5, 25, 'On')],
      [drive()],
    );
    expect(none.overall.evidence).toBe('none');
    expect(none.overall.startDeltaAdvantageC).toBeNull();

    const samples: PreconditioningClimateSample[] = [];
    const drives: Drive[] = [];
    for (let index = 0; index < 12; index += 1) {
      const startMs = DEPARTURE + index * 3_600_000;
      drives.push(drive(index + 1, startMs));
      for (const [before, temp] of [[30, 35], [5, index % 2 === 0 ? 23 : 34]] as const) {
        samples.push({
          ...climate(before, temp, index % 2 === 0 ? 'On' : 'Off'),
          timestamp: new Date(startMs - before * 60_000).toISOString(),
        });
      }
    }
    const balanced = summarizePreconditioningEffectiveness(samples, drives);
    expect(balanced.overall.conditionedCount).toBe(6);
    expect(balanced.overall.unconditionedCount).toBe(6);
    expect(balanced.overall.evidence).not.toBe('none');
    expect(balanced.overall.confidence).toBeGreaterThan(0);
  });

  it('is null-safe with no history', () => {
    const result = summarizePreconditioningEffectiveness([], []);
    expect(result.departures).toEqual([]);
    expect(result.conditionedShare).toBeNull();
    expect(result.overall.evidence).toBe('none');
  });
});
