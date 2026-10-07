import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDashcamSettings, type ClipRecord } from '../lib/types';
import { useReconstruction } from './useReconstruction';
import { deriveDataState } from '@/api/dataState';
import type { SignalHistoryResponse } from '@/types/telemetry';

const { useBundle } = vi.hoisted(() => ({ useBundle: vi.fn() }));
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
  it('forwards complete mixed source identities, original payload and last success without changing alignment inputs', () => {
    const data: SignalHistoryResponse = {
      vehicleId: 1, signal: 'Speed', from: '', to: '', count: 1,
      data: [{ timestamp: '2026-10-05T10:00:00Z', valueNum: 0 }],
    };
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
    useBundle.mockReturnValue({
      data: [{ signal: 'Speed', response: { data: [] } }],
      sources: [
        { signal: 'Speed', state: deriveDataState({ data: {
          vehicleId: 1, signal: 'Speed', from: '', to: '', count: 0, data: [],
        } }, { unavailable: true }) },
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
});
