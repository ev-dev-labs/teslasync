import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import type { SignalEvidenceBundleResult } from '@/api/hooks/useTelemetry';
import type { SignalHistoryResponse } from '@/types/telemetry';
import { useRootCauseWorkspace } from './useRootCauseWorkspace';

const mocks = vi.hoisted(() => ({ bundle: vi.fn(), catalog: vi.fn() }));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalEvidenceBundle: mocks.bundle,
  useSignals: mocks.catalog,
}));

function response(signal: string, numeric = true): SignalHistoryResponse {
  const data = Array.from({ length: 48 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 9, 6, 0, index)).toISOString(),
    ...(numeric ? { valueNum: 0 } : { valueStr: 'Park' }),
  }));
  return { vehicleId: 7, signal, from: data[0].timestamp, to: data[47].timestamp, count: data.length, data };
}

beforeEach(() => {
  mocks.catalog.mockReturnValue({ data: ['Soc', 'PackVoltage', 'PackTemperature'], refetch: vi.fn() });
  mocks.bundle.mockReset();
});

describe('root-cause workspace complete source preservation', () => {
  it('retains normalized source order and measured zero analysis alongside pending, initial failure and empty histories', () => {
    const zero = response('Soc');
    const empty: SignalHistoryResponse = { ...response('PackVoltage'), count: 0, data: [] };
    const bundle: SignalEvidenceBundleResult = {
      data: [{ signal: 'Soc', response: zero }, { signal: 'PackVoltage', response: empty }, { signal: 'Gear', response: response('Gear', false) }],
      sources: [
        { signal: 'Soc', state: deriveDataState({ data: zero }, { provenance: 'historical' }) },
        { signal: 'PackTemperature', state: deriveDataState<SignalHistoryResponse>({ isPending: true }) },
        { signal: 'Current', state: deriveDataState<SignalHistoryResponse>({ error: new Error('Current failed') }) },
        { signal: 'PackVoltage', state: deriveDataState({ data: empty }, { provenance: 'historical', unavailable: true }) },
        { signal: 'Gear', state: deriveDataState({ data: response('Gear', false) }, { provenance: 'historical' }) },
      ],
      isLoading: true, isFetching: true, isError: true, error: new Error('Current failed'), refetch: vi.fn(async () => {}),
    };
    mocks.bundle.mockReturnValue(bundle);
    const { result } = renderHook(() => useRootCauseWorkspace(7));
    act(() => result.current.setFocalSignal('Soc'));
    expect(result.current.evidenceBundle).toBe(bundle);
    expect(result.current.evidenceBundle.sources.map(source => source.signal))
      .toEqual(['Soc', 'PackTemperature', 'Current', 'PackVoltage', 'Gear']);
    expect(result.current.evidenceBundle.sources[0].state.data).toBe(zero);
    expect(result.current.analysis.quality.focalSampleCount).toBe(48);
    expect(result.current.analysis.focalShift).toBeNull();
    expect(result.current.evidenceBundle.sources[1].state.status).toBe('initial');
    expect(result.current.evidenceBundle.sources[2].state.status).toBe('initialFailure');
    expect(result.current.evidenceBundle.sources[3].state.status).toBe('unavailable');
    expect(result.current.evidenceBundle.sources[4].state.status).toBe('ok');
    expect(mocks.bundle).toHaveBeenLastCalledWith(7, [
      'Soc', ...result.current.relatedCandidates.map(candidate => candidate.signal),
    ], 72);
  });

  it('keeps the same analysis and retained response after a source-only refresh failure, with individual retry', () => {
    const zero = response('Soc');
    const data = [{ signal: 'Soc', response: zero }];
    const retry = vi.fn();
    const refetch = vi.fn(async () => {});
    const bundle: SignalEvidenceBundleResult = {
      data, sources: [{ signal: 'Soc', state: deriveDataState({ data: zero, dataUpdatedAt: 123456, refetch: retry }, { provenance: 'historical' }) }],
      isLoading: false, isFetching: false, isError: false, error: null, refetch,
    };
    mocks.bundle.mockReturnValue(bundle);
    const { result, rerender } = renderHook(() => useRootCauseWorkspace(7));
    act(() => result.current.setFocalSignal('Soc'));
    const analysis = result.current.analysis;
    const error = new Error('Soc refresh failed');
    const state = deriveDataState({ data: zero, dataUpdatedAt: 123456, error, refetch: retry }, { provenance: 'historical' });
    mocks.bundle.mockReturnValue({ ...bundle, sources: [{ signal: 'Soc', state }], isError: true, error });
    rerender();
    expect(result.current.analysis).toBe(analysis);
    expect(result.current.evidenceBundle.data).toBe(data);
    expect(result.current.evidenceBundle.sources[0].state.data).toBe(zero);
    expect(result.current.evidenceBundle.sources[0].state.updatedAt).toBe(123456);
    expect(result.current.evidenceBundle.sources[0].state.refreshError).toBe(error);
    expect(result.current.evidenceBundle.sources[0].state.fatalError).toBeNull();
    result.current.evidenceBundle.sources[0].state.retry?.();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
    expect(result.current.windowHours).toBe(72);
    expect(result.current.focalSignal).toBe('Soc');
  });
});
