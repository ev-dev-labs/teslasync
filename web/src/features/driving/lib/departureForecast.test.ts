import { describe, expect, it } from 'vitest';

import type { Drive } from '@/types/driving';

import {
  buildDepartureRates,
  forecastDepartures,
  weekdayPeaks,
} from './departureForecast';

const NOW_MS = Date.parse('2026-05-14T06:30:00.000Z');
let nextId = 1;

function driveAt(startTs: string, overrides: Partial<Drive> = {}): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs,
    endTs: null,
    durationS: 1_800,
    distanceM: 20_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 3_000,
    regenEnergyWh: null,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: 15,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function weekdayCommute(weeks: number): Drive[] {
  const drives: Drive[] = [];
  for (let daysAgo = 1; daysAgo <= weeks * 7; daysAgo += 1) {
    const date = new Date(NOW_MS - daysAgo * 86_400_000);
    const weekday = date.getUTCDay();
    if (weekday < 1 || weekday > 5) continue;
    const startMs = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      8,
      5,
    );
    drives.push(driveAt(new Date(startMs).toISOString()));
  }
  return drives;
}

function expectFiniteNumbers(value: unknown): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(expectFiniteNumbers);
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(expectFiniteNumbers);
  }
}

describe('buildDepartureRates', () => {
  it('returns a zeroed, prior-free 7x24 matrix with zero history', () => {
    const rates = buildDepartureRates([], NOW_MS, 'UTC');

    expect(rates.totalDepartures).toBe(0);
    expect(rates.observedSpanDays).toBe(0);
    expect(rates.matrix).toHaveLength(7);
    expect(rates.matrix.every((row) => row.length === 24)).toBe(true);
    expect(rates.matrix.flat().every((cell) => cell.p === 0)).toBe(true);
    expect(rates.accounting).toMatchObject({
      returnedRows: 0,
      includedRows: 0,
      invalidRows: 0,
      futureRows: 0,
      outsideWindowRows: 0,
      historyCapReached: false,
    });
  });

  it('fits a stronger shrunk rate to a repeated commute cell', () => {
    const rates = buildDepartureRates(
      weekdayCommute(8),
      NOW_MS,
      'UTC',
    );

    expect(rates.counts[4]![8]).toBeGreaterThan(6);
    expect(rates.lambda[4]![8]!).toBeGreaterThan(rates.lambda[4]![13]!);
    expect(rates.lambda[0]![8]!).toBeLessThan(rates.lambda[4]![8]!);
  });

  it('accounts for every invalid, future, outside, and included row', () => {
    const invalid = driveAt('not-a-date');
    const future = driveAt('2026-05-15T08:00:00.000Z');
    const outside = driveAt('2025-01-01T08:00:00.000Z');
    const included = driveAt('2026-05-10T08:00:00.000Z');
    const rates = buildDepartureRates(
      [invalid, future, outside, included],
      NOW_MS,
      'UTC',
    );

    expect(rates.accounting).toMatchObject({
      returnedRows: 4,
      includedRows: 1,
      invalidRows: 1,
      futureRows: 1,
      outsideWindowRows: 1,
    });
    const accounted =
      rates.accounting.includedRows +
      rates.accounting.invalidRows +
      rates.accounting.futureRows +
      rates.accounting.outsideWindowRows;
    expect(accounted).toBe(rates.accounting.returnedRows);
  });

  it('buckets local weekday and hour in the configured timezone', () => {
    // Tuesday in UTC, but Monday 16:30 in Los Angeles.
    const rates = buildDepartureRates(
      [driveAt('2026-01-06T00:30:00.000Z')],
      Date.parse('2026-01-06T01:00:00.000Z'),
      'America/Los_Angeles',
    );

    expect(rates.counts[1]![16]).toBe(1);
    expect(rates.counts[2]![0]).toBe(0);
  });

  it('does not mutate or reorder the input drive array', () => {
    const drives = [
      driveAt('2026-05-12T09:00:00.000Z'),
      driveAt('2026-05-10T08:00:00.000Z'),
    ];
    const snapshot = JSON.stringify(drives);

    buildDepartureRates(drives, NOW_MS, 'UTC');

    expect(JSON.stringify(drives)).toBe(snapshot);
    expect(drives[0]!.startTs).toBe('2026-05-12T09:00:00.000Z');
  });
});

describe('forecastDepartures', () => {
  it('returns no prior-only slots, peak, horizon, or marker with zero history', () => {
    const forecast = forecastDepartures([], NOW_MS, 'UTC');

    expect(forecast.slots).toEqual([]);
    expect(forecast.rankedWindows).toEqual([]);
    expect(forecast.peak).toBeNull();
    expect(forecast.nextLikely).toBeNull();
    expect(forecast.horizonLikelihood).toBeNull();
    expect(forecast.planningMarkerAtMs).toBeNull();
    expect(forecast.evidenceStrength).toMatchObject({
      value: 0,
      band: 'none',
      includedDepartures: 0,
    });
  });

  it('keeps one old departure descriptively thin despite a long span', () => {
    const old = driveAt(
      new Date(NOW_MS - 100 * 86_400_000).toISOString(),
    );
    const forecast = forecastDepartures([old], NOW_MS, 'UTC');

    expect(forecast.observedWeeks).toBeGreaterThan(14);
    expect(forecast.evidenceStrength.value).toBeLessThan(0.05);
    expect(forecast.evidenceStrength.band).toBe('thin');
    expect(forecast.planningMarkerAtMs).toBeNull();
  });

  it('starts at the next boundary with truthful relative minutes', () => {
    const forecast = forecastDepartures(
      weekdayCommute(8),
      NOW_MS,
      'UTC',
    );

    expect(forecast.slots).toHaveLength(24);
    expect(forecast.slots[0]).toMatchObject({
      hour: 7,
      minutesFromNow: 30,
      hoursFromNow: 0.5,
      slotIndex: 1,
    });
  });

  it('skips the nonexistent spring-forward hour in America/Los_Angeles', () => {
    const now = Date.parse('2026-03-08T09:30:00.000Z'); // 01:30 PST
    const forecast = forecastDepartures(
      [driveAt('2026-03-01T11:05:00.000Z')],
      now,
      'America/Los_Angeles',
    );

    expect(forecast.slots[0]).toMatchObject({
      startMs: Date.parse('2026-03-08T10:00:00.000Z'),
      weekday: 0,
      hour: 3,
      minutesFromNow: 30,
    });
    expect(forecast.slots.slice(0, 4).map((slot) => slot.hour)).toEqual([
      3, 4, 5, 6,
    ]);
  });

  it('keeps both repeated fall-back hours as distinct real slots', () => {
    const now = Date.parse('2026-11-01T07:30:00.000Z'); // 00:30 PDT
    const forecast = forecastDepartures(
      [driveAt('2026-10-25T08:05:00.000Z')],
      now,
      'America/Los_Angeles',
    );

    expect(forecast.slots.slice(0, 3).map((slot) => ({
      startMs: slot.startMs,
      hour: slot.hour,
      minutesFromNow: slot.minutesFromNow,
    }))).toEqual([
      {
        startMs: Date.parse('2026-11-01T08:00:00.000Z'),
        hour: 1,
        minutesFromNow: 30,
      },
      {
        startMs: Date.parse('2026-11-01T09:00:00.000Z'),
        hour: 1,
        minutesFromNow: 90,
      },
      {
        startMs: Date.parse('2026-11-01T10:00:00.000Z'),
        hour: 2,
        minutesFromNow: 150,
      },
    ]);
  });

  it('finds whole local hours in a half-hour-offset timezone', () => {
    const now = Date.parse('2026-01-01T00:10:00.000Z'); // 05:40 IST
    const forecast = forecastDepartures(
      [driveAt('2025-12-25T00:35:00.000Z')],
      now,
      'Asia/Kolkata',
    );

    expect(forecast.slots[0]).toMatchObject({
      startMs: Date.parse('2026-01-01T00:30:00.000Z'),
      hour: 6,
      minutesFromNow: 20,
    });
  });

  it('keeps cumulative likelihood bounded and monotonic', () => {
    const forecast = forecastDepartures(
      weekdayCommute(6),
      NOW_MS,
      'UTC',
    );
    let previous = 0;
    for (const slot of forecast.slots) {
      expect(slot.p).toBeGreaterThanOrEqual(0);
      expect(slot.p).toBeLessThanOrEqual(1);
      expect(slot.cumulative).toBeGreaterThanOrEqual(previous);
      expect(slot.cumulative).toBeLessThanOrEqual(1);
      previous = slot.cumulative;
    }
    expect(forecast.horizonLikelihood).toBe(
      forecast.slots.at(-1)!.cumulative,
    );
  });

  it('places an illustrative marker 20 minutes before a supported peak', () => {
    const forecast = forecastDepartures(
      weekdayCommute(12),
      NOW_MS,
      'UTC',
    );

    expect(forecast.evidenceStrength.band).not.toBe('thin');
    expect(forecast.peak).not.toBeNull();
    expect(
      forecast.peak!.startMs - forecast.planningMarkerAtMs!,
    ).toBe(20 * 60_000);
  });

  it('keeps ranked ties stable in chronological slot order', () => {
    const tied = [
      driveAt('2026-05-07T08:05:00.000Z'),
      driveAt('2026-05-07T09:05:00.000Z'),
      driveAt('2026-04-30T08:05:00.000Z'),
      driveAt('2026-04-30T09:05:00.000Z'),
    ];
    const forecast = forecastDepartures(tied, NOW_MS, 'UTC', {
      priorAlpha: 0,
    });

    expect(forecast.rankedWindows.slice(0, 2).map((slot) => slot.hour)).toEqual([
      8, 9,
    ]);
    expect(forecast.rankedWindows[0]!.p).toBe(
      forecast.rankedWindows[1]!.p,
    );
  });

  it('marks the exact returned history limit as capped', () => {
    const drives = Array.from({ length: 1_000 }, (_, index) =>
      driveAt(
        new Date(NOW_MS - (index % 100) * 60_000).toISOString(),
      ),
    );
    const forecast = forecastDepartures(drives, NOW_MS, 'UTC', {
      historyLimit: 1_000,
    });

    expect(forecast.accounting.historyCapReached).toBe(true);
    expect(forecast.accounting.returnedRows).toBe(1_000);
    expect(forecast.accounting.includedRows).toBe(1_000);
  });

  it('never returns NaN or Infinity for hostile options and timestamps', () => {
    const forecast = forecastDepartures(
      [
        driveAt('bad'),
        driveAt('2026-05-10T08:00:00.000Z'),
      ],
      NOW_MS,
      'Invalid/Timezone',
      {
        priorAlpha: Number.NaN,
        priorBeta: Number.POSITIVE_INFINITY,
        horizonHours: Number.NEGATIVE_INFINITY,
      },
    );

    expect(forecast.timeZone).toBe('UTC');
    expectFiniteNumbers(forecast);
  });
});

describe('weekdayPeaks', () => {
  it('marks unsupported weekdays instead of manufacturing midnight routines', () => {
    const rates = buildDepartureRates(
      [
        driveAt('2026-05-11T08:05:00.000Z'),
        driveAt('2026-05-04T08:05:00.000Z'),
      ],
      NOW_MS,
      'UTC',
    );
    const profiles = weekdayPeaks(rates);

    expect(profiles).toHaveLength(7);
    expect(profiles[1]).toMatchObject({
      supported: true,
      hour: 8,
      totalDepartures: 2,
    });
    expect(profiles[0]).toMatchObject({
      supported: false,
      hour: null,
      p: null,
      totalDepartures: 0,
    });
  });
});
