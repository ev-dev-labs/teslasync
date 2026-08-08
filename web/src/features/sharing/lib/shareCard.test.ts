import { describe, expect, it } from 'vitest';

import {
  analyzeShareCard,
  renderShareCardSvg,
  SHARE_CARD_HISTORY_LIMIT,
  SHARE_CARD_THEMES,
  type ShareCardWindowInput,
} from './shareCard';

const WINDOW: ShareCardWindowInput = {
  startLabel: '2026-06-01',
  endLabel: '2026-08-31',
  startInstant: '2026-06-01T07:00:00.000Z',
  endInstantExclusive: '2026-09-01T07:00:00.000Z',
  timezone: 'America/Los_Angeles',
};

let nextId = 1;

function row(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: nextId++,
    startTs: '2026-07-01T15:00:00.000Z',
    durationS: 1_800,
    distanceM: 10_000,
    energyUsedWh: 2_000,
    regenEnergyWh: 300,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    outsideTempAvgC: 21,
    startAddress: 'Private origin',
    endAddress: 'Private destination',
    ...overrides,
  };
}

describe('analyzeShareCard runtime accounting', () => {
  it('assigns every returned row to exactly one terminal disposition', () => {
    const eligible = row({ id: 10 });
    const analysis = analyzeShareCard([
      null,
      row({ id: 0 }),
      eligible,
      row({ id: 10 }),
      row({ startTs: 'not-a-date' }),
      row({ startTs: '2026-05-31T06:59:59.999Z' }),
      row({ startTs: WINDOW.endInstantExclusive }),
    ], WINDOW);

    expect(analysis.dispositions).toEqual({
      invalidRow: 1,
      invalidId: 1,
      duplicateId: 1,
      invalidTimestamp: 1,
      beforeWindow: 1,
      atOrAfterEnd: 1,
      eligible: 1,
    });
    expect(analysis.returnedRows).toBe(7);
    expect(analysis.identities.find((check) =>
      check.id === 'rows.dispositions')?.passes).toBe(true);
  });

  it('accepts snake_case SI source fields while rejecting malformed values', () => {
    const analysis = analyzeShareCard([
      {
        id: 77,
        start_ts: '2026-07-03T12:00:00Z',
        distance_m: 2_500,
        duration_s: 400,
        energy_used_wh: 500,
        regen_energy_wh: 20,
        avg_speed_mps: 6.25,
        max_speed_mps: 12,
        outside_temp_avg_c: 17,
        start_address: 'Secret',
      },
      row({
        distanceM: Number.NaN,
        durationS: -1,
        energyUsedWh: '900',
        regenEnergyWh: Number.POSITIVE_INFINITY,
        avgSpeedMps: -5,
        maxSpeedMps: null,
        outsideTempAvgC: 'hot',
        insideTempAvgC: null,
        startAddress: ' ',
        endAddress: null,
      }),
    ], WINDOW);

    expect(analysis.eligibleRows).toBe(2);
    expect(analysis.aggregates.distanceM).toEqual({
      value: 2_500,
      supportRows: 1,
    });
    expect(analysis.coverage.distance).toEqual({
      validRows: 1,
      missingRows: 1,
    });
    expect(analysis.coverage.routeLabels).toEqual({
      validRows: 1,
      missingRows: 1,
    });
  });

  it('does not mutate caller rows or row order', () => {
    const rows = [
      Object.freeze(row({ id: 202, distanceM: 20_000 })),
      Object.freeze(row({ id: 201, distanceM: 30_000 })),
    ] as const;
    const before = JSON.stringify(rows);

    const analysis = analyzeShareCard(rows, WINDOW);

    expect(JSON.stringify(rows)).toBe(before);
    expect(rows[0].id).toBe(202);
    expect(analysis.representatives.map((drive) => drive.id)).toEqual([201, 202]);
  });

  it('marks exactly 1,000 returned rows as a capped sample', () => {
    const rows = Array.from(
      { length: SHARE_CARD_HISTORY_LIMIT },
      (_, index) => row({ id: index + 1 }),
    );
    const analysis = analyzeShareCard(rows, WINDOW);

    expect(analysis.returnedRows).toBe(1_000);
    expect(analysis.historyCapReached).toBe(true);
    expect(analysis.card.scope).toBe('cappedSample');
    expect(analysis.monthly.map((month) => month.month)).toEqual(['2026-07']);
  });

  it('calls sub-cap evidence returned evidence without guaranteeing completeness', () => {
    const analysis = analyzeShareCard([row()], WINDOW);
    expect(analysis.historyCapReached).toBe(false);
    expect(analysis.card.scope).toBe('returnedEvidence');
  });
});

describe('analyzeShareCard measurement evidence', () => {
  it('keeps measured zero separate from missing and preserves SI totals', () => {
    const analysis = analyzeShareCard([
      row({
        distanceM: 0,
        durationS: 0,
        energyUsedWh: 0,
        regenEnergyWh: 0,
        maxSpeedMps: 0,
      }),
      row({
        distanceM: null,
        durationS: undefined,
        energyUsedWh: null,
        regenEnergyWh: null,
        maxSpeedMps: null,
      }),
    ], WINDOW);

    expect(analysis.aggregates.distanceM).toEqual({
      value: 0,
      supportRows: 1,
    });
    expect(analysis.aggregates.energyUsedWh).toEqual({
      value: 0,
      supportRows: 1,
    });
    expect(analysis.coverage.energy).toEqual({
      validRows: 1,
      missingRows: 1,
    });
    expect(analysis.aggregates.maxSpeedMps.value).toBe(0);
  });

  it('withholds totals and card metrics when all source measurements are missing', () => {
    const analysis = analyzeShareCard([
      row({
        distanceM: null,
        durationS: null,
        energyUsedWh: null,
        regenEnergyWh: null,
        avgSpeedMps: null,
        maxSpeedMps: null,
        outsideTempAvgC: null,
        insideTempAvgC: null,
      }),
    ], WINDOW);

    expect(analysis.aggregates.distanceM.value).toBeNull();
    expect(analysis.aggregates.energyUsedWh.value).toBeNull();
    expect(analysis.card.ready).toBe(true);
    expect(analysis.card.lineInventory).toHaveLength(6);
    expect(analysis.card.missingMetricKeys).toEqual([
      'distance',
      'energy',
      'regen',
      'longest',
      'topSpeed',
    ]);
  });

  it('computes distance-weighted efficiency only from positive-distance measured-energy rows', () => {
    const analysis = analyzeShareCard([
      row({ distanceM: 10_000, energyUsedWh: 2_000 }),
      row({ distanceM: 30_000, energyUsedWh: 3_000 }),
      row({ distanceM: 0, energyUsedWh: 900 }),
      row({ distanceM: 5_000, energyUsedWh: null }),
      row({ distanceM: -1, energyUsedWh: 100 }),
    ], WINDOW);

    expect(analysis.efficiency).toEqual({
      whPerKm: 125,
      supportRows: 2,
      supportDistanceM: 40_000,
      supportEnergyWh: 5_000,
    });
  });

  it('uses only paired measured energy and regen for recovered share', () => {
    const analysis = analyzeShareCard([
      row({ energyUsedWh: 900, regenEnergyWh: 100 }),
      row({ energyUsedWh: 500, regenEnergyWh: null }),
      row({ energyUsedWh: null, regenEnergyWh: 50 }),
    ], WINDOW);

    expect(analysis.regen.recoveredWh).toBe(150);
    expect(analysis.regen.measuredRows).toBe(2);
    expect(analysis.regen.pairedRows).toBe(1);
    expect(analysis.regen.recoveredSharePct).toBe(10);
  });
});

describe('analyzeShareCard selected-window structure', () => {
  it('buckets month, weekday, and local day in the vehicle timezone', () => {
    const analysis = analyzeShareCard([
      row({ id: 401, startTs: '2026-07-01T06:30:00Z' }),
      row({ id: 402, startTs: '2026-07-01T07:30:00Z' }),
    ], WINDOW);

    expect(analysis.days.map((day) => day.day)).toEqual([
      '2026-06-30',
      '2026-07-01',
    ]);
    expect(analysis.weekdays.find((day) => day.weekday === 2)?.driveCount).toBe(1);
    expect(analysis.weekdays.find((day) => day.weekday === 3)?.driveCount).toBe(1);
    expect(analysis.monthly.find((month) => month.month === '2026-06')?.driveCount).toBe(1);
    expect(analysis.monthly.find((month) => month.month === '2026-07')?.driveCount).toBe(1);
    expect(analysis.activeDays).toBe(2);
  });

  it('retains zero-count requested months in the selected-window trend', () => {
    const analysis = analyzeShareCard([row()], WINDOW);
    expect(analysis.monthly.map((month) => month.month)).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
    expect(analysis.monthly[0]?.driveCount).toBe(0);
    expect(analysis.monthly[2]?.energyWh).toBeNull();
  });

  it('does not invent zero-drive months when the returned history is capped', () => {
    const rows = Array.from(
      { length: SHARE_CARD_HISTORY_LIMIT },
      (_, index) => row({ id: index + 1, startTs: '2026-07-01T15:00:00Z' }),
    );

    const analysis = analyzeShareCard(rows, WINDOW);

    expect(analysis.historyCapReached).toBe(true);
    expect(analysis.monthly).toHaveLength(1);
    expect(analysis.monthly[0]).toMatchObject({
      month: '2026-07',
      driveCount: SHARE_CARD_HISTORY_LIMIT,
    });
    expect(analysis.monthly.some((month) => month.month === '2026-06')).toBe(false);
    expect(analysis.monthly.some((month) => month.month === '2026-08')).toBe(false);
  });

  it('computes requested/observed spans, distributions, and interpolated quantiles', () => {
    const analysis = analyzeShareCard([
      row({
        id: 501,
        startTs: '2026-06-01T08:00:00Z',
        distanceM: 1_000,
        durationS: 600,
      }),
      row({
        id: 502,
        startTs: '2026-06-03T08:00:00Z',
        distanceM: 10_000,
        durationS: 1_200,
      }),
      row({
        id: 503,
        startTs: '2026-06-05T08:00:00Z',
        distanceM: 30_000,
        durationS: 2_400,
      }),
      row({
        id: 504,
        startTs: '2026-06-07T08:00:00Z',
        distanceM: 60_000,
        durationS: 4_800,
      }),
    ], WINDOW);

    expect(analysis.window.requestedCalendarDays).toBe(92);
    expect(analysis.observedCalendarDays).toBe(7);
    expect(analysis.observedSpanS).toBe(6 * 86_400);
    expect(analysis.distanceDistribution.map((band) => band.count)).toEqual([1, 1, 1, 1]);
    expect(analysis.durationDistribution.map((band) => band.count)).toEqual([1, 1, 1, 1]);
    expect(analysis.distanceQuantilesM.p50).toBe(20_000);
    expect(analysis.durationQuantilesS.p90).toBeCloseTo(4_080, 8);
  });

  it('ranks representative drives without retaining addresses or coordinates', () => {
    const hostileAddress = '123 Private Home Lane';
    const analysis = analyzeShareCard([
      row({
        id: 601,
        distanceM: 5_000,
        startAddress: hostileAddress,
        startLat: 12.34,
        startLon: 56.78,
      }),
      row({ id: 602, distanceM: 50_000 }),
    ], WINDOW);
    const serialized = JSON.stringify(analysis.representatives);

    expect(analysis.representatives[0]?.id).toBe(602);
    expect(analysis.representatives[1]?.hasRouteLabels).toBe(true);
    expect(serialized).not.toContain(hostileAddress);
    expect(serialized).not.toContain('12.34');
    expect(serialized).not.toContain('56.78');
  });

  it('balances every exact accounting identity', () => {
    const analysis = analyzeShareCard([
      row(),
      row({ energyUsedWh: null, distanceM: null }),
      { broken: true },
    ], WINDOW);

    expect(analysis.identities.length).toBeGreaterThan(10);
    expect(analysis.identities.every((check) => check.passes)).toBe(true);
  });

  it('falls back to UTC for an invalid timezone without throwing', () => {
    const analysis = analyzeShareCard(
      [row({ startTs: '2026-07-01T00:30:00Z' })],
      { ...WINDOW, timezone: 'Mars/Olympus_Mons' },
    );
    expect(analysis.window.timezoneValid).toBe(false);
    expect(analysis.window.resolvedTimezone).toBe('UTC');
    expect(analysis.days[0]?.day).toBe('2026-07-01');
  });
});

describe('renderShareCardSvg', () => {
  const lines = [
    { label: 'Distance', value: '1,234 km' },
    { label: 'Drives', value: '87' },
    { label: 'Energy', value: '200 kWh' },
    { label: 'Regen', value: '20 kWh' },
    { label: 'Longest', value: '300 km' },
    { label: 'Top speed', value: '100 km/h' },
  ];

  it('renders deterministic 800×418 artwork with six evidence lines', () => {
    const first = renderShareCardSvg(
      'Selected window',
      'Observed capped sample',
      lines,
      'midnight',
      {
        disclosure: '1,000 returned rows; full-range coverage is not claimed',
        footer: 'TeslaSync · capped sample',
      },
    );
    const second = renderShareCardSvg(
      'Selected window',
      'Observed capped sample',
      lines,
      'midnight',
      {
        disclosure: '1,000 returned rows; full-range coverage is not claimed',
        footer: 'TeslaSync · capped sample',
      },
    );

    expect(first).toBe(second);
    expect(first).toContain('viewBox="0 0 800 418"');
    expect(first).toContain(SHARE_CARD_THEMES.midnight.bg);
    expect(first).toContain('full-range coverage is not claimed');
    expect(first).toContain('TeslaSync · capped sample');
    for (const line of lines) expect(first).toContain(line.value);
  });

  it('escapes hostile title, subtitle, line, disclosure, and footer strings', () => {
    const hostile = `<script>&"'`;
    const svg = renderShareCardSvg(
      hostile,
      hostile,
      [{ label: hostile, value: hostile }],
      'aurora',
      { disclosure: hostile, footer: hostile },
    );

    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;&amp;&quot;&apos;');
  });

  it('wraps a long missing-data disclosure inside the fixed canvas', () => {
    const disclosure = [
      'Cap reached; full-range coverage not claimed',
      'Missing: Distance, Drive energy, Regen recovered, Longest measured drive, Top measured speed',
    ].join(' · ');
    const svg = renderShareCardSvg(
      'My Tesla selected-window evidence · 2015-01-01 – 2026-08-02',
      'Observed capped sample · 1,000 returned rows',
      lines,
      'midnight',
      { disclosure },
    );

    expect(svg).toContain('<tspan x="48" dy="0">');
    expect(svg).toContain('<tspan x="48" dy="17">');
    expect(svg).toContain('Cap reached; full-range coverage not claimed');
    expect(svg).toContain('Top measured speed');
    expect(svg).toContain('textLength="704"');
  });

  it('caps the renderer at six lines and falls back from an invalid theme', () => {
    const many = Array.from(
      { length: 9 },
      (_, index) => ({ label: `L${index}`, value: `V${index}` }),
    );
    const svg = renderShareCardSvg('T', 'S', many, 'invalid' as never);
    expect(svg).toContain('V5');
    expect(svg).not.toContain('V6');
    expect(svg).toContain(SHARE_CARD_THEMES.midnight.bg);
  });
});
