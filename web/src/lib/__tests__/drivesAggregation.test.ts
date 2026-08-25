import { describe, it, expect } from 'vitest';
import {
  getEfficiency,
  gradeFromEfficiency,
  gradeFromNumeric,
  avgGrade,
  computePeriodStats,
  priorPeriod,
  shiftDayKey,
  detectAnomalies,
  detectNotable,
  detectCommutes,
  groupByDate,
  dailyTrend,
  localDayKey,
  parseLocalDay,
} from '../drivesAggregation';
import type { Drive } from '@/types/driving';

function makeDrive(overrides: Partial<Drive> = {}): Drive {
  const base: Drive = {
    id: 1,
    vehicleId: 1,
    startTs: '2026-05-10T10:00:00.000Z',
    endTs: '2026-05-10T10:30:00.000Z',
    durationS: 1800,
    distanceM: 16_000, // 16 km
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 76,
    energyUsedWh: 3_000, // 187.5 Wh/km
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '2026-05-10T10:00:00.000Z',
    updatedAt: '2026-05-10T10:30:00.000Z',
  };
  return { ...base, ...overrides };
}

describe('getEfficiency', () => {
  it('returns measured Wh/km from canonical energy and distance', () => {
    const eff = getEfficiency(makeDrive());
    expect(eff).toBeCloseTo(187.5, 1);
  });

  it('does not require battery percentage evidence', () => {
    expect(
      getEfficiency(makeDrive({ startBatteryPct: null, endBatteryPct: null })),
    ).toBeCloseTo(187.5, 1);
  });

  it('returns null when measured energy is missing or non-positive', () => {
    expect(getEfficiency(makeDrive({ energyUsedWh: null }))).toBeNull();
    expect(getEfficiency(makeDrive({ energyUsedWh: 0 }))).toBeNull();
  });

  it('returns null for drives shorter than the 1 km quality floor', () => {
    expect(getEfficiency(makeDrive({ distanceM: 999 }))).toBeNull();
  });
});

describe('gradeFromEfficiency', () => {
  it('grades A+ for efficiency below 130', () => {
    expect(gradeFromEfficiency(120).label).toBe('A+');
  });
  it('grades A for [130, 160)', () => {
    expect(gradeFromEfficiency(150).label).toBe('A');
  });
  it('grades B for [160, 190)', () => {
    expect(gradeFromEfficiency(180).label).toBe('B');
  });
  it('grades C for [190, 220)', () => {
    expect(gradeFromEfficiency(210).label).toBe('C');
  });
  it('grades D for >= 220', () => {
    expect(gradeFromEfficiency(361).label).toBe('D');
  });
  it('returns — for null', () => {
    expect(gradeFromEfficiency(null).label).toBe('—');
    expect(gradeFromEfficiency(null).numeric).toBeNull();
  });
});

describe('gradeFromNumeric', () => {
  it('round-trips A+', () => {
    expect(gradeFromNumeric(4.5).label).toBe('A+');
  });
  it('rounds 3.6 → A', () => {
    expect(gradeFromNumeric(3.6).label).toBe('A');
  });
  it('rounds 2.7 → B', () => {
    expect(gradeFromNumeric(2.7).label).toBe('B');
  });
  it('returns — for null', () => {
    expect(gradeFromNumeric(null).label).toBe('—');
  });
});

describe('avgGrade', () => {
  it('grades the distance-weighted measured intensity', () => {
    const drives = [
      makeDrive({ id: 1, energyUsedWh: 4_000 }), // 250 Wh/km → D
      makeDrive({ id: 2, energyUsedWh: 1_600 }), // 100 Wh/km → A+
    ];
    expect(avgGrade(drives).label).toBe('B');
  });

  it('returns — for empty list', () => {
    expect(avgGrade([]).label).toBe('—');
  });

  it('skips ungraded drives', () => {
    const drives = [
      makeDrive({ id: 1, energyUsedWh: null }),
      makeDrive({ id: 2, energyUsedWh: 1_600 }), // A+
    ];
    expect(avgGrade(drives).label).toBe('A+');
  });
});

describe('computePeriodStats', () => {
  it('aggregates count, distance, duration', () => {
    const drives = [
      makeDrive({ id: 1, distanceM: 1000, durationS: 60 }),
      makeDrive({ id: 2, distanceM: 2000, durationS: 120 }),
    ];
    const stats = computePeriodStats(drives);
    expect(stats.count).toBe(2);
    expect(stats.totalDistanceM).toBe(3000);
    expect(stats.totalDurationS).toBe(180);
  });

  it('reports best (lowest) efficiency', () => {
    const drives = [
      makeDrive({ id: 1, energyUsedWh: 4_000 }),
      makeDrive({ id: 2, energyUsedWh: 1_500 }), // 93.75
    ];
    const stats = computePeriodStats(drives);
    expect(stats.bestEfficiencyWhKm).toBeCloseTo(93.75, 1);
  });

  it('finds top speed across the window', () => {
    const drives = [
      makeDrive({ id: 1, maxSpeedMps: 30 }),
      makeDrive({ id: 2, maxSpeedMps: 50 }),
      makeDrive({ id: 3, maxSpeedMps: 40 }),
    ];
    expect(computePeriodStats(drives).topSpeedMps).toBe(50);
  });

  it('identifies the longest drive', () => {
    const drives = [
      makeDrive({ id: 1, distanceM: 1000 }),
      makeDrive({ id: 2, distanceM: 5000 }),
      makeDrive({ id: 3, distanceM: 3000 }),
    ];
    expect(computePeriodStats(drives).longest?.id).toBe(2);
  });

  it('sums measured energy in canonical watt-hours', () => {
    const drives = [
      makeDrive({ id: 1, energyUsedWh: 3_000 }),
      makeDrive({ id: 2, energyUsedWh: 1_500 }),
    ];
    expect(computePeriodStats(drives).totalEnergyWh).toBe(4_500);
  });

  it('weights average efficiency by measured distance and reports coverage', () => {
    const stats = computePeriodStats([
      makeDrive({ id: 1, distanceM: 10_000, energyUsedWh: 1_000 }), // 100 Wh/km
      makeDrive({ id: 2, distanceM: 30_000, energyUsedWh: 6_000 }), // 200 Wh/km
      makeDrive({ id: 3, distanceM: 15_000, energyUsedWh: null }),
    ]);

    expect(stats.avgEfficiencyWhKm).toBe(175);
    expect(stats.energyMeasuredCount).toBe(2);
    expect(stats.efficiencyMeasuredCount).toBe(2);
  });

  it('honours date range', () => {
    const drives = [
      makeDrive({ id: 1, startTs: '2026-05-01T00:00:00Z' }),
      makeDrive({ id: 2, startTs: '2026-05-15T00:00:00Z' }),
      makeDrive({ id: 3, startTs: '2026-06-01T00:00:00Z' }),
    ];
    expect(computePeriodStats(drives, '2026-05-01', '2026-05-31').count).toBe(2);
  });

  it('returns null avgEfficiency on empty/ungradable input', () => {
    expect(computePeriodStats([]).avgEfficiencyWhKm).toBeNull();
  });
});

describe('priorPeriod', () => {
  it('returns the equivalent-length window directly before', () => {
    const result = priorPeriod('2026-05-01', '2026-05-30');
    expect(result).toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  it('handles single-day windows', () => {
    const result = priorPeriod('2026-05-12', '2026-05-12');
    expect(result).toEqual({ start: '2026-05-11', end: '2026-05-11' });
  });

  it('returns null for malformed input', () => {
    expect(priorPeriod(undefined, '2026-05-12')).toBeNull();
    expect(priorPeriod('not-a-date', '2026-05-12')).toBeNull();
  });
});

describe('shiftDayKey', () => {
  it('shifts forwards and backwards across month boundaries', () => {
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDayKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles leap days', () => {
    expect(shiftDayKey('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('returns the same day for a zero shift', () => {
    expect(shiftDayKey('2026-05-12', 0)).toBe('2026-05-12');
  });

  it('returns null for malformed or missing input', () => {
    expect(shiftDayKey(undefined, 1)).toBeNull();
    expect(shiftDayKey('not-a-date', 1)).toBeNull();
  });
});

describe('detectAnomalies', () => {
  it('finds drives with grade D', () => {
    const drives = [
      makeDrive({ id: 1, energyUsedWh: 1_600 }), // A+
      makeDrive({ id: 2, energyUsedWh: 4_000 }), // D
    ];
    const out = detectAnomalies(drives);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(2);
  });
});

describe('detectNotable', () => {
  it('returns top-10% by distance', () => {
    const drives = Array.from({ length: 20 }, (_, i) =>
      makeDrive({ id: i + 1, distanceM: (i + 1) * 1000 }),
    );
    const out = detectNotable(drives);
    expect(out.length).toBeGreaterThanOrEqual(2);
    // Top 10% of 20 = top 2; longest distances
    expect(out.map((d) => d.id)).toContain(20);
    expect(out.map((d) => d.id)).toContain(19);
  });

  it('also includes A+ drives outside the top decile', () => {
    const drives = [
      makeDrive({ id: 1, distanceM: 1_000, energyUsedWh: 100 }), // A+
      makeDrive({ id: 2, distanceM: 2_000, energyUsedWh: null }),
      makeDrive({ id: 3, distanceM: 3_000, energyUsedWh: null }),
    ];
    expect(detectNotable(drives).map((d) => d.id)).toContain(1);
  });

  it('returns empty for empty input', () => {
    expect(detectNotable([])).toEqual([]);
  });
});

describe('detectCommutes', () => {
  it('flags address pairs that recur >= minOccurrences times', () => {
    const drives = [
      makeDrive({ id: 1, startAddress: 'Home', endAddress: 'Office' }),
      makeDrive({ id: 2, startAddress: 'Office', endAddress: 'Home' }),
      makeDrive({ id: 3, startAddress: 'Home', endAddress: 'Office' }),
      makeDrive({ id: 4, startAddress: 'Park', endAddress: 'Beach' }),
    ];
    const out = detectCommutes(drives, 3);
    expect(out.map((d) => d.id).sort()).toEqual([1, 2, 3]);
  });

  it('treats direction as insensitive', () => {
    const drives = [
      makeDrive({ id: 1, startAddress: 'A', endAddress: 'B' }),
      makeDrive({ id: 2, startAddress: 'B', endAddress: 'A' }),
      makeDrive({ id: 3, startAddress: 'A', endAddress: 'B' }),
    ];
    expect(detectCommutes(drives, 3)).toHaveLength(3);
  });

  it('skips drives without addresses', () => {
    const drives = [
      makeDrive({ id: 1, startAddress: null, endAddress: 'X' }),
      makeDrive({ id: 2, startAddress: 'A', endAddress: null }),
    ];
    expect(detectCommutes(drives, 1)).toEqual([]);
  });
});

describe('groupByDate', () => {
  it('buckets items by day in descending date order', () => {
    const items = [
      { id: 1, ts: '2026-05-10T10:00Z' },
      { id: 2, ts: '2026-05-09T10:00Z' },
      { id: 3, ts: '2026-05-10T15:00Z' },
    ];
    const groups = groupByDate(items, (i) => i.ts);
    expect(groups).toHaveLength(2);
    expect(groups[0].dateKey).toBe('2026-05-10');
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].dateKey).toBe('2026-05-09');
  });

  it('skips items with no key', () => {
    const items = [{ id: 1, ts: null as string | null }];
    expect(groupByDate(items, (i) => i.ts)).toHaveLength(0);
  });
});

describe('dailyTrend', () => {
  it('counts drives per day', () => {
    const drives = [
      makeDrive({ id: 1, startTs: '2026-05-10T10:00Z' }),
      makeDrive({ id: 2, startTs: '2026-05-10T15:00Z' }),
      makeDrive({ id: 3, startTs: '2026-05-11T10:00Z' }),
    ];
    const trend = dailyTrend(drives, 'drives');
    expect(trend).toEqual([
      { date: '2026-05-10', value: 2 },
      { date: '2026-05-11', value: 1 },
    ]);
  });

  it('sums distance per day', () => {
    const drives = [
      makeDrive({ id: 1, startTs: '2026-05-10T10:00Z', distanceM: 1000 }),
      makeDrive({ id: 2, startTs: '2026-05-10T15:00Z', distanceM: 2000 }),
    ];
    const trend = dailyTrend(drives, 'distance');
    expect(trend[0]).toEqual({ date: '2026-05-10', value: 3000 });
  });

  it('weights efficiency by measured distance per day', () => {
    const drives = [
      makeDrive({
        id: 1,
        startTs: '2026-05-10T10:00Z',
        distanceM: 10_000,
        energyUsedWh: 1_000,
      }),
      makeDrive({
        id: 2,
        startTs: '2026-05-10T11:00Z',
        distanceM: 30_000,
        energyUsedWh: 6_000,
      }),
    ];
    const trend = dailyTrend(drives, 'efficiency');
    expect(trend[0].value).toBe(175);
  });

  it('sums canonical watt-hours for cost conversion at the page boundary', () => {
    const drives = [
      makeDrive({ id: 1, startTs: '2026-05-10T10:00Z', energyUsedWh: 3_000 }),
    ];
    const trend = dailyTrend(drives, 'cost');
    expect(trend[0].value).toBe(3_000);
  });

  it('omits days without measured efficiency instead of emitting zero', () => {
    const drives = [
      makeDrive({
        id: 1,
        startTs: '2026-05-10T10:00Z',
        energyUsedWh: null,
      }),
      makeDrive({
        id: 2,
        startTs: '2026-05-11T10:00Z',
        energyUsedWh: 3_000,
      }),
    ];

    expect(dailyTrend(drives, 'efficiency')).toEqual([
      { date: '2026-05-11', value: 187.5 },
    ]);
  });

  it('emits points sorted ascending by date', () => {
    const drives = [
      makeDrive({ id: 1, startTs: '2026-05-12T10:00Z' }),
      makeDrive({ id: 2, startTs: '2026-05-09T10:00Z' }),
      makeDrive({ id: 3, startTs: '2026-05-10T10:00Z' }),
    ];
    const dates = dailyTrend(drives, 'drives').map((p) => p.date);
    expect(dates).toEqual(['2026-05-09', '2026-05-10', '2026-05-12']);
  });
});

describe('localDayKey', () => {
  it('returns null for nullish or empty input', () => {
    expect(localDayKey(null)).toBeNull();
    expect(localDayKey(undefined)).toBeNull();
    expect(localDayKey('')).toBeNull();
  });

  it('returns null for invalid timestamps', () => {
    expect(localDayKey('not-a-date')).toBeNull();
  });

  it('formats a YYYY-MM-DD key in the local timezone', () => {
    // Use a local-time constructor so this assertion is timezone-invariant.
    const localNoon = new Date(2026, 4 - 1, 24, 12, 0, 0, 0).toISOString();
    expect(localDayKey(localNoon)).toBe('2026-04-24');
  });

  it('agrees with the local-time calendar date even at the day boundary', () => {
    // 11:30 PM local on Apr 23 should report as 2026-04-23 even if UTC has rolled to Apr 24.
    const lateNight = new Date(2026, 4 - 1, 23, 23, 30, 0, 0).toISOString();
    expect(localDayKey(lateNight)).toBe('2026-04-23');
    // 12:30 AM local on Apr 24 should report as 2026-04-24 even if UTC is still Apr 23.
    const earlyMorning = new Date(2026, 4 - 1, 24, 0, 30, 0, 0).toISOString();
    expect(localDayKey(earlyMorning)).toBe('2026-04-24');
  });

  it('zero-pads single-digit months and days', () => {
    const iso = new Date(2026, 1 - 1, 5, 12, 0, 0, 0).toISOString();
    expect(localDayKey(iso)).toBe('2026-01-05');
  });

  it('respects an explicit IANA timezone override', () => {
    // 04-25 02:30 UTC → 2026-04-24 (LA) and 2026-04-25 (Tokyo).
    // Using a `tz` arg lets the page anchor "what day is this drive?"
    // to the *vehicle's* zone instead of the browser's local zone, so
    // late-night drives don't slip into the next day on the chart.
    const iso = '2026-04-25T02:30:00Z';
    expect(localDayKey(iso, 'America/Los_Angeles')).toBe('2026-04-24');
    expect(localDayKey(iso, 'Asia/Tokyo')).toBe('2026-04-25');
    expect(localDayKey(iso, 'UTC')).toBe('2026-04-25');
  });

  it('falls back to browser-local on an unknown tz string', () => {
    // Should not throw; should return *some* valid YYYY-MM-DD.
    const iso = '2026-04-24T12:00:00Z';
    const result = localDayKey(iso, 'Not/A_Zone');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseLocalDay', () => {
  it('anchors at UTC noon so the day stays stable in any tz', () => {
    const key = '2026-04-24';
    const d = parseLocalDay(key);
    // UTC noon — formatting in any IANA zone within ±14h still yields
    // April 24, which is the whole point of the noon-anchor approach.
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(3); // April
    expect(d.getUTCDate()).toBe(24);
    expect(d.getUTCHours()).toBe(12);
    // Re-keying via localDayKey with an explicit UTC tz must round-trip.
    expect(localDayKey(d.toISOString(), 'UTC')).toBe(key);
  });

  it('returns an invalid Date for malformed keys', () => {
    // Old behaviour silently substituted Jan 1; new contract surfaces
    // a NaN Date so callers using formatDayKey (the safer label path)
    // never accidentally render a wrong day.
    const d = parseLocalDay('2026');
    expect(Number.isNaN(d.getTime())).toBe(true);
  });
});
