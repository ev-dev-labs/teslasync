import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDashcamSettings, type ClipRecord } from '../lib/types';
import { useReconstruction } from './useReconstruction';
import { deriveDataState } from '@/api/dataState';
import type { SignalHistoryResponse } from '@/types/telemetry';
import type { useSignalEvidenceBundle } from '@/api/hooks/useTelemetry';

const { useBundle } = vi.hoisted(() => ({ useBundle: vi.fn<typeof useSignalEvidenceBundle>() }));
vi.mock('@/api/hooks/useTelemetry', () => ({ useSignalEvidenceBundle: useBundle }));

const clip: ClipRecord = {
  id: 'clip', fileName: 'clip.mp4', cameraPosition: 'front', cameraRaw: null,
  source: 'SavedClips', capturedAtRaw: '2026-10-05T10:00:00', durationSeconds: 60,
  sizeBytes: 1, mimeType: 'video/mp4', blob: new Blob(), eventSidecar: null,
  motion: { status: 'not_run' }, eventCandidates: [], redactions: [], vehicleId: 1,
  notes: '', createdAt: '', updatedAt: '',
};

beforeEach(() => {
  useBundle.mockReset();
});

describe('reconstruction retained-source boundary', () => {
  function mockHistory() {
    const data: SignalHistoryResponse = {
      vehicleId: 1, signal: 'Speed', from: '', to: '', count: 3,
      data: [
        { ts: '2026-10-05T10:00:00Z', value: 0, kind: 'ValueKindDouble', ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null },
        { ts: '2026-10-05T10:00:00.250Z', value: -1.25, kind: 'ValueKindDouble', ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null },
        { ts: '2026-10-05T10:00:00.500Z', value: 2.5, kind: 'ValueKindDouble', ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null },
      ],
    };
    const retry = vi.fn();
    const refetch = vi.fn(async () => {});
    const error = new Error('refresh failed');
    const sources = [{ signal: 'Speed', state: deriveDataState({
      data, dataUpdatedAt: 123456, error, refetch: retry,
    }, { provenance: 'historical' }) }];
    useBundle.mockReturnValue({
      data: [{ signal: 'Speed', response: data }], sources,
      isLoading: false, isFetching: false, isError: true, error, refetch,
    });
    return { data, sources, retry, refetch, error };
  }

  it.each([null, undefined, NaN, Infinity, -Infinity, -1, -0.25])(
    'keeps missing/invalid duration %s unresolved without losing source recovery',
    (durationSeconds) => {
      const history = mockHistory();
      const input = { ...clip, durationSeconds };
      const { result } = renderHook(() => useReconstruction(
        1, input as ClipRecord, { ...defaultDashcamSettings(), assumedTimezoneOffsetMinutes: 0 }, ['Speed'],
      ));
      expect(result.current.reconstruction).toBeNull();
      expect(result.current.hasRetainedHistory).toBe(true);
      expect(result.current.sources).toBe(history.sources);
      expect(result.current.sources[0].state.data).toBe(history.data);
      expect(result.current.sources[0].state.updatedAt).toBe(123456);
      expect(result.current.error).toBe(history.error);
      expect(result.current.refetch).toBe(history.refetch);
      result.current.sources[0].state.retry?.();
      expect(history.retry).toHaveBeenCalledOnce();
      expect(input.durationSeconds).toBe(durationSeconds);
    },
  );

  it('retains measured zero separately rather than rendering or exporting a zero-length clip window', () => {
    const history = mockHistory();
    const input = { ...clip, durationSeconds: 0 };
    const { result } = renderHook(() => useReconstruction(1, input, defaultDashcamSettings(), ['Speed']));
    expect(result.current.reconstruction).toBeNull();
    expect(input.durationSeconds).toBe(0);
    expect(result.current.sources).toBe(history.sources);
    expect(result.current.sources[0].state.data?.data[0].value).toBe(0);
  });

  it('recovers when the real fractional duration arrives and preserves signed fractional telemetry', () => {
    mockHistory();
    const settings = { ...defaultDashcamSettings(), assumedTimezoneOffsetMinutes: 0,
      reconstructionPreRollSeconds: 0.125, reconstructionPostRollSeconds: 0.25 };
    const { result, rerender } = renderHook(
      ({ input }) => useReconstruction(1, input, settings, ['Speed']),
      { initialProps: { input: { ...clip, durationSeconds: null } as ClipRecord } },
    );
    expect(result.current.reconstruction).toBeNull();
    rerender({ input: { ...clip, durationSeconds: 0.5 } });
    expect(result.current.reconstruction?.clipWindow).toEqual({ startSeconds: 0, endSeconds: 0.5 });
    expect(result.current.reconstruction?.reconstructionWindow).toEqual({ startSeconds: -0.125, endSeconds: 0.75 });
    expect(result.current.reconstruction?.series[0].points.map(point => point.value)).toEqual([0, -1.25, 2.5]);
    rerender({ input: { ...clip, durationSeconds: null } });
    expect(result.current.reconstruction).toBeNull();
  });

  it.each([-420, 0, 330, 0.5])('accepts finite signed/fractional camera offset %s', (offset) => {
    mockHistory();
    const { result } = renderHook(() => useReconstruction(1, clip, {
      ...defaultDashcamSettings(), assumedTimezoneOffsetMinutes: offset,
    }, ['Speed']));
    expect(result.current.clipEpochMs).toBe(Date.parse('2026-10-05T10:00:00Z') - offset * 60_000);
    expect(result.current.reconstruction?.clipWindow.endSeconds).toBe(60);
  });

  it.each([
    { capturedAtRaw: null },
    { capturedAtRaw: 'invalid' },
    { assumedTimezoneOffsetMinutes: NaN },
    { assumedTimezoneOffsetMinutes: Infinity },
    { reconstructionPreRollSeconds: -1 },
    { reconstructionPreRollSeconds: NaN },
    { reconstructionPostRollSeconds: -0.25 },
    { reconstructionPostRollSeconds: Infinity },
  ])('retains recovery when alignment prerequisites are invalid: %j', (invalid) => {
    const history = mockHistory();
    const { result } = renderHook(() => useReconstruction(1, { ...clip, ...invalid }, {
      ...defaultDashcamSettings(), assumedTimezoneOffsetMinutes: 0, ...invalid,
    }, ['Speed']));
    expect(result.current.reconstruction).toBeNull();
    expect(Number.isFinite(result.current.lookbackHours)).toBe(true);
    expect(result.current.sources).toBe(history.sources);
    expect(result.current.refetch).toBe(history.refetch);
  });

  it('forwards complete mixed source identities, original payload and last success without changing alignment inputs', () => {
    const data: SignalHistoryResponse = {
      vehicleId: 1, signal: 'Speed', from: '', to: '', count: 1,
      data: [{
        ts: '2026-10-05T10:00:00Z', value: 0, kind: 'ValueKindDouble',
        ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null,
      }],
    };
    const originalPayload = structuredClone(data);
    const retry = vi.fn();
    const sources = [
      { signal: 'Speed', state: deriveDataState({ data, dataUpdatedAt: 123456, error: new Error('refresh failed'), refetch: retry }, { provenance: 'historical' }) },
      { signal: 'Heading', state: deriveDataState<SignalHistoryResponse>({ isPending: true }) },
      { signal: 'Gear', state: deriveDataState<SignalHistoryResponse>({ error: new Error('first request failed') }) },
    ];
    const refetch = vi.fn(async () => {});
    useBundle.mockReturnValue({ data: [{ signal: 'Speed', response: data }], sources,
      isLoading: true, isFetching: true, isError: true, error: new Error('refresh failed'), refetch });
    const settings = { ...defaultDashcamSettings(), assumedTimezoneOffsetMinutes: 0 };
    const { result } = renderHook(() => useReconstruction(1, clip, settings, ['Speed', 'Heading', 'Gear']));
    expect(result.current.sources).toBe(sources);
    expect(result.current.sources.map(source => source.signal)).toEqual(['Speed', 'Heading', 'Gear']);
    expect(result.current.sources[0].state.data).toBe(data);
    expect(data).toEqual(originalPayload);
    expect(result.current.sources[0].state.updatedAt).toBe(123456);
    expect(result.current.sources[0].state.fatalError).toBeNull();
    expect(result.current.sources[1].state.status).toBe('initial');
    expect(result.current.sources[2].state.status).toBe('initialFailure');
    expect(result.current.reconstruction?.series[0].points[0].value).toBe(0);
    expect(result.current.reconstruction?.series.map(series => series.signal)).toEqual(['Speed']);
    result.current.sources[0].state.retry?.();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
    expect(useBundle).toHaveBeenCalledWith(1, ['Speed', 'Heading', 'Gear'], expect.any(Number));
  });

  it('does not count an eagerly computed alignment as retained telemetry', () => {
    useBundle.mockReturnValue({
      data: [], isLoading: true, isFetching: true, isError: false, error: null,
      sources: [{ signal: 'Speed', state: deriveDataState<SignalHistoryResponse>({ isPending: true }) }],
      refetch: vi.fn(async () => {}),
    });
    const { result } = renderHook(() => useReconstruction(1, clip, defaultDashcamSettings(), ['Speed']));
    expect(result.current.reconstruction).not.toBeNull();
    expect(result.current.hasRetainedHistory).toBe(false);
    expect(useBundle).toHaveBeenCalledWith(1, ['Speed'], expect.any(Number));
  });

  it('counts a received empty signal response as known data and retains independent retry ownership', () => {
    const refetch = vi.fn(async () => {});
    const data: SignalHistoryResponse = {
      vehicleId: 1, signal: 'Speed', from: '', to: '', count: 0, data: [],
    };
    useBundle.mockReturnValue({
      data: [{ signal: 'Speed', response: data }],
      sources: [
        { signal: 'Speed', state: deriveDataState({ data }, { unavailable: true }) },
        { signal: 'Heading', state: deriveDataState<SignalHistoryResponse>({ error: new Error('another signal failed') }) },
      ],
      isLoading: false, isFetching: false, isError: true,
      error: new Error('another signal failed'), refetch,
    });
    const { result } = renderHook(() => useReconstruction(1, clip, defaultDashcamSettings(), ['Speed', 'Heading']));
    expect(result.current.hasRetainedHistory).toBe(true);
    expect(result.current.reconstruction?.series.map(series => series.signal)).toEqual(['Speed']);
    expect(result.current.refetch).toBe(refetch);
    expect(useBundle).toHaveBeenCalledWith(1, ['Speed', 'Heading'], expect.any(Number));
  });

  it('preserves false, null and raw sample order while aligning canonical history chronologically', () => {
    const data: SignalHistoryResponse = {
      vehicleId: 1, signal: 'Gear', from: '', to: '', count: 3,
      data: [
        { ts: '2026-10-05T10:00:02Z', value: null, kind: 'ValueKindString', ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null },
        { ts: '2026-10-05T10:00:00Z', value: false, kind: 'ValueKindBoolean', ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null },
        { ts: '2026-10-05T10:00:01Z', value: 'Drive', kind: 'ValueKindString', ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null },
      ],
    };
    const originalPayload = structuredClone(data);
    const originalPoints = [...data.data];
    const sources = [{ signal: 'Gear', state: deriveDataState({ data }, { provenance: 'historical' }) }];
    useBundle.mockReturnValue({
      data: [{ signal: 'Gear', response: data }], sources,
      isLoading: false, isFetching: false, isError: false, error: null,
      refetch: vi.fn(async () => {}),
    });
    const settings = { ...defaultDashcamSettings(), assumedTimezoneOffsetMinutes: 0 };
    const { result } = renderHook(() => useReconstruction(1, clip, settings, ['Gear']));
    expect(result.current.sources).toBe(sources);
    expect(result.current.sources[0].state.data).toBe(data);
    expect(result.current.hasRetainedHistory).toBe(true);
    expect(result.current.reconstruction?.series[0].points.map(point => point.value)).toEqual([false, 'Drive', null]);
    expect(result.current.reconstruction?.series[0].points.map(point => point.atSeconds)).toEqual([0, 1, 2]);
    expect(data).toEqual(originalPayload);
    data.data.forEach((point, index) => expect(point).toBe(originalPoints[index]));
  });
});
