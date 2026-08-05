import { describe, it, expect } from 'vitest';
import {
  alignSignalHistoryToClip,
  resolveClipEpochMs,
  toReconstructionMarkers,
  type SignalSeriesInput,
} from '../lib/timelineAlignment';

const CLIP_START = Date.parse('2024-01-15T12:30:00Z');

describe('resolveClipEpochMs', () => {
  it('treats the naive timestamp as UTC when offset is 0', () => {
    expect(resolveClipEpochMs('2024-01-15T12:30:00', 0)).toBe(Date.parse('2024-01-15T12:30:00Z'));
  });

  it('shifts by the assumed UTC offset (UTC-7 clock reading 12:00 -> 19:00 UTC)', () => {
    const epoch = resolveClipEpochMs('2024-01-15T12:00:00', -420);
    expect(epoch).toBe(Date.parse('2024-01-15T19:00:00Z'));
  });

  it('returns null for missing or unparseable input', () => {
    expect(resolveClipEpochMs(null, 0)).toBeNull();
    expect(resolveClipEpochMs('not-a-date', 0)).toBeNull();
  });
});

function iso(offsetSeconds: number): string {
  return new Date(CLIP_START + offsetSeconds * 1000).toISOString();
}

describe('alignSignalHistoryToClip', () => {
  it('reports "none" coverage and an explicit note when a signal has zero points in-window', () => {
    const result = alignSignalHistoryToClip({
      clipStartEpochMs: CLIP_START,
      clipDurationSeconds: 30,
      preRollSeconds: 10,
      postRollSeconds: 10,
      seriesInput: [{ signal: 'Empty', points: [] }],
    });
    expect(result.series[0].coverage).toBe('none');
    expect(result.series[0].gapNotes[0]).toContain('No telemetry samples found');
    expect(result.overallQuality).toBe('none');
  });

  it('filters out points outside the reconstruction window', () => {
    const seriesInput: SignalSeriesInput[] = [
      {
        signal: 'Speed',
        points: [
          { timestamp: iso(-100), valueNum: 999 }, // far before window
          { timestamp: iso(0), valueNum: 10 },
          { timestamp: iso(15), valueNum: 12 },
          { timestamp: iso(200), valueNum: 999 }, // far after window
        ],
      },
    ];
    const result = alignSignalHistoryToClip({
      clipStartEpochMs: CLIP_START,
      clipDurationSeconds: 30,
      preRollSeconds: 10,
      postRollSeconds: 10,
      seriesInput,
    });
    expect(result.series[0].points).toHaveLength(2);
    expect(result.series[0].points.map((p) => p.value)).toEqual([10, 12]);
  });

  it('flags "sparse" coverage below the minimum point threshold', () => {
    const seriesInput: SignalSeriesInput[] = [
      { signal: 'Rare', points: [{ timestamp: iso(0), valueNum: 1 }, { timestamp: iso(5), valueNum: 2 }] },
    ];
    const result = alignSignalHistoryToClip({
      clipStartEpochMs: CLIP_START,
      clipDurationSeconds: 30,
      preRollSeconds: 10,
      postRollSeconds: 10,
      seriesInput,
    });
    expect(result.series[0].coverage).toBe('sparse');
  });

  it('flags "partial" coverage when the largest gap dominates the window', () => {
    const seriesInput: SignalSeriesInput[] = [
      {
        signal: 'Gappy',
        points: [
          { timestamp: iso(-10), valueNum: 1 },
          { timestamp: iso(-9), valueNum: 1 },
          { timestamp: iso(-8), valueNum: 1 },
          { timestamp: iso(38), valueNum: 1 }, // huge gap right before window end
          { timestamp: iso(40), valueNum: 1 },
        ],
      },
    ];
    const result = alignSignalHistoryToClip({
      clipStartEpochMs: CLIP_START,
      clipDurationSeconds: 30,
      preRollSeconds: 10,
      postRollSeconds: 10,
      seriesInput,
    });
    expect(result.series[0].coverage).toBe('partial');
    expect(result.series[0].gapNotes[0]).toContain('gap');
  });

  it('detects a numeric spike and labels it via the signal-name hint', () => {
    const seriesInput: SignalSeriesInput[] = [
      {
        signal: 'VehicleBrakePressure',
        points: [
          { timestamp: iso(0), valueNum: 20 },
          { timestamp: iso(1), valueNum: 20.1 },
          { timestamp: iso(2), valueNum: 19.9 },
          { timestamp: iso(3), valueNum: 20.0 },
          { timestamp: iso(4), valueNum: 5.0 }, // sharp drop — the spike
          { timestamp: iso(5), valueNum: 4.9 },
          { timestamp: iso(6), valueNum: 5.1 },
          { timestamp: iso(7), valueNum: 5.0 },
        ],
      },
    ];
    const result = alignSignalHistoryToClip({
      clipStartEpochMs: CLIP_START,
      clipDurationSeconds: 30,
      preRollSeconds: 5,
      postRollSeconds: 5,
      seriesInput,
    });
    expect(result.incidentSequence.length).toBeGreaterThan(0);
    expect(result.incidentSequence[0].kind).toBe('hard_brake');
    expect(result.incidentSequence[0].signal).toBe('VehicleBrakePressure');
  });

  it('detects boolean/text state changes', () => {
    const seriesInput: SignalSeriesInput[] = [
      {
        signal: 'DoorState',
        points: [
          { timestamp: iso(0), valueBool: false },
          { timestamp: iso(5), valueBool: true },
        ],
      },
    ];
    const result = alignSignalHistoryToClip({
      clipStartEpochMs: CLIP_START,
      clipDurationSeconds: 30,
      preRollSeconds: 5,
      postRollSeconds: 5,
      seriesInput,
    });
    expect(result.incidentSequence).toHaveLength(1);
    expect(result.incidentSequence[0].kind).toBe('state_change');
    expect(result.incidentSequence[0].description).toContain('true');
  });

  it('reports overallQuality "good" when every series has good coverage', () => {
    const seriesInput: SignalSeriesInput[] = [
      {
        signal: 'Dense',
        points: Array.from({ length: 10 }, (_, i) => ({ timestamp: iso(i * 3), valueNum: i })),
      },
    ];
    const result = alignSignalHistoryToClip({
      clipStartEpochMs: CLIP_START,
      clipDurationSeconds: 30,
      preRollSeconds: 0,
      postRollSeconds: 0,
      seriesInput,
    });
    expect(result.overallQuality).toBe('good');
  });

  it('notes when no signals were selected at all', () => {
    const result = alignSignalHistoryToClip({
      clipStartEpochMs: CLIP_START,
      clipDurationSeconds: 30,
      preRollSeconds: 5,
      postRollSeconds: 5,
      seriesInput: [],
    });
    expect(result.qualityNotes[0]).toContain('No telemetry signals were selected');
  });
});

describe('toReconstructionMarkers', () => {
  it('produces normalized start/stop markers plus one per incident event', () => {
    const result = alignSignalHistoryToClip({
      clipStartEpochMs: CLIP_START,
      clipDurationSeconds: 20,
      preRollSeconds: 10,
      postRollSeconds: 10,
      seriesInput: [
        {
          signal: 'DoorState',
          points: [
            { timestamp: iso(0), valueBool: false },
            { timestamp: iso(5), valueBool: true },
          ],
        },
      ],
    });
    const markers = toReconstructionMarkers(result);
    expect(markers.find((m) => m.kind === 'start')?.at).toBeCloseTo(10 / 40, 5);
    expect(markers.find((m) => m.kind === 'stop')?.at).toBeCloseTo(30 / 40, 5);
    expect(markers.filter((m) => m.kind === 'event')).toHaveLength(1);
  });
});
