import { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../client', () => ({ request: vi.fn() }));
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { request } from '../client';
import {
  advancedIntelligenceKeys,
  useBehavioralSentinel,
  useCausalExperiments,
  useChargingForensics,
  useComponentSurvival,
  useCreateCausalExperiment,
  useCreateResiliencePlan,
  useFederatedModelCards,
  useFirmwareCanary,
  useRoadHazards,
  useRunChargingSiteTwin,
  useRunJourneyAssurance,
  useRunTCOOptimizer,
  useRunTwinLab,
  useStartFederatedRound,
} from './useAdvancedIntelligence';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, Wrapper };
}

beforeEach(() => mockedRequest.mockReset());

describe('advanced intelligence reads', () => {
  const reads = [
    [useFirmwareCanary, 'firmware-canary'],
    [useComponentSurvival, 'component-survival'],
    [useRoadHazards, 'road-hazards'],
    [useBehavioralSentinel, 'behavioral-sentinel'],
    [useChargingForensics, 'charging-forensics'],
    [useFederatedModelCards, 'federated-learning/model-cards'],
    [useCausalExperiments, 'causal-experiments'],
  ] as const;

  it.each(reads)('calls %s with exact snake_case paging params', async (hook, path) => {
    mockedRequest.mockResolvedValueOnce({ items: [], total: 0, limit: 9, offset: 18 });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => hook(42, 9, 18), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledWith(
      `/advanced-intelligence/${path}?vehicle_id=42&limit=9&offset=18`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockedRequest.mock.calls[0]?.[0]).not.toContain('/api/v1');
  });

  it('has stable parameterized keys and stays idle without a vehicle', () => {
    expect(advancedIntelligenceKeys.roadHazards(7, 25, 0)).toEqual(
      ['advanced-intelligence', 'road-hazards', 7, 25, 0],
    );
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useRoadHazards(null), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('advanced intelligence writes', () => {
  const writes = [
    [useRunTwinLab, 'twin-lab/scenarios', false],
    [useRunJourneyAssurance, 'journey-assurance/scenarios', false],
    [useRunChargingSiteTwin, 'charging-site-twin/scenarios', false],
    [useCreateResiliencePlan, 'resilience/plans', false],
    [useRunTCOOptimizer, 'tco-optimizer/scenarios', false],
    [useStartFederatedRound, 'federated-learning/rounds', true],
    [useCreateCausalExperiment, 'causal-experiments', false],
  ] as const;

  it.each(writes)(
    'POSTs %s with the exact body and operational-mode policy',
    async (hook, path, requiresLiveMode) => {
      mockedRequest.mockResolvedValueOnce({});
      const { Wrapper } = wrapper();
      const { result } = renderHook(() => hook(), { wrapper: Wrapper });
      const body = { vehicle_id: 42, confirmed: true };
      await act(() => result.current.mutateAsync(body as never));
      const expectedOptions = {
        method: 'POST',
        ...(requiresLiveMode ? { requiresLiveMode: true } : {}),
        body: JSON.stringify(body),
      };
      expect(mockedRequest).toHaveBeenCalledWith(
        `/advanced-intelligence/${path}`,
        expectedOptions,
      );
      expect(mockedRequest.mock.calls[0]?.[0]).not.toContain('/api/v1');
    },
  );

  it('invalidates federated and causal reads after writes', async () => {
    mockedRequest.mockResolvedValue({});
    const { client, Wrapper } = wrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const federated = renderHook(() => useStartFederatedRound(), { wrapper: Wrapper });
    await act(() => federated.result.current.mutateAsync({
      vehicle_id: 42, model_name: 'local', model_version: 'v1', task: 'efficiency',
      epsilon: 0.1, epsilon_budget: 2, expected_version: 0, confirmed: true,
    }));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['advanced-intelligence', 'federated-learning'],
    });

    const causal = renderHook(() => useCreateCausalExperiment(), { wrapper: Wrapper });
    await act(() => causal.result.current.mutateAsync({
      vehicle_id: 42, intervention_kind: 'charging_schedule',
      metric: 'charging_success_pct', baseline_start: '2026-01-01T00:00:00Z',
      baseline_end: '2026-01-02T00:00:00Z', treatment_start: '2026-01-03T00:00:00Z',
      treatment_end: '2026-01-04T00:00:00Z', confirmed: true,
    }));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['advanced-intelligence', 'causal-experiments'],
    });
  });
});
