import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { buildDepartureRates, forecastDepartures, weekdayPeaks } from './departureForecast';

let nextId = 1;

function driveAt(d: Date): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: d.toISOString(),
    endTs: null,
    durationS: 1800,
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
  };
}

/** `now` is a Thursday at 06:30 local time. */
const NOW = new Date(2026, 4, 14, 6, 30);
const NOW_MS = NOW.getTime();

/** Every weekday at 08:00, going back `weeks` weeks from NOW. */
function weekdayCommute(weeks: number): Drive[] {
  const drives: Drive[] = [];
  for (let w = 1; w <= weeks * 7; w++) {
    const day = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - w, 8, 5);
    const dow = day.getDay();
    if (dow >= 1 && dow <= 5) drives.push(driveAt(day));
  }
  return drives;
}

describe('buildDepartureRates', () => {
  it('is empty and safe with no drives', () => {
    const rates = buildDepartureRates([], NOW_MS);
    expect(rates.totalDepartures).toBe(0);
    expect(rates.windowDays).toBe(0);
    // Every cell falls back to the weak prior, never to NaN.
    expect(rates.lambda[0]![0]).toBeCloseTo(0.1, 6);
  });

  it('concentrates intensity on the observed commute hour', () => {
    const rates = buildDepartureRates(weekdayCommute(8), NOW_MS);
    // Thursday = 4.
    expect(rates.counts[4]![8]).toBeGreaterThan(6);
    expect(rates.lambda[4]![8]!).toBeGreaterThan(rates.lambda[4]![13]!);
    expect(rates.lambda[0]![8]!).toBeLessThan(rates.lambda[4]![8]!);
  });

  it('counts cell occurrences from the real observed window', () => {
    // Three days of history must not imply many weeks of Tuesdays.
    const recent = [driveAt(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 2, 8, 0))];
    const rates = buildDepartureRates(recent, NOW_MS);
    expect(rates.windowDays).toBeLessThan(3);
    const totalOccurrences = rates.occurrences.flat().reduce((a, b) => a + b, 0);
    expect(totalOccurrences).toBeLessThan(24 * 4);
  });

  it('ignores drives outside the recency window and in the future', () => {
    const ancient = driveAt(new Date(NOW.getFullYear() - 2, 0, 1, 8, 0));
    const future = driveAt(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 3, 8, 0));
    expect(buildDepartureRates([ancient, future], NOW_MS).totalDepartures).toBe(0);
  });

  it('shrinks a single sighting toward the prior instead of asserting certainty', () => {
    const drives = [
      ...weekdayCommute(8),
      driveAt(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 30, 3, 0)),
    ];
    const rates = buildDepartureRates(drives, NOW_MS);
    const oneOffSlot = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 30, 3, 0);
    const l = rates.lambda[oneOffSlot.getDay()]![3]!;
    expect(1 - Math.exp(-l)).toBeLessThan(0.35);
  });
});

describe('forecastDepartures', () => {
  it('produces a full horizon of slots starting at the next hour boundary', () => {
    const f = forecastDepartures(weekdayCommute(8), NOW_MS);
    expect(f.slots).toHaveLength(24);
    expect(f.slots[0]!.hour).toBe(7);
    expect(new Date(f.slots[0]!.startMs).getMinutes()).toBe(0);
  });

  it('peaks on the historical commute hour', () => {
    const f = forecastDepartures(weekdayCommute(10), NOW_MS);
    expect(f.peak!.hour).toBe(8);
    expect(f.peak!.p).toBeGreaterThan(0.5);
    expect(f.nextLikely!.hour).toBe(8);
  });

  it('keeps the cumulative curve monotonic and bounded', () => {
    const f = forecastDepartures(weekdayCommute(6), NOW_MS);
    let prev = -1;
    for (const s of f.slots) {
      expect(s.cumulative).toBeGreaterThanOrEqual(prev);
      expect(s.cumulative).toBeLessThanOrEqual(1);
      prev = s.cumulative;
    }
    expect(f.pHorizon).toBe(f.slots[f.slots.length - 1]!.cumulative);
  });

  it('places the preconditioning trigger ahead of the peak', () => {
    const f = forecastDepartures(weekdayCommute(8), NOW_MS, { leadMinutes: 25 });
    expect(f.peak!.startMs - f.preconditionAtMs!).toBe(25 * 60_000);
  });

  it('scales confidence with observed history', () => {
    const thin = forecastDepartures(weekdayCommute(1), NOW_MS);
    const thick = forecastDepartures(weekdayCommute(12), NOW_MS);
    expect(thin.confidence).toBeLessThan(thick.confidence);
    expect(thick.confidence).toBe(1);
  });

  it('stays null-safe with no history', () => {
    const f = forecastDepartures([], NOW_MS);
    expect(f.nextLikely).toBeNull();
    expect(f.totalDepartures).toBe(0);
    expect(f.pHorizon).toBeGreaterThan(0);
    expect(f.pHorizon).toBeLessThan(1);
  });
});

describe('weekdayPeaks', () => {
  it('returns one busiest hour per weekday', () => {
    const peaks = weekdayPeaks(buildDepartureRates(weekdayCommute(8), NOW_MS));
    expect(peaks).toHaveLength(7);
    expect(peaks.map((p) => p.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Monday–Friday should all land on the commute hour.
    for (const p of peaks.slice(1, 6)) expect(p.hour).toBe(8);
  });
});
