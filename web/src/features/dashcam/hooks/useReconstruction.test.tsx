import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDashcamSettings, type ClipRecord } from '../lib/types';
import { useReconstruction } from './useReconstruction';

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
  it('does not count an eagerly computed alignment as retained telemetry', () => {
    useBundle.mockReturnValue({
      data: [], isLoading: true, isFetching: true, isError: false, error: null,
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
