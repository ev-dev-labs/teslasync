import { describe, expect, it } from 'vitest';

import {
  analyzePackCapacity,
  buildCapacityObservations,
  kalmanFilterCapacity,
  type CapacityObservation,
  type PackCapacitySession,
} from './packCapacity';

const BASE_MS = Date.parse('2026-01-01T20:00:00.000Z');
const NOW_MS = Date.parse('2027-08-01T12:00:00.000Z');
let nextId = 1;

function session(
  dayOffset: number,
  socDeltaPct: number,
  capacityWh: number,
  overrides: Partial<PackCapacitySession> = {},
): PackCapacitySession {
  const startMs = BASE_MS + dayOffset * 86_400_000;
  const endMs = startMs + 2 * 3_600_000;
  const startedAt = new Date(startMs).toISOString();
  const endedAt = new Date(endMs).toISOString();
  return {
    id: String(nextId++),
    vehicle_id: '1',
    charger_type: 'ac',
    start_soc_pct: 20,
    end_soc_pct: 20 + socDeltaPct,
    total_energy_added_wh: capacityWh * (socDeltaPct / 100),
    peak_power_w: 11_000,
    cost_decimal: null,
    started_at: startedAt,
    ended_at: endedAt,
    start_ts: startedAt,
    startedAt,
    duration_min: 120,
    ...overrides,
  };
}

function observation(
  dayOffset: number,
  capacityWh: number,
  sigmaWh: number,
): CapacityObservation {
  const startMs = BASE_MS + dayOffset * 86_400_000;
  const endMs = startMs + 2 * 3_600_000;
  return {
    sessionId: `o${dayOffset}`,
    startTs: new Date(startMs).toISOString(),
    endTs: new Date(endMs).toISOString(),
    startMs,
    endMs,
    durationS: 7_200,
    startSocPct: 20,
    endSocPct: 60,
    socDeltaPct: 40,
    energyAddedWh: capacityWh * 0.4,
    capacityWh,
    sigmaWh,
    relativeSigma: sigmaWh / capacityWh,
    chargerType: 'ac',
    locationLabel: 'Home',
  };
}

describe('buildCapacityObservations', () => {
  it('derives SI capacity and measurement uncertainty from completed endpoints', () => {
    const { observations } = buildCapacityObservations(
      [session(0, 50, 75_000)],
      NOW_MS,
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      capacityWh: 75_000,
      socDeltaPct: 50,
      energyAddedWh: 37_500,
      durationS: 7_200,
    });
    expect(observations[0]!.sigmaWh).toBeGreaterThan(0);
  });

  it('scales measurement uncertainty inversely with the SoC window', () => {
    const wide = buildCapacityObservations(
      [session(0, 60, 75_000)],
      NOW_MS,
      { minSocWindowPct: 5 },
    ).observations[0]!;
    const narrow = buildCapacityObservations(
      [session(1, 6, 75_000)],
      NOW_MS,
      { minSocWindowPct: 5 },
    ).observations[0]!;

    expect(narrow.capacityWh).toBe(wide.capacityWh);
    expect(narrow.sigmaWh).toBeGreaterThan(wide.sigmaWh * 5);
  });

  it('assigns every returned row to exactly one primary category', () => {
    const futureStart = '2028-01-01T00:00:00.000Z';
    const futureEnd = '2028-01-01T02:00:00.000Z';
    const duplicateA = session(20, 40, 75_000, { id: 'duplicate' });
    const duplicateB = session(21, 40, 75_000, { id: 'duplicate' });
    const overlapA = session(30, 40, 75_000);
    const overlapB = session(30, 40, 75_000, {
      id: 'overlap',
      started_at: new Date(BASE_MS + 30 * 86_400_000 + 3_600_000)
        .toISOString(),
      ended_at: new Date(BASE_MS + 30 * 86_400_000 + 4 * 3_600_000)
        .toISOString(),
    });
    const rows: PackCapacitySession[] = [
      session(0, 40, 75_000),
      session(1, 40, 75_000, { ended_at: null }),
      session(2, 40, 75_000, { started_at: 'bad' }),
      session(3, 40, 75_000, {
        started_at: '2026-01-04T22:00:00.000Z',
        ended_at: '2026-01-04T21:00:00.000Z',
      }),
      session(4, 40, 75_000, {
        started_at: futureStart,
        ended_at: futureEnd,
      }),
      session(5, 40, 75_000, { end_soc_pct: null }),
      session(6, 40, 75_000, { start_soc_pct: -1 }),
      session(7, 40, 75_000, {
        start_soc_pct: 60,
        end_soc_pct: 50,
      }),
      session(8, 40, 75_000, { total_energy_added_wh: null }),
      session(9, 40, 75_000, { total_energy_added_wh: 0 }),
      session(10, 5, 75_000),
      session(11, 40, 75_000, { total_energy_added_wh: 500 }),
      duplicateA,
      duplicateB,
      overlapA,
      overlapB,
    ];

    const { accounting } = buildCapacityObservations(rows, NOW_MS);

    expect(accounting.categories).toMatchObject({
      included: 3,
      incomplete_live: 1,
      invalid_timestamp_order: 2,
      future: 1,
      missing_soc: 1,
      invalid_soc: 1,
      nonpositive_soc_gain: 1,
      missing_energy: 1,
      invalid_energy: 1,
      below_soc_window: 1,
      implausible_capacity: 1,
      duplicate_session: 1,
      overlapping_interval: 1,
    });
    expect(accounting.includedRows + accounting.excludedRows).toBe(
      accounting.returnedRows,
    );
    expect(
      Object.values(accounting.categories).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(accounting.returnedRows);
  });

  it('uses only canonical started_at rather than a legacy alias', () => {
    const row = session(0, 40, 75_000, {
      started_at: 'bad',
      start_ts: '2026-01-01T20:00:00.000Z',
      startedAt: '2026-01-01T20:00:00.000Z',
    });

    const { accounting } = buildCapacityObservations(
      [row],
      NOW_MS,
    );
    expect(accounting.categories.invalid_timestamp_order).toBe(1);
  });

  it('keeps the newest eligible observations inside the analysis cap', () => {
    const rows = [
      session(0, 40, 75_000),
      session(1, 40, 74_500),
      session(2, 40, 74_000),
    ];
    const { observations, accounting } = buildCapacityObservations(
      rows,
      NOW_MS,
      { historyLimit: 2 },
    );

    expect(observations.map((row) => row.capacityWh)).toEqual([
      74_500, 74_000,
    ]);
    expect(accounting.categories.outside_analysis_cap).toBe(1);
    expect(accounting.historyCapReached).toBe(true);
  });

  it('does not mutate returned sessions', () => {
    const rows = [
      session(3, 40, 73_000),
      session(1, 40, 75_000),
    ];
    const snapshot = structuredClone(rows);
    buildCapacityObservations(rows, NOW_MS);
    expect(rows).toEqual(snapshot);
  });
});

describe('kalmanFilterCapacity', () => {
  it('returns an empty series for no observations', () => {
    expect(kalmanFilterCapacity([])).toEqual([]);
  });

  it('converges toward repeated evidence and shrinks uncertainty', () => {
    const observations = Array.from({ length: 12 }, (_, index) =>
      observation(
        index * 3,
        75_000 + (index % 2 === 0 ? 900 : -900),
        1_200,
      ),
    );
    const states = kalmanFilterCapacity(observations);
    const last = states[states.length - 1]!;

    expect(last.capacityWh).toBeGreaterThan(74_000);
    expect(last.capacityWh).toBeLessThan(76_000);
    expect(last.sigmaWh).toBeLessThan(states[0]!.sigmaWh);
  });

  it('trusts a precise measurement more than a noisy one', () => {
    const precise = kalmanFilterCapacity([
      observation(0, 75_000, 1_000),
      observation(1, 60_000, 200),
    ]);
    const noisy = kalmanFilterCapacity([
      observation(0, 75_000, 1_000),
      observation(1, 60_000, 20_000),
    ]);

    expect(precise[1]!.gain).toBeGreaterThan(noisy[1]!.gain);
    expect(precise[1]!.capacityWh).toBeLessThan(
      noisy[1]!.capacityWh,
    );
  });

  it('scales random-walk process variance linearly with elapsed days', () => {
    const oneDay = kalmanFilterCapacity(
      [
        observation(0, 75_000, 500),
        observation(1, 70_000, 500),
      ],
      { processNoiseWhPerSqrtDay: 30 },
    );
    const fourHundredDays = kalmanFilterCapacity(
      [
        observation(0, 75_000, 500),
        observation(400, 70_000, 500),
      ],
      { processNoiseWhPerSqrtDay: 30 },
    );

    expect(fourHundredDays[1]!.gain).toBeGreaterThan(oneDay[1]!.gain);
    expect(fourHundredDays[1]!.priorSigmaWh).toBeCloseTo(
      Math.sqrt(500 ** 2 + 30 ** 2 * 400),
      3,
    );
  });

  it('records the pre-update innovation and standardized residual', () => {
    const states = kalmanFilterCapacity([
      observation(0, 75_000, 1_000),
      observation(1, 78_000, 1_000),
    ]);

    expect(states[1]!.innovationWh).toBe(3_000);
    expect(states[1]!.innovationSigmaWh).toBeGreaterThan(1_000);
    expect(states[1]!.standardizedInnovation).toBeGreaterThan(2);
  });
});

describe('analyzePackCapacity', () => {
  it('returns explicit empty evidence without health or trend claims', () => {
    const result = analyzePackCapacity([], NOW_MS, 'UTC');

    expect(result.observations).toEqual([]);
    expect(result.states).toEqual([]);
    expect(result.summary).toMatchObject({
      currentWh: null,
      currentSigmaWh: null,
      currentToMaxRatio: null,
      rawMedianWh: null,
    });
    expect(result.summary.fit.status).toBe(
      'insufficient_observations',
    );
    expect(result.coverage.support).toMatchObject({
      index: 0,
      band: 'none',
    });
  });

  it('withholds annualized change until observation, span, and month gates pass', () => {
    const few = analyzePackCapacity(
      Array.from({ length: 5 }, (_, index) =>
        session(index * 45, 40, 75_000),
      ),
      NOW_MS,
      'UTC',
    );
    const short = analyzePackCapacity(
      Array.from({ length: 12 }, (_, index) =>
        session(index, 40, 75_000),
      ),
      NOW_MS,
      'UTC',
    );
    const fewMonths = analyzePackCapacity(
      Array.from({ length: 12 }, (_, index) =>
        session(index < 6 ? index : 360 + index, 40, 75_000),
      ),
      NOW_MS,
      'UTC',
    );

    expect(few.summary.fit.status).toBe('insufficient_observations');
    expect(short.summary.fit.status).toBe('insufficient_span');
    expect(fewMonths.summary.fit.status).toBe('insufficient_months');
    expect(few.summary.fit.annualChangeWh).toBeNull();
    expect(short.summary.fit.annualChangeWh).toBeNull();
    expect(fewMonths.summary.fit.annualChangeWh).toBeNull();
  });

  it('reports a descriptive negative annual change only after fit gates pass', () => {
    const rows = Array.from({ length: 18 }, (_, index) =>
      session(index * 30, 45, 75_000 - index * 100),
    );
    const result = analyzePackCapacity(rows, NOW_MS, 'UTC');

    expect(result.summary.fit.status).toBe('available');
    expect(result.summary.fit.annualChangeWh).toBeLessThan(0);
    expect(result.summary.fit.annualChangeShare).toBeLessThan(0);
    expect(result.summary.fit.rSquared).toBeGreaterThan(0.5);
    expect(result.summary.currentToMaxRatio).toBeLessThan(1);
  });

  it('attributes completions to vehicle-local months and preserves zero months', () => {
    const rows = [
      session(0, 40, 75_000, {
        started_at: '2026-03-01T06:00:00.000Z',
        ended_at: '2026-03-01T07:30:00.000Z',
      }),
      session(61, 40, 75_000, {
        started_at: '2026-04-30T23:00:00.000Z',
        ended_at: '2026-05-01T01:00:00.000Z',
      }),
    ];
    const result = analyzePackCapacity(
      rows,
      NOW_MS,
      'America/Los_Angeles',
    );

    expect(result.monthTrend.map((month) => month.monthKey)).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
    expect(result.monthTrend[1]).toMatchObject({ samples: 0 });
  });

  it('builds threshold, process-noise, window, and innovation diagnostics', () => {
    const rows = Array.from({ length: 18 }, (_, index) =>
      session(
        index * 30,
        10 + (index % 5) * 10,
        75_000 + (index % 3 - 1) * 800,
      ),
    );
    const result = analyzePackCapacity(rows, NOW_MS, 'UTC');

    expect(result.windowSensitivity).toHaveLength(5);
    expect(result.processSensitivity).toHaveLength(4);
    expect(result.socWindowProfile).toHaveLength(5);
    expect(result.innovationProfile).toHaveLength(5);
    expect(
      result.windowSensitivity.find(
        (point) => point.minSocWindowPct === 40,
      )!.includedRows,
    ).toBeLessThan(
      result.windowSensitivity.find(
        (point) => point.minSocWindowPct === 10,
      )!.includedRows,
    );
  });

  it('caps chart-only surfaces without dropping summary evidence', () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      session(index * 20, 40, 75_000),
    );
    const result = analyzePackCapacity(rows, NOW_MS, 'UTC', {
      maxTimelinePoints: 10,
      maxRecentMeasurements: 3,
      maxTrendMonths: 4,
    });

    expect(result.states).toHaveLength(20);
    expect(result.timeline).toHaveLength(10);
    expect(result.recentMeasurements).toHaveLength(3);
    expect(result.coverage.omittedTimelinePoints).toBe(10);
    expect(result.monthTrend.length).toBeLessThanOrEqual(4);
  });

  it('falls back to UTC for an invalid timezone', () => {
    const result = analyzePackCapacity([], NOW_MS, 'Nope/Zone');
    expect(result.timeZone).toBe('UTC');
  });

  it('clamps hostile configuration without producing non-finite output', () => {
    const result = analyzePackCapacity(
      [session(0, 40, 75_000)],
      NOW_MS,
      'UTC',
      {
        minSocWindowPct: -100,
        processNoiseWhPerSqrtDay: Number.POSITIVE_INFINITY,
        historyLimit: -1,
      },
    );

    expect(result.config.minSocWindowPct).toBe(1);
    expect(result.config.processNoiseWhPerSqrtDay).toBe(30);
    expect(result.config.historyLimit).toBe(1);
    expect(Number.isFinite(result.summary.currentWh)).toBe(true);
  });

  it('rejects a non-finite analysis clock', () => {
    expect(() =>
      analyzePackCapacity([], NaN, 'UTC'),
    ).toThrow(RangeError);
  });
});
