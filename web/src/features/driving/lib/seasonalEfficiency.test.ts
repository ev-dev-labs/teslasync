import { describe, expect, it } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  analyzeSeasonalEfficiency,
  normalizeSeasonalTimezone,
} from './seasonalEfficiency';

const NOW = Date.parse('2026-12-31T23:59:00.000Z');
let nextId = 1;

function drive(
  startTs: string,
  whPerM: number,
  distanceM = 10_000,
  overrides: Partial<Drive> = {},
): Drive {
  const parsed = Date.parse(startTs);
  const durationS = overrides.durationS ?? 1_800;
  const defaultEnd = Number.isFinite(parsed)
    ? new Date(parsed + durationS * 1_000).toISOString()
    : 'bad';
  return {
    id: nextId++,
    vehicleId: 1,
    startTs,
    endTs: defaultEnd,
    durationS,
    distanceM,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: whPerM * distanceM,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: 'completed',
    createdAt: startTs,
    updatedAt: startTs,
    ...overrides,
  };
}

function monthlyHistory(count = 36): Drive[] {
  return Array.from({ length: count }, (_, index) => {
    const timestamp = Date.UTC(
      2024 + Math.floor(index / 12),
      index % 12,
      15,
      12,
    );
    const date = new Date(timestamp);
    const day = Math.floor(
      (timestamp - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000,
    ) + 1;
    const phase = (2 * Math.PI * (day - 1)) / 365.2425;
    const years = (timestamp - Date.UTC(2025, 5, 15, 12)) / (365.2425 * 86_400_000);
    const whPerM =
      0.18
      + 0.028 * Math.sin(phase)
      - 0.012 * Math.cos(2 * phase)
      + 0.005 * years;
    return drive(date.toISOString(), whPerM, 5_000 + (index % 4) * 5_000);
  });
}

describe('analyzeSeasonalEfficiency', () => {
  it('reconciles every returned row into one mutually exclusive category', () => {
    const rows = [
      drive('2026-01-01T00:00:00Z', 0.18),
      drive('2026-01-02T00:00:00Z', 0.18, 10_000, { endTs: null }),
      drive('bad', 0.18),
      drive('2027-01-01T00:00:00Z', 0.18),
      drive('2026-01-03T00:00:00Z', 0.18, 10_000, {
        durationS: 0,
        endTs: '2026-01-03T00:30:00Z',
      }),
      drive('2026-01-04T00:00:00Z', 0.18, 999),
      drive('2026-01-05T00:00:00Z', 0.18, 10_000, { energyUsedWh: null }),
      drive('2026-01-06T00:00:00Z', 0.18, 10_000, { energyUsedWh: 0 }),
      drive('2026-01-07T00:00:00Z', 0.18, 10_000, { energyUsedWh: 1 }),
    ];
    const result = analyzeSeasonalEfficiency(rows, NOW, 'UTC');
    expect(result.accounting.counts).toMatchObject({
      included: 1,
      incompleteLive: 1,
      invalidTimestampOrder: 1,
      future: 1,
      invalidDuration: 1,
      invalidDistance: 1,
      missingEnergy: 1,
      invalidEnergy: 1,
      implausibleIntensity: 1,
    });
    const counts = Object.values(result.accounting.counts);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(rows.length);
    expect(result.accounting.returnedRows).toBe(
      result.accounting.includedRows + result.accounting.excludedRows,
    );
  });

  it('classifies a live flag before malformed timestamp details', () => {
    const result = analyzeSeasonalEfficiency([
      drive('not-a-date', 0.18, 10_000, { live: true, endTs: null }),
    ], NOW, 'UTC');
    expect(result.accounting.counts.incompleteLive).toBe(1);
    expect(result.accounting.counts.invalidTimestampOrder).toBe(0);
  });

  it('rejects reversed timestamps as invalid order', () => {
    const result = analyzeSeasonalEfficiency([
      drive('2026-01-02T00:00:00Z', 0.18, 10_000, {
        endTs: '2026-01-01T23:00:00Z',
      }),
    ], NOW, 'UTC');
    expect(result.accounting.counts.invalidTimestampOrder).toBe(1);
  });

  it('rejects a future end even when the start is historical', () => {
    const result = analyzeSeasonalEfficiency([
      drive('2026-12-31T23:50:00Z', 0.18, 10_000, {
        endTs: '2027-01-01T00:20:00Z',
      }),
    ], NOW, 'UTC');
    expect(result.accounting.counts.future).toBe(1);
  });

  it('keeps canonical intensity in Wh/m and uses distance weighting', () => {
    const result = analyzeSeasonalEfficiency([
      drive('2026-01-01T00:00:00Z', 0.1, 1_000),
      drive('2026-02-01T00:00:00Z', 0.2, 3_000),
    ], NOW, 'UTC');
    expect(result.observations[0]?.actualEnergyIntensityWhPerM).toBe(0.1);
    expect(result.actualEnergyIntensityWhPerM).toBeCloseTo(0.175, 8);
    expect(result.totalEnergyWh).toBe(700);
  });

  it('does not mutate input order or row objects', () => {
    const rows = [
      drive('2026-03-01T00:00:00Z', 0.18),
      drive('2026-01-01T00:00:00Z', 0.18),
    ];
    const before = JSON.stringify(rows);
    const result = analyzeSeasonalEfficiency(rows, NOW, 'UTC');
    expect(JSON.stringify(rows)).toBe(before);
    expect(result.observations.map((row) => row.localDate)).toEqual([
      '2026-01-01',
      '2026-03-01',
    ]);
  });

  it('derives local date, month, year, and annual phase in vehicle timezone', () => {
    const result = analyzeSeasonalEfficiency([
      drive('2025-01-01T00:30:00Z', 0.18),
    ], NOW, 'America/Los_Angeles');
    const row = result.observations[0]!;
    expect(row.localDate).toBe('2024-12-31');
    expect(row.localYear).toBe(2024);
    expect(row.localMonth).toBe(12);
    expect(row.dayOfYear).toBe(366);
  });

  it('is DST-safe when two UTC instants share one local calendar date', () => {
    const result = analyzeSeasonalEfficiency([
      drive('2025-03-09T09:30:00Z', 0.18),
      drive('2025-03-09T10:30:00Z', 0.18),
    ], NOW, 'America/Los_Angeles');
    expect(result.observations.map((row) => row.localDate)).toEqual([
      '2025-03-09',
      '2025-03-09',
    ]);
    expect(result.activeLocalDays).toBe(1);
  });

  it('normalizes invalid timezones to UTC', () => {
    expect(normalizeSeasonalTimezone('not/a-timezone')).toBe('UTC');
    const result = analyzeSeasonalEfficiency([
      drive('2026-01-01T00:30:00Z', 0.18),
    ], NOW, 'not/a-timezone');
    expect(result.timeZone).toBe('UTC');
    expect(result.observations[0]?.localDate).toBe('2026-01-01');
  });

  it('reports the default sample gate separately', () => {
    const rows = Array.from({ length: 23 }, (_, index) =>
      drive(new Date(Date.UTC(2025, index % 12, 1)).toISOString(), 0.18));
    const result = analyzeSeasonalEfficiency(rows, NOW, 'UTC');
    expect(result.fit.status).toBe('insufficient samples');
    expect(result.fit.sampleToParameterRatio).toBeCloseTo(23 / 6, 8);
  });

  it('reports the span gate independently when sample and month gates pass', () => {
    const rows = Array.from({ length: 24 }, (_, index) => {
      const month = index % 9;
      return drive(new Date(Date.UTC(2026, month, 1 + Math.floor(index / 9) * 3)).toISOString(), 0.18);
    });
    const result = analyzeSeasonalEfficiency(rows, NOW, 'UTC');
    expect(result.localMonthCoverage).toBe(9);
    expect(result.fit.status).toBe('insufficient span');
  });

  it('reports the calendar-month gate independently', () => {
    const rows = Array.from({ length: 24 }, (_, index) =>
      drive(new Date(Date.UTC(2025, index < 12 ? 0 : 11, 1 + (index % 12))).toISOString(), 0.18));
    const result = analyzeSeasonalEfficiency(rows, NOW, 'UTC', {
      minSpanDays: 300,
    });
    expect(result.spanDays).toBeGreaterThan(300);
    expect(result.localMonthCoverage).toBeLessThan(9);
    expect(result.fit.status).toBe('insufficient month coverage');
  });

  it('never lets lower gate overrides weaken the hard evidence floors', () => {
    const lowerOptions = {
      minSamples: 1,
      minSpanDays: 0,
      minCalendarMonths: 1,
    };
    const tooFew = analyzeSeasonalEfficiency(monthlyHistory(23), NOW, 'UTC', lowerOptions);
    expect(tooFew.fit.status).toBe('insufficient samples');

    const tooShort = analyzeSeasonalEfficiency(
      Array.from({ length: 24 }, (_, index) =>
        drive(new Date(Date.UTC(2026, 0, 1 + index)).toISOString(), 0.18)),
      NOW,
      'UTC',
      lowerOptions,
    );
    expect(tooShort.fit.status).toBe('insufficient span');

    const tooFewMonths = analyzeSeasonalEfficiency(
      Array.from({ length: 24 }, (_, index) =>
        drive(new Date(Date.UTC(2025 + (index % 2), 0, 1 + index)).toISOString(), 0.18)),
      NOW,
      'UTC',
      lowerOptions,
    );
    expect(tooFewMonths.spanDays).toBeGreaterThan(300);
    expect(tooFewMonths.localMonthCoverage).toBe(1);
    expect(tooFewMonths.fit.status).toBe('insufficient month coverage');
  });

  it('fits annual, semiannual, and trend components with canonical coefficients', () => {
    const result = analyzeSeasonalEfficiency(monthlyHistory(), NOW, 'UTC', {
      ridgeLambda: 1e-10,
    });
    expect(result.fit.status).toBe('ready');
    expect(result.coefficients).toHaveLength(6);
    expect(result.diagnostics.annualComponentAmplitudeWhPerM).toBeGreaterThan(0.02);
    expect(result.diagnostics.semiannualComponentAmplitudeWhPerM).toBeGreaterThan(0.005);
    expect(result.trendWhPerMPerYear).toBeCloseTo(0.005, 2);
    expect(result.curve).toHaveLength(365);
  });

  it('fits constant observations but leaves in-sample R² null', () => {
    const result = analyzeSeasonalEfficiency(monthlyHistory().map((row) => ({
      ...row,
      energyUsedWh: 0.18 * row.distanceM,
    })), NOW, 'UTC', { ridgeLambda: 1 });
    expect(result.fit.status).toBe('ready');
    expect(result.rSquaredInSample).toBeNull();
    expect(result.trendWhPerMPerYear).toBeCloseTo(0, 4);
  });

  it('returns weighted residual quantiles and a bounded histogram', () => {
    const rows = monthlyHistory().map((row, index) => ({
      ...row,
      energyUsedWh: (0.18 + (index % 5) * 0.003) * row.distanceM,
    }));
    const result = analyzeSeasonalEfficiency(rows, NOW, 'UTC');
    expect(result.diagnostics.residualP10WhPerM).not.toBeNull();
    expect(result.diagnostics.residualP50WhPerM).not.toBeNull();
    expect(result.diagnostics.residualP90WhPerM).not.toBeNull();
    expect(result.residualHistogram).toHaveLength(9);
    const distanceShares = result.residualHistogram.map(
      (bin) => (100 * bin.distanceM) / result.totalDistanceM,
    );
    expect(distanceShares.every((share) => Number.isFinite(share))).toBe(true);
    expect(distanceShares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(100, 8);
    expect(result.residualBand!.lowerWhPerM).toBeLessThanOrEqual(
      result.residualBand!.upperWhPerM,
    );
  });

  it('returns twelve month profiles and local year summaries', () => {
    const result = analyzeSeasonalEfficiency(monthlyHistory(), NOW, 'UTC');
    expect(result.months).toHaveLength(12);
    expect(result.months.every((month) => month.sampleCount > 0)).toBe(true);
    expect(result.years.map((year) => year.year)).toEqual([2024, 2025, 2026]);
    expect(result.years[1]?.changeFromPreviousWhPerM).not.toBeNull();
  });

  it('bounds chart timeline output without changing accounting', () => {
    const result = analyzeSeasonalEfficiency(monthlyHistory(), NOW, 'UTC', {
      maxTimelinePoints: 10,
    });
    expect(result.timeline).toHaveLength(10);
    expect(result.timeline[0]?.driveId).toBe(result.observations[0]?.driveId);
    expect(result.timeline.at(-1)?.driveId).toBe(result.observations.at(-1)?.driveId);
    expect(result.observations).toHaveLength(36);
  });

  it('clamps hostile timeline sizes to the documented two-point minimum', () => {
    const result = analyzeSeasonalEfficiency(monthlyHistory(), NOW, 'UTC', {
      maxTimelinePoints: 1,
    });
    expect(result.timeline).toHaveLength(2);
    expect(result.timeline[0]?.driveId).toBe(result.observations[0]?.driveId);
    expect(result.timeline.at(-1)?.driveId).toBe(result.observations.at(-1)?.driveId);
  });

  it('reports the 1,000-row cap and recency from injected nowMs', () => {
    const rows = Array.from({ length: 1_000 }, () =>
      drive('2026-12-30T00:00:00Z', 0.18));
    const result = analyzeSeasonalEfficiency(rows, NOW, 'UTC');
    expect(result.accounting.historyLimit).toBe(1_000);
    expect(result.accounting.historyCapReached).toBe(true);
    expect(result.daysSinceLatestIncluded).toBeCloseTo(2, 1);
  });

  it('calculates a separate support band from fit magnitude', () => {
    const result = analyzeSeasonalEfficiency(monthlyHistory(), NOW, 'UTC');
    expect(result.support.index).toBeGreaterThanOrEqual(0);
    expect(result.support.index).toBeLessThanOrEqual(100);
    expect(['thin', 'moderate', 'strong']).toContain(result.support.band);
    expect(result.diagnostics.trendSupport.supportBand).toBe(result.support.band);
  });

  it('handles hostile options and non-finite input without throwing', () => {
    const result = analyzeSeasonalEfficiency([
      drive('2026-01-01T00:00:00Z', 0.18, Number.NaN),
      drive('2026-01-02T00:00:00Z', 0.18, 10_000, { energyUsedWh: Number.POSITIVE_INFINITY }),
    ], Number.NaN, '', {
      minSamples: Number.NaN,
      minSpanDays: Number.POSITIVE_INFINITY,
      minCalendarMonths: -5,
      ridgeLambda: Number.NaN,
      maxTimelinePoints: Number.POSITIVE_INFINITY,
    });
    expect(result.accounting.excludedRows).toBe(2);
    expect(result.timeZone).toBe('UTC');
    expect(result.fit.status).toBe('insufficient samples');
  });

  it('handles a singular normal matrix with an explicit controlled gate', () => {
    const rows = Array.from({ length: 24 }, (_, index) =>
      drive(
        new Date(Date.UTC(2024 + Math.floor(index / 9), index % 9, 15)).toISOString(),
        0.18,
        index === 0 ? 1e20 : 1_000,
      ));
    const result = analyzeSeasonalEfficiency(rows, NOW, 'UTC', {
      minSamples: 24,
      minSpanDays: 300,
      minCalendarMonths: 9,
      ridgeLambda: 0,
    });
    expect(result.fit.status).toBe('singular');
    expect(result.coefficients).toBeNull();
    expect(result.curve).toEqual([]);
  });

  it('rejects finite extreme metrics before they can overflow aggregates', () => {
    const result = analyzeSeasonalEfficiency(
      Array.from({ length: 24 }, (_, index) =>
        drive(
          new Date(Date.UTC(2024 + Math.floor(index / 12), index % 12, 15)).toISOString(),
          0.18,
          Number.MAX_VALUE,
          { energyUsedWh: Number.MAX_VALUE * 0.18 },
        )),
      NOW,
      'UTC',
    );
    expect(result.accounting.counts.invalidDistance).toBe(24);
    expect(result.includedCount).toBe(0);
    expect(result.fit.status).toBe('insufficient samples');
    expect(result.fit.status).not.toBe('ready');
    expect(Number.isFinite(result.totalDistanceM)).toBe(true);
    expect(Number.isFinite(result.totalEnergyWh)).toBe(true);
  });
});
