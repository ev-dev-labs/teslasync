import { describe, expect, it } from 'vitest';

import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

import {
  computeChargeAdvice,
  RESERVE_FLOOR_PCT,
  type ChargeAdvisorLiveSnapshot,
} from './chargeAdvisor';

const NOW = Date.parse('2026-06-02T12:00:00.000Z');
let nextId = 1;

function drive(
  startTs: string,
  burn = 10,
  overrides: Partial<Drive> = {},
): Drive {
  const durationS = overrides.durationS === undefined ? 1_800 : overrides.durationS;
  const endTs = overrides.endTs === undefined
    ? new Date(Date.parse(startTs) + durationS * 1_000).toISOString()
    : overrides.endTs;
  return {
    id: nextId++,
    vehicleId: 1,
    startTs,
    endTs,
    durationS,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 70,
    endBatteryPct: 70 - burn,
    energyUsedWh: 2_000,
    regenEnergyWh: null,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: 'completed',
    createdAt: startTs,
    updatedAt: startTs,
    ...overrides,
    endTs,
  };
}

function charge(
  startTs: string,
  endTs: string | null,
  startSoc = 30,
  endSoc: number | null = 70,
  energy = 20_000,
): ChargingSession {
  return {
    id: String(nextId++),
    vehicle_id: '1',
    charger_type: 'home',
    start_soc_pct: startSoc,
    end_soc_pct: endSoc,
    total_energy_added_wh: energy,
    peak_power_w: 7_200,
    cost_decimal: null,
    started_at: startTs,
    ended_at: endTs,
    start_ts: startTs,
    startedAt: startTs,
    duration_min: 60,
  };
}

function live(
  batteryPct: number | null,
  observedAtMs: number | null = NOW,
  extra: Partial<ChargeAdvisorLiveSnapshot> = {},
): ChargeAdvisorLiveSnapshot {
  return {
    batteryPct,
    observedAtMs,
    source: 'live',
    retrievalState: 'connected',
    connected: true,
    isCharging: false,
    chargeLimitPct: 80,
    ...extra,
  };
}

function qualifiedHistory(burn = 5): Drive[] {
  return [
    '2026-05-01T09:00:00Z',
    '2026-05-05T09:00:00Z',
    '2026-05-09T09:00:00Z',
    '2026-05-13T09:00:00Z',
    '2026-05-17T09:00:00Z',
    '2026-05-21T09:00:00Z',
    '2026-05-25T09:00:00Z',
    '2026-05-29T09:00:00Z',
  ].map((date) => drive(date, burn));
}

describe('computeChargeAdvice', () => {
  it('reconciles every drive row into one mutually exclusive category', () => {
    const rows = [
      drive('2026-06-01T09:00:00Z', 10),
      drive('2025-01-01T09:00:00Z', 10),
      drive('2026-06-01T10:00:00Z', 10, { endTs: null }),
      drive('2026-06-01T11:00:00Z', 10, { endTs: '2026-06-01T10:00:00Z' }),
      drive('2026-06-03T09:00:00Z', 10),
      drive('2026-06-01T12:00:00Z', 10, { durationS: 0, endTs: '2026-06-01T12:30:00Z' }),
      drive('2026-06-01T13:00:00Z', 10, { startBatteryPct: null }),
      drive('2026-06-01T14:00:00Z', 10, { startBatteryPct: 101 }),
      drive('2026-06-01T15:00:00Z', 0),
      drive('2026-06-01T16:00:00Z', 70),
    ];
    const result = computeChargeAdvice(rows, [], live(80), NOW, 'UTC');
    const categories = result.driveAccounting.categories;
    expect(Object.values(categories).reduce((sum, count) => sum + count, 0)).toBe(rows.length);
    expect(categories).toMatchObject({
      included: 1,
      outside_window: 1,
      incomplete_live: 1,
      invalid_timestamp_order: 1,
      future: 1,
      invalid_duration: 1,
      missing_soc: 1,
      invalid_soc: 1,
      nonpositive_soc_drop: 1,
      implausible_soc_drop: 1,
    });
  });

  it('sums multiple drives per local day and keeps zero-driving weekday denominators', () => {
    const result = computeChargeAdvice(
      [
        drive('2026-05-31T09:00:00Z', 5),
        drive('2026-05-31T11:00:00Z', 7),
        drive('2026-06-01T09:00:00Z', 20),
      ],
      [],
      live(80),
      NOW,
      'UTC',
      { historyWindowDays: 7 },
    );
    const sunday = result.weekdayProfiles[0]!;
    const monday = result.weekdayProfiles[1]!;
    expect(result.dailyTrend.find((day) => day.localDate === '2026-05-31')?.dropPct).toBe(12);
    expect(sunday.calendarOccurrences).toBe(1);
    expect(sunday.drivingDays).toBe(1);
    expect(monday.calendarOccurrences).toBe(1);
    expect(monday.medianPct).toBe(20);
    expect(result.weekdayProfiles[2]!.drivingDays).toBe(0);
  });

  it('uses the configurable 180-day local calendar window', () => {
    const result = computeChargeAdvice(
      [
        drive('2025-11-30T09:00:00Z'),
        drive('2025-12-04T09:00:00Z'),
        drive('2026-06-01T09:00:00Z'),
      ],
      [],
      live(80),
      NOW,
      'UTC',
    );
    expect(result.evidence.windowDays).toBe(180);
    expect(result.evidence.windowStartLocalDate).toBe('2025-12-05');
    expect(result.driveAccounting.categories.outside_window).toBe(2);
    expect(result.evidence.includedRows).toBe(1);
  });

  it('groups dates by the vehicle IANA timezone at a calendar boundary', () => {
    const result = computeChargeAdvice(
      [
        drive('2026-06-01T23:30:00Z', 5),
        drive('2026-06-02T01:00:00Z', 7),
      ],
      [],
      live(80),
      NOW,
      'America/Los_Angeles',
      { historyWindowDays: 3 },
    );
    expect(result.timeZone).toBe('America/Los_Angeles');
    expect(result.dailyTrend).toHaveLength(1);
    expect(result.dailyTrend[0]?.localDate).toBe('2026-06-01');
    expect(result.dailyTrend[0]?.dropPct).toBe(12);
  });

  it('handles a DST transition without changing local calendar sequence', () => {
    const result = computeChargeAdvice(
      [
        drive('2026-03-08T06:30:00Z', 5),
        drive('2026-03-08T07:30:00Z', 5),
        drive('2026-03-09T13:00:00Z', 5),
      ],
      [],
      live(80, Date.parse('2026-03-09T15:00:00Z')),
      Date.parse('2026-03-09T15:00:00Z'),
      'America/New_York',
      { historyWindowDays: 3 },
    );
    expect(result.dailyTrend.map((day) => day.localDate)).toEqual([
      '2026-03-08',
      '2026-03-09',
    ]);
    expect(result.weekdayProfiles[0]?.drivingDays).toBe(1);
  });

  it('starts scenarios on tomorrow rather than using a partial current day', () => {
    const result = computeChargeAdvice(
      qualifiedHistory(8),
      [],
      live(80),
      NOW,
      'UTC',
    );
    expect(result.scenarios.startsLocalDate).toBe('2026-06-03');
    expect(result.scenarios.meanPath).toHaveLength(7);
    expect(result.scenarios.meanPath[0]?.localDate).toBe('2026-06-03');
  });

  it('uses the analysis clock for the history window and a separate live-state clock', () => {
    const liveObservedAt = NOW + 30 * 60 * 1_000;
    const currentStateNowMs = NOW + 60 * 60 * 1_000;
    const completedAfterMount = charge(
      '2026-06-02T12:15:00.000Z',
      '2026-06-02T12:45:00.000Z',
      40,
      83,
    );
    const result = computeChargeAdvice(
      qualifiedHistory(),
      [completedAfterMount],
      live(80, liveObservedAt),
      NOW,
      'UTC',
      { currentStateNowMs },
    );
    expect(result.nowMs).toBe(NOW);
    expect(result.currentStateNowMs).toBe(currentStateNowMs);
    expect(result.current.source).toBe('charge_end');
    expect(result.current.batteryPct).toBe(83);
    expect(result.chargingAccounting.categories.future).toBe(1);
    expect(result.evidence.windowEndLocalDate).toBe('2026-06-02');
    expect(result.scenarios.startsLocalDate).toBe('2026-06-03');
  });

  it('uses exact calendar-day p75 values without forcing active-day ordering', () => {
    const result = computeChargeAdvice(
      [drive('2026-05-04T09:00:00Z', 50)],
      [],
      live(90),
      NOW,
      'UTC',
    );
    const monday = result.weekdayProfiles[1]!;
    expect(monday.calendarOccurrences).toBe(26);
    expect(monday.meanPct).toBeGreaterThan(0);
    expect(monday.medianPct).toBe(0);
    expect(monday.p75Pct).toBe(0);
    expect(monday.activeDayMedianPct).toBe(50);

    const dense = computeChargeAdvice(
      Array.from({ length: 13 }, (_, index) => {
        const date = new Date(Date.UTC(2025, 11, 8 + index * 14));
        return drive(`${date.toISOString().slice(0, 10)}T09:00:00Z`, 10);
      }),
      [],
      live(90),
      NOW,
      'UTC',
    );
    const denseMonday = dense.weekdayProfiles[1]!;
    expect(denseMonday.meanPct).toBe(5);
    expect(denseMonday.medianPct).toBe(5);
    expect(denseMonday.p75Pct).toBe(10);
  });

  it('returns reserve sensitivity for configured floors', () => {
    const result = computeChargeAdvice(
      qualifiedHistory(15),
      [],
      live(80),
      NOW,
      'UTC',
      { reserveFloorPct: 20, reserveSensitivityPcts: [10, 30] },
    );
    expect(result.reserveSensitivity.map((item) => item.floorPct)).toEqual([10, 20, 30]);
    expect(result.reserveSensitivity.every((item) => item.meanDaysToCross == null || item.meanDaysToCross >= 0)).toBe(true);
  });

  it('gives charging precedence over all scenario guidance', () => {
    const result = computeChargeAdvice(
      qualifiedHistory(30),
      [],
      live(10, NOW, { isCharging: true }),
      NOW,
      'UTC',
    );
    expect(result.guidance).toBe('already_charging');
  });

  it('does not use invalid, future, or stale live fields for guidance or charge limits', () => {
    const future = computeChargeAdvice(
      [drive('2026-06-02T09:00:00Z', 5)],
      [],
      live(10, NOW + 60 * 60 * 1_000, { isCharging: true, chargeLimitPct: 90 }),
      NOW,
      'UTC',
    );
    expect(future.current.source).toBe('drive_end');
    expect(future.current.isCharging).toBeNull();
    expect(future.current.chargeLimitPct).toBeNull();
    expect(future.guidance).not.toBe('already_charging');

    const stale = computeChargeAdvice(
      [],
      [],
      live(10, NOW - 3 * 86_400_000, { isCharging: true, chargeLimitPct: 90 }),
      NOW,
      'UTC',
    );
    expect(stale.current.freshness).toBe('stale');
    expect(stale.current.isCharging).toBeNull();
    expect(stale.current.chargeLimitPct).toBeNull();
    expect(stale.guidance).toBe('stale');

    const invalid = computeChargeAdvice(
      [],
      [],
      live(Number.NaN, NOW, { isCharging: true, chargeLimitPct: 90 }),
      NOW,
      'UTC',
    );
    expect(invalid.current.isCharging).toBeNull();
    expect(invalid.current.chargeLimitPct).toBeNull();
    expect(invalid.guidance).toBe('current_state_unavailable');
  });

  it('blocks guidance for a stale historical fallback', () => {
    const old = drive('2026-05-25T09:00:00Z', 5);
    const result = computeChargeAdvice([old], [], live(null, null), NOW, 'UTC');
    expect(result.current.source).toBe('drive_end');
    expect(result.current.freshness).toBe('stale');
    expect(result.guidance).toBe('stale');
  });

  it('reports missing current state instead of inventing a battery value', () => {
    const result = computeChargeAdvice([], [], live(null, null), NOW, 'UTC');
    expect(result.current.batteryPct).toBeNull();
    expect(result.current.source).toBeNull();
    expect(result.guidance).toBe('current_state_unavailable');
    expect(result.scenarios.meanPath).toEqual([]);
  });

  it('uses a fallback only when a completed observation is valid and recent enough', () => {
    const result = computeChargeAdvice(
      [drive('2026-06-02T09:00:00Z', 5)],
      [],
      live(null, null),
      NOW,
      'UTC',
    );
    expect(result.current.source).toBe('drive_end');
    expect(result.current.freshness).toBe('fresh');
    expect(result.guidance).toBe('insufficient_history');
  });

  it('withholds actionable guidance below the hard history gate', () => {
    const result = computeChargeAdvice(
      [drive('2026-06-01T09:00:00Z', 40)],
      [],
      live(5),
      NOW,
      'UTC',
    );
    expect(result.evidenceGatePassed).toBe(false);
    expect(result.guidance).toBe('insufficient_history');
  });

  it('reflects low fresh SoC after the evidence gate is met', () => {
    const result = computeChargeAdvice(
      qualifiedHistory(5),
      [],
      live(15),
      NOW,
      'UTC',
    );
    expect(result.evidenceGatePassed).toBe(true);
    expect(result.guidance).toBe('charge_before_next_use');
  });

  it('distinguishes monitor from a mean path with no immediate crossing', () => {
    const dates = Array.from({ length: 28 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 4, 4 + index));
      return date.toISOString().slice(0, 10);
    });
    const result = computeChargeAdvice(
      dates.map((date, index) => drive(`${date}T09:00:00Z`, index < 14 ? 5 : 50)),
      [],
      live(90),
      NOW,
      'UTC',
      { historyWindowDays: 30 },
    );
    expect(result.evidenceGatePassed).toBe(true);
    expect(result.guidance).toBe('monitor');
  });

  it('returns no immediate need when neither path crosses the selected floor', () => {
    const result = computeChargeAdvice(qualifiedHistory(1), [], live(95), NOW, 'UTC');
    expect(result.guidance).toBe('no_immediate_need');
    expect(result.scenarios.meanDaysToCrossReserve).toBeNull();
  });

  it('selects the newest valid SoC observation across drives and charging', () => {
    const result = computeChargeAdvice(
      [drive('2026-05-30T09:00:00Z', 5)],
      [charge('2026-06-01T20:00:00Z', '2026-06-01T21:00:00Z', 40, 82)],
      live(null, null),
      NOW,
      'UTC',
    );
    expect(result.current.source).toBe('charge_end');
    expect(result.current.batteryPct).toBe(82);
    expect(result.current.observedAtMs).toBe(Date.parse('2026-06-01T21:00:00Z'));
  });

  it('selects the newest candidate source rather than preferring live unconditionally', () => {
    const newerCharge = computeChargeAdvice(
      [drive('2026-06-01T09:00:00Z', 5)],
      [charge('2026-06-01T20:00:00Z', '2026-06-01T21:00:00Z', 40, 82)],
      live(75, Date.parse('2026-06-01T12:00:00Z')),
      NOW,
      'UTC',
    );
    expect(newerCharge.current.source).toBe('charge_end');
    expect(newerCharge.current.batteryPct).toBe(82);

    const newerLive = computeChargeAdvice(
      [drive('2026-06-01T09:00:00Z', 5)],
      [charge('2026-06-01T20:00:00Z', '2026-06-01T21:00:00Z', 40, 82)],
      live(75, Date.parse('2026-06-02T11:00:00Z')),
      NOW,
      'UTC',
      { currentStateNowMs: Date.parse('2026-06-02T12:00:00Z') },
    );
    expect(newerLive.current.source).toBe('live');
    expect(newerLive.current.batteryPct).toBe(75);
  });

  it('uses a valid live observation even when its SoC is zero', () => {
    const result = computeChargeAdvice([], [], live(0), NOW, 'UTC');
    expect(result.current.source).toBe('live');
    expect(result.current.batteryPct).toBe(0);
  });

  it('reconciles charging rows and builds its timing and energy profile', () => {
    const rows = [
      charge('2026-06-01T20:00:00Z', '2026-06-01T21:00:00Z', 30, 80, 20_000),
      charge('2025-01-01T20:00:00Z', '2025-01-01T21:00:00Z'),
      charge('2026-06-01T22:00:00Z', null),
      charge('2026-06-01T23:00:00Z', '2026-06-01T22:00:00Z'),
      charge('2026-06-03T20:00:00Z', '2026-06-03T21:00:00Z'),
      charge('2026-06-01T19:00:00Z', '2026-06-01T20:00:00Z', 30, null),
      charge('2026-06-01T18:00:00Z', '2026-06-01T19:00:00Z', 110, 120),
    ];
    const result = computeChargeAdvice([], rows, live(80), NOW, 'UTC');
    const categories = result.chargingAccounting.categories;
    expect(Object.values(categories).reduce((sum, count) => sum + count, 0)).toBe(rows.length);
    expect(categories).toMatchObject({
      included: 1,
      outside_window: 1,
      incomplete_live: 1,
      invalid_timestamp_order: 1,
      future: 1,
      missing_soc: 1,
      invalid_soc: 1,
    });
    expect(result.chargingProfile.sessions).toBe(1);
    expect(result.chargingProfile.totalEnergyAddedWh).toBe(20_000);
    expect(result.chargingProfile.startsByHour[20]).toBe(1);
  });

  it('accounts for nonpositive charging gains without aggregating them', () => {
    const result = computeChargeAdvice(
      [],
      [
        charge('2026-06-01T20:00:00Z', '2026-06-01T21:00:00Z', 30, 80, 20_000),
        charge('2026-06-01T22:00:00Z', '2026-06-01T23:00:00Z', 80, 80, 30_000),
        charge('2026-06-02T00:00:00Z', '2026-06-02T01:00:00Z', 80, 70, 40_000),
      ],
      live(80),
      NOW,
      'UTC',
    );
    const categories = result.chargingAccounting.categories;
    expect(Object.values(categories).reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(categories).toMatchObject({
      included: 1,
      nonpositive_soc_gain: 2,
    });
    expect(result.chargingProfile.sessions).toBe(1);
    expect(result.chargingProfile.totalEnergyAddedWh).toBe(20_000);
    expect(result.chargingProfile.energyRows).toBe(1);
  });

  it('reports exact query caps for each source independently', () => {
    const drives = Array.from({ length: 1_000 }, (_, index) => drive(
      `2026-05-${String((index % 28) + 1).padStart(2, '0')}T09:00:00Z`,
    ));
    const charges = Array.from({ length: 1_000 }, () => charge(
      '2026-05-01T20:00:00Z',
      '2026-05-01T21:00:00Z',
    ));
    const result = computeChargeAdvice(drives, charges, live(80), NOW, 'UTC');
    expect(result.evidence.historyCapReached).toBe(true);
    expect(result.chargingEvidence.historyCapReached).toBe(true);
    expect(result.evidence.historyLimit).toBe(1_000);
  });

  it('exposes support based on rows, local days, weeks, and observed span', () => {
    const result = computeChargeAdvice(qualifiedHistory(), [], live(80), NOW, 'UTC');
    expect(result.evidence.support.activeLocalDays).toBe(8);
    expect(result.evidence.support.activeWeeks).toBeGreaterThanOrEqual(4);
    expect(result.evidence.support.observedSpanDays).toBe(29);
    expect(result.evidence.support.score).toBeGreaterThan(0);
  });

  it('does not mutate rows or option arrays', () => {
    const rows = qualifiedHistory();
    const options = [30, 10];
    const beforeRows = JSON.stringify(rows);
    const beforeOptions = [...options];
    computeChargeAdvice(rows, [], live(80), NOW, 'UTC', {
      reserveSensitivityPcts: options,
    });
    expect(JSON.stringify(rows)).toBe(beforeRows);
    expect(options).toEqual(beforeOptions);
  });

  it('normalizes hostile clock, timezone, options, and numeric rows to finite output', () => {
    const result = computeChargeAdvice(
      [drive('2026-06-01T09:00:00Z', Number.NaN)],
      [charge('2026-06-01T20:00:00Z', '2026-06-01T21:00:00Z', 30, 80, Number.POSITIVE_INFINITY)],
      live(Number.NaN, Number.POSITIVE_INFINITY),
      Number.NaN,
      'Mars/Olympus_Mons',
      {
        historyWindowDays: Number.POSITIVE_INFINITY,
        reserveFloorPct: Number.NaN,
        fallbackMaxAgeMs: Number.POSITIVE_INFINITY,
        reserveSensitivityPcts: [Number.NaN, Number.POSITIVE_INFINITY],
      },
    );
    expect(result.timeZone).toBe('UTC');
    expect(result.reserveFloorPct).toBe(20);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('NaN');
    expect(serialized).not.toContain('Infinity');
  });

  it('falls back to UTC deterministically for an invalid IANA timezone', () => {
    const result = computeChargeAdvice([], [], live(80), NOW, 'invalid/timezone');
    expect(result.timeZone).toBe('UTC');
    expect(result.evidence.windowEndLocalDate).toBe('2026-06-02');
  });

  it('exports the configured default reserve floor', () => {
    expect(RESERVE_FLOOR_PCT).toBe(20);
  });
});
