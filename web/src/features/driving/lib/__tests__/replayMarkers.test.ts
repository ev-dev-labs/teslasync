import { describe, it, expect } from 'vitest';
import { computeReplayMarkers, nearestMarker } from '../replayMarkers';
import type { DrivePosition } from '@/types/driving';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function pos(
  overrides: Partial<DrivePosition> & { secondsFromStart: number },
): DrivePosition {
  const t0 = new Date('2024-01-01T00:00:00Z').getTime();
  const ts = new Date(t0 + overrides.secondsFromStart * 1000).toISOString();
  return {
    latitude: 47.6,
    longitude: -122.3,
    speed: 30,
    power: 10,
    batteryLevel: 80,
    timestamp: ts,
    elevation: 0,
    insideTemp: 20,
    outsideTemp: 15,
    idealRange: 200,
    ratedRange: 200,
    odometer: 1000,
    fanStatus: 0,
    isClimateOn: false,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('computeReplayMarkers', () => {
  it('returns empty array when there are no positions', () => {
    expect(computeReplayMarkers([])).toEqual([]);
  });

  it('returns only a start marker for a single position', () => {
    const out = computeReplayMarkers([pos({ secondsFromStart: 0 })]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('start');
    expect(out[0].at).toBe(0);
  });

  it('returns start + stop for a zero-duration drive (identical timestamps)', () => {
    const out = computeReplayMarkers([
      pos({ secondsFromStart: 0 }),
      pos({ secondsFromStart: 0 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe('start');
    expect(out[0].at).toBe(0);
    expect(out[1].kind).toBe('stop');
    expect(out[1].at).toBe(1);
  });

  it('emits start + stop markers at 0 and 1', () => {
    const out = computeReplayMarkers([
      pos({ secondsFromStart: 0 }),
      pos({ secondsFromStart: 60 }),
      pos({ secondsFromStart: 120 }),
    ]);
    const start = out.find((m) => m.kind === 'start');
    const stop = out.find((m) => m.kind === 'stop');
    expect(start?.at).toBe(0);
    expect(stop?.at).toBe(1);
  });

  it('emits charge-start + charge-stop when power < 0 for >=30s', () => {
    const positions: DrivePosition[] = [
      pos({ secondsFromStart: 0, power: 20 }),
      pos({ secondsFromStart: 30, power: -5 }),
      pos({ secondsFromStart: 60, power: -8 }),
      pos({ secondsFromStart: 90, power: -3 }),
      pos({ secondsFromStart: 120, power: 25 }),
    ];
    const out = computeReplayMarkers(positions);
    expect(out.some((m) => m.kind === 'charge-start')).toBe(true);
    expect(out.some((m) => m.kind === 'charge-stop')).toBe(true);
  });

  it('does NOT emit charge markers for short power-negative blips (<30s)', () => {
    const positions: DrivePosition[] = [
      pos({ secondsFromStart: 0, power: 20 }),
      pos({ secondsFromStart: 5, power: -5 }),
      pos({ secondsFromStart: 10, power: 25 }),
      pos({ secondsFromStart: 60, power: 30 }),
    ];
    const out = computeReplayMarkers(positions);
    expect(out.some((m) => m.kind === 'charge-start')).toBe(false);
    expect(out.some((m) => m.kind === 'charge-stop')).toBe(false);
  });

  it('emits at least one regen-peak marker on a regen-heavy run', () => {
    const positions: DrivePosition[] = Array.from({ length: 20 }, (_, i) =>
      pos({
        secondsFromStart: i * 30,
        power: i % 3 === 0 ? -50 - i * 2 : 15, // big regen spikes
      }),
    );
    const out = computeReplayMarkers(positions);
    expect(out.some((m) => m.kind === 'regen-peak')).toBe(true);
  });

  it('emits a low-soc marker when battery drops below 20%', () => {
    const positions: DrivePosition[] = [
      pos({ secondsFromStart: 0, batteryLevel: 80 }),
      pos({ secondsFromStart: 60, batteryLevel: 50 }),
      pos({ secondsFromStart: 120, batteryLevel: 19 }),
      pos({ secondsFromStart: 180, batteryLevel: 12 }),
    ];
    const out = computeReplayMarkers(positions);
    const lowSoc = out.filter((m) => m.kind === 'low-soc');
    expect(lowSoc).toHaveLength(1);
    expect(lowSoc[0].at).toBeGreaterThan(0);
    expect(lowSoc[0].at).toBeLessThan(1);
  });

  it('does not emit a low-soc marker when battery never drops below 20%', () => {
    const positions: DrivePosition[] = [
      pos({ secondsFromStart: 0, batteryLevel: 80 }),
      pos({ secondsFromStart: 60, batteryLevel: 50 }),
      pos({ secondsFromStart: 120, batteryLevel: 30 }),
    ];
    const out = computeReplayMarkers(positions);
    expect(out.some((m) => m.kind === 'low-soc')).toBe(false);
  });

  it('emits fast-segment markers when speed exceeds p95 for >=10s', () => {
    // 100 positions, mostly slow (40 km/h), with a 20-second fast-segment burst
    // at 200 km/h. 5/100 = 5% of samples, so p95 cleanly separates the burst.
    const positions: DrivePosition[] = Array.from({ length: 100 }, (_, i) =>
      pos({
        secondsFromStart: i * 5,
        speed: i >= 40 && i <= 44 ? 200 : 40,
      }),
    );
    const out = computeReplayMarkers(positions);
    expect(out.some((m) => m.kind === 'fast-segment')).toBe(true);
  });

  it('clusters adjacent same-kind markers when count exceeds the cap', () => {
    // 60 positions where every other one is a regen peak — exceeds MAX_MARKERS=25.
    const positions: DrivePosition[] = Array.from({ length: 60 }, (_, i) =>
      pos({
        secondsFromStart: i * 2,
        power: i % 2 === 0 ? -100 : 20,
      }),
    );
    const out = computeReplayMarkers(positions);
    const regenPeaks = out.filter((m) => m.kind === 'regen-peak');
    expect(regenPeaks.length).toBeLessThanOrEqual(25);
    // At least one cluster must carry a count > 1.
    expect(regenPeaks.some((m) => (m.count ?? 1) > 1)).toBe(true);
  });

  it('returns markers sorted by `at` ascending', () => {
    const positions: DrivePosition[] = [
      pos({ secondsFromStart: 0, power: 10, batteryLevel: 80 }),
      pos({ secondsFromStart: 60, power: -50, batteryLevel: 60 }),
      pos({ secondsFromStart: 90, power: -45, batteryLevel: 45 }),
      pos({ secondsFromStart: 120, power: 20, batteryLevel: 30 }),
      pos({ secondsFromStart: 180, power: 25, batteryLevel: 18 }),
    ];
    const out = computeReplayMarkers(positions);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].at).toBeGreaterThanOrEqual(out[i - 1].at);
    }
  });

  it('produces `at` values in [0, 1] for all markers', () => {
    const positions: DrivePosition[] = [
      pos({ secondsFromStart: 0 }),
      pos({ secondsFromStart: 60, power: -50 }),
      pos({ secondsFromStart: 120, power: -50 }),
      pos({ secondsFromStart: 200 }),
    ];
    const out = computeReplayMarkers(positions);
    for (const m of out) {
      expect(m.at).toBeGreaterThanOrEqual(0);
      expect(m.at).toBeLessThanOrEqual(1);
    }
  });
});

describe('nearestMarker', () => {
  it('returns null when there are no markers', () => {
    expect(nearestMarker([], 0.5)).toBeNull();
  });

  it('returns the marker within tolerance of the playhead', () => {
    const m = { at: 0.5, kind: 'regen-peak' as const };
    expect(nearestMarker([m], 0.51, 0.02)).toBe(m);
  });

  it('returns null when no marker is within tolerance', () => {
    const m = { at: 0.5, kind: 'regen-peak' as const };
    expect(nearestMarker([m], 0.7, 0.02)).toBeNull();
  });

  it('returns the closest marker when several are within tolerance', () => {
    const a = { at: 0.48, kind: 'fast-segment' as const };
    const b = { at: 0.51, kind: 'regen-peak' as const };
    const c = { at: 0.55, kind: 'low-soc' as const };
    expect(nearestMarker([a, b, c], 0.5, 0.05)).toBe(b);
  });
});
