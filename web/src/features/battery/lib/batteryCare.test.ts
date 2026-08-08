import { beforeEach, describe, expect, it } from 'vitest';

import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

import {
  BATTERY_CARE_HISTORY_LIMIT,
  MAX_CARE_TREND_MONTHS,
  classifyCharger,
  computeBatteryCare,
  isDcSession,
} from './batteryCare';

let nextId = 1;

function session(overrides: Partial<ChargingSession> = {}): ChargingSession {
  const id = nextId++;
  return {
    id: String(id),
    vehicle_id: '1',
    charger_type: 'AC',
    start_soc_pct: 40,
    end_soc_pct: 70,
    total_energy_added_wh: 10_000,
    peak_power_w: 11_000,
    cost_decimal: null,
    started_at: '2026-07-01T20:00:00Z',
    ended_at: '2026-07-01T22:00:00Z',
    start_ts: '2026-07-01T20:00:00Z',
    startedAt: '2026-07-01T20:00:00Z',
    duration_min: 120,
    ...overrides,
  };
}

function drive(
  endBatteryPct: number | null = 50,
  overrides: Partial<Drive> = {},
): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: '2026-07-01T08:30:00Z',
    durationS: 1_800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct,
    energyUsedWh: 2_000,
    regenEnergyWh: null,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
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

function repeatedSessions(
  count: number,
  overrides: Partial<ChargingSession> = {},
): ChargingSession[] {
  return Array.from({ length: count }, () => session(overrides));
}

function repeatedDrives(
  count: number,
  endBatteryPct = 50,
  overrides: Partial<Drive> = {},
): Drive[] {
  return Array.from({ length: count }, () =>
    drive(endBatteryPct, overrides),
  );
}

beforeEach(() => {
  nextId = 1;
});

describe('charger classification', () => {
  it('recognizes explicit DC labels and high-power unlabeled evidence', () => {
    expect(isDcSession('DC')).toBe(true);
    expect(isDcSession('Tesla Supercharger')).toBe(true);
    expect(isDcSession('ccs-combo')).toBe(true);
    expect(classifyCharger(null, 150_000)).toBe('dc');
    expect(classifyCharger(null, 20_000)).toBe('unknown');
    expect(classifyCharger(null, 20_001)).toBe('dc');
  });

  it('keeps known AC and unclassified energy separate', () => {
    expect(classifyCharger('wall_connector', 11_000)).toBe('ac');
    expect(classifyCharger('Tesla Wall Connector', 11_000)).toBe('ac');
    expect(classifyCharger('Tesla Destination Charger', 11_000)).toBe('ac');
    expect(classifyCharger('Tesla Mobile Connector', 7_000)).toBe('ac');
    expect(classifyCharger('J1772', 7_000)).toBe('ac');
    expect(classifyCharger(null, 11_000)).toBe('unknown');
    expect(classifyCharger('mystery plug', null)).toBe('unknown');
    expect(isDcSession(null)).toBe(false);
  });
});

describe('computeBatteryCare exclusions and aggregation', () => {
  it('excludes invalid percentages and non-positive energy without coercing them to zero', () => {
    const sessions = [
      session(),
      session({ end_soc_pct: null, total_energy_added_wh: -1 }),
      session({
        end_soc_pct: Number.NaN,
        total_energy_added_wh: Number.NaN,
      }),
      session({
        end_soc_pct: 101,
        charger_type: null,
        total_energy_added_wh: 5_000,
      }),
      session({ end_soc_pct: 95, total_energy_added_wh: 0 }),
    ];
    const drives = [
      drive(50),
      drive(9),
      drive(null),
      drive(-1),
      drive(101),
      drive(Number.NaN),
    ];

    const result = computeBatteryCare(sessions, drives);

    expect(result.sessionsAnalyzed).toBe(2);
    expect(result.drivesAnalyzed).toBe(2);
    expect(result.energyMix.energySessions).toBe(2);
    expect(result.coverage.excludedEndSocSessions).toBe(3);
    expect(result.coverage.excludedArrivalDrives).toBe(4);
    expect(result.coverage.excludedEnergySessions).toBe(3);
    expect(result.coverage.unclassifiedEnergySessions).toBe(1);
  });

  it('weights DC evidence by classified energy and reports unknown coverage', () => {
    const result = computeBatteryCare(
      [
        session({
          charger_type: 'Supercharger',
          total_energy_added_wh: 30_000,
        }),
        session({ charger_type: 'AC', total_energy_added_wh: 10_000 }),
        session({ charger_type: null, total_energy_added_wh: 60_000 }),
      ],
      repeatedDrives(5),
    );

    expect(result.dcEnergyShare).toBeCloseTo(0.75);
    expect(result.energyMix.totalEnergyWh).toBe(100_000);
    expect(result.energyMix.classifiedEnergyWh).toBe(40_000);
    expect(result.energyMix.classificationCoverage).toBeCloseTo(0.4);
    expect(
      result.energyMix.buckets.find((bucket) => bucket.category === 'unknown')
        ?.share,
    ).toBeCloseTo(0.6);
  });

  it('accepts the SI-equivalent camel-case charging handler fields', () => {
    const camelSession = {
      ...session(),
      charger_type: undefined,
      end_soc_pct: undefined,
      total_energy_added_wh: undefined,
      peak_power_w: undefined,
      chargerType: 'Tesla',
      endBatteryLevel: 75,
      energyAddedWh: 20_000,
      maxPowerW: 150_000,
    } as unknown as ChargingSession;

    const result = computeBatteryCare([camelSession], repeatedDrives(1));

    expect(result.sessionsAnalyzed).toBe(1);
    expect(result.medianEndSocPct).toBe(75);
    expect(result.energyMix.energySessions).toBe(1);
    expect(result.dcEnergyShare).toBe(1);
  });

  it('places boundary percentages in deterministic distribution buckets', () => {
    const result = computeBatteryCare(
      [19.9, 20, 80, 80.1, 94.9, 95, 100].map((endSoc) =>
        session({ end_soc_pct: endSoc }),
      ),
      [9.9, 10, 19.9, 20, 49.9, 50, 100].map((arrival) =>
        drive(arrival),
      ),
    );

    expect(
      Object.fromEntries(
        result.endSocDistribution.map((bucket) => [bucket.id, bucket.count]),
      ),
    ).toEqual({
      belowBand: 1,
      careBand: 2,
      aboveBand: 2,
      highFinish: 2,
    });
    expect(
      Object.fromEntries(
        result.arrivalSocDistribution.map((bucket) => [
          bucket.id,
          bucket.count,
        ]),
      ),
    ).toEqual({
      below10: 1,
      '10to19': 2,
      '20to49': 2,
      '50plus': 2,
    });
    expect(result.medianEndSocPct).toBe(80.1);
    expect(result.medianArrivalSocPct).toBe(20);
  });
});

describe('care score calibration', () => {
  it('scores 100 when every calibrated observed component has zero deduction', () => {
    const result = computeBatteryCare(
      repeatedSessions(5, { end_soc_pct: 75 }),
      repeatedDrives(5),
    );

    expect(result.fullChargeShare).toBe(0);
    expect(result.deepDischargeShare).toBe(0);
    expect(result.dcEnergyShare).toBe(0);
    expect(result.bandFinishShare).toBe(1);
    expect(result.scoreReady).toBe(true);
    expect(result.score).toBe(100);
  });

  it('aggregates the four documented weighted deductions', () => {
    const sessions = [
      session({ end_soc_pct: 100 }),
      session(),
      session(),
      session(),
      session({ charger_type: 'Supercharger' }),
    ];
    const drives = [5, 50, 50, 50, 50].map((arrival) => drive(arrival));

    const result = computeBatteryCare(sessions, drives);

    expect(
      Object.fromEntries(
        result.riskComponents.map((component) => [
          component.id,
          component.penaltyPoints,
        ]),
      ),
    ).toEqual({
      highFinish: 6,
      deepArrival: 6,
      dcEnergy: 4,
      outsideBand: 4,
    });
    expect(result.score).toBe(80);
  });

  it('withholds the score below each source and classification guard', () => {
    expect(
      computeBatteryCare(repeatedSessions(4), repeatedDrives(5)).score,
    ).toBeNull();
    expect(
      computeBatteryCare(repeatedSessions(5), repeatedDrives(4)).score,
    ).toBeNull();

    const tooFewEnergy = [
      ...repeatedSessions(2),
      ...repeatedSessions(3, { total_energy_added_wh: 0 }),
    ];
    expect(
      computeBatteryCare(tooFewEnergy, repeatedDrives(5)).score,
    ).toBeNull();

    const lowClassificationCoverage = [
      ...repeatedSessions(3),
      ...repeatedSessions(2, {
        charger_type: null,
        peak_power_w: 11_000,
      }),
    ];
    const lowCoverageResult = computeBatteryCare(
      lowClassificationCoverage,
      repeatedDrives(5),
    );
    expect(lowCoverageResult.energyMix.classificationCoverage).toBeCloseTo(0.6);
    expect(lowCoverageResult.score).toBeNull();
  });

  it('preserves the numeric third-argument threshold contract', () => {
    const sessions = [
      session({ end_soc_pct: 90 }),
      ...repeatedSessions(4, { end_soc_pct: 80 }),
    ];
    const result = computeBatteryCare(sessions, repeatedDrives(5), 90);

    expect(result.fullChargePct).toBe(90);
    expect(result.fullChargeShare).toBeCloseTo(0.2);
  });
});

describe('ranked opportunities', () => {
  it('ranks supported observations by index contribution with stable ties', () => {
    const result = computeBatteryCare(
      repeatedSessions(5, {
        end_soc_pct: 100,
        charger_type: 'Supercharger',
      }),
      repeatedDrives(5, 5),
    );

    expect(
      result.opportunities.map((opportunity) => [
        opportunity.id,
        opportunity.penaltyPoints,
      ]),
    ).toEqual([
      ['highFinish', 30],
      ['deepArrival', 30],
      ['dcEnergy', 20],
      ['outsideBand', 20],
    ]);
  });

  it('applies action thresholds without promoting low-rate observations', () => {
    const sessions = [
      session({ end_soc_pct: 100, charger_type: 'Supercharger' }),
      ...repeatedSessions(3, { charger_type: 'Supercharger' }),
      ...repeatedSessions(6),
    ];
    const drives = [5, ...Array.from({ length: 9 }, () => 50)].map((arrival) =>
      drive(arrival),
    );
    const result = computeBatteryCare(sessions, drives);

    expect(result.fullChargeShare).toBeCloseTo(0.1);
    expect(result.deepDischargeShare).toBeCloseTo(0.1);
    expect(result.dcEnergyShare).toBeCloseTo(0.4);
    expect(result.opportunities.map((opportunity) => opportunity.id)).toEqual([
      'dcEnergy',
    ]);
  });
});

describe('monthly windows and caps', () => {
  const nowMs = Date.parse('2026-08-07T12:00:00Z');

  it('aggregates UTC months, excludes future/invalid timestamps, and applies monthly guards', () => {
    const julySessions = repeatedSessions(3, {
      started_at: '2026-07-10T12:00:00Z',
      start_ts: '2026-07-10T12:00:00Z',
      startedAt: '2026-07-10T12:00:00Z',
    });
    const julyDrives = repeatedDrives(3, 50, {
      startTs: '2026-07-11T12:00:00Z',
    });
    const sessions = [
      ...julySessions,
      session({ started_at: '2026-09-01T00:00:00Z' }),
      session({ started_at: 'invalid', start_ts: 'invalid', startedAt: 'invalid' }),
    ];
    const drives = [
      ...julyDrives,
      drive(50, { startTs: '2026-09-01T00:00:00Z' }),
      drive(50, { startTs: 'invalid' }),
    ];

    const result = computeBatteryCare(sessions, drives, { nowMs });
    const july = result.monthly.find((month) => month.month === '2026-07');

    expect(result.monthly.map((month) => month.month)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
    expect(july).toMatchObject({
      score: 100,
      scoreReady: true,
      sessionsAnalyzed: 3,
      drivesAnalyzed: 3,
    });
    expect(result.coverage.excludedSessionTimestamps).toBe(2);
    expect(result.coverage.excludedDriveTimestamps).toBe(2);
  });

  it('withholds sparse monthly scores while retaining their sample counts', () => {
    const result = computeBatteryCare(
      repeatedSessions(2),
      repeatedDrives(3),
      { nowMs },
    );
    const july = result.monthly.find((month) => month.month === '2026-07');

    expect(july).toMatchObject({
      score: null,
      scoreReady: false,
      sessionsAnalyzed: 2,
      drivesAnalyzed: 3,
    });
  });

  it('flags full source windows and clamps requested trend/history caps', () => {
    const result = computeBatteryCare(
      repeatedSessions(3),
      repeatedDrives(3),
      {
        nowMs,
        sessionLimit: 2,
        driveLimit: 3,
        trendMonths: 99,
      },
    );
    const maxLimitResult = computeBatteryCare(
      repeatedSessions(BATTERY_CARE_HISTORY_LIMIT),
      [],
      {
        nowMs,
        sessionLimit: BATTERY_CARE_HISTORY_LIMIT + 500,
      },
    );

    expect(result.coverage.sessionWindowCapped).toBe(true);
    expect(result.coverage.driveWindowCapped).toBe(true);
    expect(result.monthly).toHaveLength(MAX_CARE_TREND_MONTHS);
    expect(maxLimitResult.coverage.sessionWindowCapped).toBe(true);
  });
});

describe('empty evidence', () => {
  it('returns explicit unknowns instead of inferred zeros', () => {
    const result = computeBatteryCare([], [], {
      nowMs: Date.parse('2026-08-07T12:00:00Z'),
    });

    expect(result.score).toBeNull();
    expect(result.fullChargeShare).toBeNull();
    expect(result.dcEnergyShare).toBeNull();
    expect(result.medianEndSocPct).toBeNull();
    expect(result.coverage.observationStartMs).toBeNull();
  });
});
