import { describe, expect, it } from 'vitest';
import type { ScoredDrive } from './scoreDomain';
import { computePeriodStats } from './scorePeriodStats';

function scored(startTs: string, total: number, grade = 'A'): ScoredDrive {
  return {
    drive: {
      id: 1, vehicleId: 1, startTs, endTs: null, durationS: 60,
      distanceM: 1000, startAddress: null, endAddress: null,
      startLat: null, startLon: null, endLat: null, endLon: null,
      startBatteryPct: null, endBatteryPct: null, energyUsedWh: null,
      regenEnergyWh: null, avgSpeedMps: null, maxSpeedMps: null,
      avgPowerW: null, outsideTempAvgC: null, insideTempAvgC: null,
      score: null, endedStatus: null, createdAt: startTs, updatedAt: startTs,
    },
    score: { total, grade, efficiency: 30, smoothness: 20, speed: 20, whPerKm: 150 },
  };
}

describe('computePeriodStats calendar ranges', () => {
  it('preserves every output and separate month/week buckets', () => {
    expect(computePeriodStats([
      scored('2024-06-16T12:00:00Z', 90, 'A+'),
      scored('2024-07-14T12:00:00Z', 70, 'B'),
    ], new Date('2024-07-15T12:00:00Z'), { tz: 'UTC' })).toEqual({
      thisWeekAvg: 70, lastWeekAvg: null, thisMonthAvg: 70, lastMonthAvg: 90,
      bestWeek: { avg: 90, label: '2024-06-W4' },
      bestMonth: { avg: 90, label: '2024-06' },
      totalDrives: 2, aOrBetter: 1,
    });
  });

  it('includes the entire first Sunday and excludes next Sunday at midnight', () => {
    const stats = computePeriodStats([
      scored('2026-03-08T07:59:59.999Z', 20),
      scored('2026-03-08T08:00:00Z', 80),
      scored('2026-03-15T06:59:59.999Z', 100),
      scored('2026-03-15T07:00:00Z', 10),
    ], new Date('2026-03-11T20:00:00Z'), {
      locale: 'de-DE', tz: 'America/Los_Angeles',
    });
    expect(stats).toMatchObject({ thisWeekAvg: 90, lastWeekAvg: 20 });
  });

  it('includes the last day of the prior month and uses exclusive next-month bounds', () => {
    const stats = computePeriodStats([
      scored('2025-12-31T15:00:00Z', 40),
      scored('2026-01-31T14:59:59.999Z', 60),
      scored('2026-01-31T15:00:00Z', 80),
      scored('2026-02-28T14:59:59.999Z', 100),
      scored('2026-02-28T15:00:00Z', 10),
    ], new Date('2026-02-10T12:00:00Z'), {
      locale: 'ar-SA', tz: 'Asia/Tokyo',
    });
    expect(stats).toMatchObject({
      thisMonthAvg: 90, lastMonthAvg: 50,
      bestMonth: { avg: 90, label: '2026-02' },
    });
  });

  it('derives now and bucket labels in the saved timezone, independent of locale', () => {
    const drives = [scored('2026-03-01T00:30:00Z', 90)];
    const now = new Date('2026-03-01T01:00:00Z');
    const options = { locale: 'th-TH-u-ca-buddhist', tz: 'America/Los_Angeles' };
    expect(computePeriodStats(drives, now, options)).toMatchObject({
      thisWeekAvg: 90, thisMonthAvg: 90,
      bestWeek: { avg: 90, label: '2026-02-W4' },
      bestMonth: { avg: 90, label: '2026-02' },
    });
    expect(computePeriodStats(drives, now, { ...options, locale: 'en-US' }))
      .toEqual(computePeriodStats(drives, now, options));
  });

  it('handles the DST fall-back day without shifting Sunday boundaries', () => {
    expect(computePeriodStats([
      scored('2026-11-01T03:59:59.999Z', 20),
      scored('2026-11-01T04:00:00Z', 90),
      scored('2026-11-01T06:30:00Z', 70),
    ], new Date('2026-11-02T12:00:00Z'), { tz: 'America/New_York' }))
      .toMatchObject({ thisWeekAvg: 80, lastWeekAvg: 20 });
  });

  it('keeps undated drive counts without producing invalid calendar buckets', () => {
    const drives = ['invalid', '', null, undefined].map((timestamp) => {
      const drive = scored('', 100, 'A+');
      Object.defineProperty(drive.drive, 'startTs', { value: timestamp });
      return drive;
    });
    expect(computePeriodStats(drives, new Date('2026-03-11T12:00:00Z'))).toEqual({
      thisWeekAvg: null, lastWeekAvg: null, thisMonthAvg: null, lastMonthAvg: null,
      bestWeek: { avg: null, label: '—' }, bestMonth: { avg: null, label: '—' },
      totalDrives: 4, aOrBetter: 4,
    });
  });

  it('keeps best-period and grade outputs when now is invalid', () => {
    expect(computePeriodStats([scored('2026-03-01T12:00:00Z', 80)],
      new Date('invalid'), { tz: 'UTC' })).toMatchObject({
      thisWeekAvg: null, lastWeekAvg: null, thisMonthAvg: null, lastMonthAvg: null,
      bestMonth: { avg: 80, label: '2026-03' }, totalDrives: 1, aOrBetter: 1,
    });
  });

  it('preserves empty, zero-score and browser-calendar behavior', () => {
    expect(computePeriodStats([], new Date())).toBeNull();
    const now = new Date(2026, 2, 11, 12);
    expect(computePeriodStats([scored(new Date(2026, 2, 8).toISOString(), 0, 'F')], now))
      .toMatchObject({
        thisWeekAvg: 0, thisMonthAvg: 0, totalDrives: 1, aOrBetter: 0,
        bestWeek: { avg: 0, label: '2026-03-W2' }, bestMonth: { avg: 0, label: '2026-03' },
      });

  });
});

describe('computePeriodStats best bucket regression', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const opts = { tz: 'UTC' };
  const october = '2026-10-12T12:00:00Z';
  const september = '2026-09-01T12:00:00Z';

  it.each([NaN, Infinity, -Infinity])('excludes invalid totals (%s), not measured zero', (total) => {
    const invalid = scored(october, total);
    expect(computePeriodStats([invalid], now, opts)).toMatchObject({
thisWeekAvg: null, thisMonthAvg: null,
bestWeek: { avg: null, label: '—' }, bestMonth: { avg: null, label: '—' },
    });
    expect(computePeriodStats([invalid, scored(october, 0)], now, opts)).toMatchObject({
thisWeekAvg: 0, thisMonthAvg: 0,
bestWeek: { avg: 0, label: '2026-10-W3' },
bestMonth: { avg: 0, label: '2026-10' },
    });
  });

  it.each([null, undefined])('excludes missing runtime totals (%s)', (total) => {
    const invalid = scored(october, 0);
    // Exercise malformed wire data without widening the production score type.
    Object.assign(invalid.score, { total });
    expect(computePeriodStats([invalid], now, opts)?.bestMonth.avg).toBeNull();
    expect(computePeriodStats([invalid, scored(october, 8)], now, opts)?.bestMonth.avg).toBe(8);
  });

  it.each([0, -7, 7, -2.6, 2.6])('retains the real bucket for signed/fractional total %s', (total) => {
    expect(computePeriodStats([scored(october, total)], now, opts)).toMatchObject({
thisWeekAvg: Math.round(total), thisMonthAvg: Math.round(total),
bestWeek: { avg: Math.round(total), label: '2026-10-W3' },
bestMonth: { avg: Math.round(total), label: '2026-10' },
    });
  });

  it('selects the greatest real negative bucket rather than the zero sentinel', () => {
    expect(computePeriodStats([
scored(september, -9), scored(october, -3),
    ], now, opts)).toMatchObject({
bestWeek: { avg: -3, label: '2026-10-W3' },
bestMonth: { avg: -3, label: '2026-10' },
    });
  });

  it('averages fractional measurements before existing integer rounding', () => {
    expect(computePeriodStats([scored(october, 0.2), scored(october, 0.6)], now, opts))
.toMatchObject({
  thisWeekAvg: 0, bestWeek: { avg: 0, label: '2026-10-W3' },
  bestMonth: { avg: 0, label: '2026-10' },
});
  });

  it.each([0, -4, 12.2])('keeps first-seen bucket identity for ties (%s)', (total) => {
    const first = scored(october, total);
    const second = scored(september, total);
    const stats = computePeriodStats([first, second], now, opts);
    expect(stats?.bestWeek).toEqual({ avg: Math.round(total), label: '2026-10-W3' });
    expect(stats?.bestMonth).toEqual({ avg: Math.round(total), label: '2026-10' });
    expect(computePeriodStats([first, second], now, opts)).toEqual(stats);
    expect(computePeriodStats([second, first], now, opts)?.bestMonth.label).toBe('2026-09');
  });
});
