import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import type { SignalEvidenceBundleResult } from '@/api/hooks/useTelemetry';
import type { SignalHistoryResponse } from '@/types/telemetry';
import * as rootCauseIntelligence from '../lib/rootCauseIntelligence';
import { useRootCauseWorkspace } from './useRootCauseWorkspace';

const mocks = vi.hoisted(() => ({ bundle: vi.fn(), catalog: vi.fn() }));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalEvidenceBundle: mocks.bundle,
  useSignals: mocks.catalog,
}));

function response(signal: string, value: SignalHistoryResponse['data'][number]['value'] = 0): SignalHistoryResponse {
  const data: SignalHistoryResponse['data'] = Array.from({ length: 48 }, (_, index) => ({
    ts: new Date(Date.UTC(2026, 9, 6, 0, index)).toISOString(),
    kind: typeof value === 'number' ? 'ValueKindDouble'
      : typeof value === 'string' ? 'ValueKindString'
        : typeof value === 'boolean' ? 'ValueKindBoolean' : 'ValueKindUnknown',
    value,
    ingest_origin: null,
    source_emitted_at: null,
    received_at: null,
    normalization_version: null,
  }));
  return { vehicleId: 7, signal, from: data[0].ts, to: data[47].ts, count: data.length, data };
}

beforeEach(() => {
  vi.spyOn(rootCauseIntelligence, 'analyzeRootCause');
  mocks.catalog.mockReturnValue({ data: ['Soc', 'PackVoltage', 'PackTemperature'], refetch: vi.fn() });
  mocks.bundle.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('root-cause workspace complete source preservation', () => {
  it('retains normalized source order and measured zero analysis alongside pending, initial failure and empty histories', () => {
    const zero = response('Soc');
    const empty: SignalHistoryResponse = { ...response('PackVoltage'), count: 0, data: [] };
    const bundle: SignalEvidenceBundleResult = {
      data: [{ signal: 'Soc', response: zero }, { signal: 'PackVoltage', response: empty }, { signal: 'Gear', response: response('Gear', 'Park') }],
      sources: [
        { signal: 'Soc', state: deriveDataState({ data: zero }, { provenance: 'historical' }) },
        { signal: 'PackTemperature', state: deriveDataState<SignalHistoryResponse>({ isPending: true }) },
        { signal: 'Current', state: deriveDataState<SignalHistoryResponse>({ error: new Error('Current failed') }) },
        { signal: 'PackVoltage', state: deriveDataState({ data: empty }, { provenance: 'historical', unavailable: true }) },
        { signal: 'Gear', state: deriveDataState({ data: response('Gear', 'Park') }, { provenance: 'historical' }) },
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
    expect(rootCauseIntelligence.analyzeRootCause).toHaveBeenLastCalledWith({
      focalSignal: 'Soc',
      catalog: ['Soc', 'PackVoltage', 'PackTemperature'],
      focalPoints: zero.data.map(point => ({ ts: point.ts, value: 0 })),
      relatedSeries: [
        { signal: 'PackVoltage', points: [] },
        { signal: 'Gear', points: bundle.data[2].response.data.map(point => ({ ts: point.ts, value: 'Park' })) },
      ],
    });
    expect(result.current.evidenceBundle.sources[1].state.status).toBe('initial');
    expect(result.current.evidenceBundle.sources[2].state.status).toBe('initialFailure');
    expect(result.current.evidenceBundle.sources[3].state.status).toBe('unavailable');
    expect(result.current.evidenceBundle.sources[4].state.status).toBe('ok');
    expect(mocks.bundle).toHaveBeenLastCalledWith(7, [
      'Soc', ...result.current.relatedCandidates.map(candidate => candidate.signal),
    ], 72);
  });

  it('excludes booleans only from analysis while retaining raw values and ordering for evidence export', () => {
    const raw = response('Soc');
    const values: SignalHistoryResponse['data'][number]['value'][] = [false, 0, '0', true, null];
    raw.data = raw.data.slice(0, values.length).reverse().map((point, index) => ({
      ...point,
      value: values[index],
      kind: typeof values[index] === 'boolean' ? 'ValueKindBoolean'
        : typeof values[index] === 'string' ? 'ValueKindString'
          : values[index] === null ? 'ValueKindUnknown' : 'ValueKindDouble',
    }));
    raw.count = raw.data.length;
    raw.from = raw.data[raw.data.length - 1].ts;
    raw.to = raw.data[0].ts;
    const gear = response('Gear', 'Park');
    const rawPayload = JSON.stringify([raw, gear]);
    const bundle: SignalEvidenceBundleResult = {
      data: [{ signal: 'Gear', response: gear }, { signal: 'Soc', response: raw }],
      sources: [
        { signal: 'Soc', state: deriveDataState({ data: raw }, { provenance: 'historical' }) },
        { signal: 'Gear', state: deriveDataState({ data: gear }, { provenance: 'historical' }) },
      ],
      isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn(async () => {}),
    };
    mocks.bundle.mockReturnValue(bundle);
    const { result } = renderHook(() => useRootCauseWorkspace(7));
    act(() => result.current.setFocalSignal('Soc'));
    expect(rootCauseIntelligence.analyzeRootCause).toHaveBeenLastCalledWith({
      focalSignal: 'Soc',
      catalog: ['Soc', 'PackVoltage', 'PackTemperature'],
      focalPoints: [
        { ts: raw.data[0].ts, value: null },
        { ts: raw.data[1].ts, value: 0 },
        { ts: raw.data[2].ts, value: '0' },
        { ts: raw.data[3].ts, value: null },
        { ts: raw.data[4].ts, value: null },
      ],
      relatedSeries: [{ signal: 'Gear', points: gear.data.map(point => ({ ts: point.ts, value: 'Park' })) }],
    });
    expect(result.current.analysis.quality.focalSampleCount).toBe(2);
    expect(result.current.evidenceBundle).toBe(bundle);
    expect(result.current.evidenceBundle.data).toBe(bundle.data);
    expect(result.current.evidenceBundle.data.map(entry => entry.signal)).toEqual(['Gear', 'Soc']);
    expect(result.current.evidenceBundle.sources.map(source => source.signal)).toEqual(['Soc', 'Gear']);
    expect(result.current.evidenceBundle.sources[0].state.data).toBe(raw);
    expect(result.current.evidenceBundle.data[1].response.data.map(point => point.value)).toEqual(values);
    expect(JSON.stringify([
      result.current.evidenceBundle.data[1].response,
      result.current.evidenceBundle.data[0].response,
    ])).toBe(rawPayload);
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
