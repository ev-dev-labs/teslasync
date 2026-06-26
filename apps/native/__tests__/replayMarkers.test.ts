import {
  computeReplayMarkers,
  nearestMarker,
  type ReplayMarker,
} from '../src/web-parity/features/driving/lib/replayMarkers';
import type {DrivePosition} from '../src/web-parity/api/hooks/useDriving';

/**
 * Native parity contract for the trip-replay marker library.
 *
 * The web helper derives normalized [0,1] timeline ticks (start/stop, charge
 * segments, fast segments, regen peaks, the first low-SoC moment) from a drive's
 * DrivePosition samples, then clusters dense same-kind ticks and exposes a
 * nearest-marker lookup for the scrubber playhead. These tests assert the ported
 * pure functions preserve that behaviour and its documented edge cases.
 */

const BASE_TS = Date.parse('2024-01-01T00:00:00.000Z');

function pos(
  offsetMs: number,
  overrides: Partial<DrivePosition> = {},
): DrivePosition {
  return {
    latitude: 0,
    longitude: 0,
    speed: null,
    power: null,
    batteryLevel: 80,
    timestamp: new Date(BASE_TS + offsetMs).toISOString(),
    insideTemp: null,
    outsideTemp: null,
    idealRange: null,
    ratedRange: null,
    odometer: null,
    elevation: null,
    fanStatus: null,
    isClimateOn: null,
    ...overrides,
  };
}

describe('computeReplayMarkers — edge cases', () => {
  it('returns an empty array for no positions', () => {
    expect(computeReplayMarkers([])).toEqual([]);
  });

  it('emits only a start marker for a single position', () => {
    const markers = computeReplayMarkers([pos(0)]);
    expect(markers).toEqual([{at: 0, kind: 'start', label: 'Start'}]);
  });

  it('emits start and stop for a zero-duration drive (identical timestamps)', () => {
    const markers = computeReplayMarkers([pos(0), pos(0)]);
    expect(markers.map((m) => m.kind)).toEqual(['start', 'stop']);
    expect(markers[0].at).toBe(0);
    expect(markers[1].at).toBe(1);
  });
});

describe('computeReplayMarkers — full drive', () => {
  it('always brackets the timeline with start@0 and stop@1, sorted by at', () => {
    const positions = [
      pos(0, {speed: 5, batteryLevel: 90}),
      pos(60_000, {speed: 30, batteryLevel: 70}),
      pos(120_000, {speed: 5, batteryLevel: 50}),
    ];
    const markers = computeReplayMarkers(positions);

    const first = markers[0];
    const last = markers[markers.length - 1];
    expect(first.kind).toBe('start');
    expect(first.at).toBe(0);
    expect(last.kind).toBe('stop');
    expect(last.at).toBe(1);

    const ats = markers.map((m) => m.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
  });

  it('flags the first low-SoC dip below 20% exactly once', () => {
    const positions = [
      pos(0, {batteryLevel: 30}),
      pos(30_000, {batteryLevel: 18}),
      pos(60_000, {batteryLevel: 10}),
    ];
    const lowSoc = computeReplayMarkers(positions).filter(
      (m) => m.kind === 'low-soc',
    );
    expect(lowSoc).toHaveLength(1);
    expect(lowSoc[0].label).toBe('Battery <20%');
    // Second sample (50% of a 60s span) is the first below threshold.
    expect(lowSoc[0].at).toBeCloseTo(0.5, 5);
  });

  it('detects a sustained charge segment (>=30s of negative power)', () => {
    const positions = [
      pos(0, {power: 10}),
      pos(10_000, {power: -20}),
      pos(50_000, {power: -20}),
      pos(60_000, {power: 10}),
    ];
    const kinds = computeReplayMarkers(positions).map((m) => m.kind);
    expect(kinds).toContain('charge-start');
    expect(kinds).toContain('charge-stop');
  });
});

describe('nearestMarker', () => {
  const markers: ReplayMarker[] = [
    {at: 0, kind: 'start', label: 'Start'},
    {at: 0.5, kind: 'regen-peak', label: 'Regen peak'},
    {at: 1, kind: 'stop', label: 'End'},
  ];

  it('returns the closest marker within the default tolerance', () => {
    expect(nearestMarker(markers, 0.505)?.kind).toBe('regen-peak');
  });

  it('returns null when nothing is within tolerance', () => {
    expect(nearestMarker(markers, 0.3)).toBeNull();
  });

  it('respects a custom tolerance', () => {
    expect(nearestMarker(markers, 0.45, 0.1)?.kind).toBe('regen-peak');
    expect(nearestMarker(markers, 0.45, 0.01)).toBeNull();
  });
});
