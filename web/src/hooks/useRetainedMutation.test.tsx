import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { useRetainedMutation } from './useRetainedMutation';

interface Inputs {
  vehicle_id: number;
  scenarios: Array<{ distance_m: number; horizon_s: number }>;
}

interface Result {
  vehicle_id: number;
  energy_wh: number | null;
  generated_at: string;
  window: { start: string; end: string };
}

const vehicleScope = {
  data: (data: Result) => data.vehicle_id,
  inputs: (inputs: Inputs) => inputs.vehicle_id,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const requests: Array<ReturnType<typeof deferred<Result>>> = [];
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const initialProps: { vehicleId: number | null } = { vehicleId: 7 };
  const hook = renderHook(({ vehicleId }: { vehicleId: number | null }) => {
    const mutation = useMutation({
      mutationFn: (_inputs: Inputs) => {
        const request = deferred<Result>();
        requests.push(request);
        return request.promise;
      },
    });
    return { mutation, publication: useRetainedMutation(mutation, vehicleId, vehicleScope) };
  }, { wrapper, initialProps });
  return { ...hook, requests };
}

const inputs: Inputs = {
  vehicle_id: 7, scenarios: [{ distance_m: 50000, horizon_s: 3600 }],
};
const original: Result = {
  vehicle_id: 7, energy_wh: 0, generated_at: '2026-08-03T00:00:00Z',
  window: { start: '2026-08-01T00:00:00Z', end: '2026-08-03T00:00:00Z' },
};

describe('retained simulation publication using the real mutation observer', () => {
  it('keeps zero, SI inputs and original source metadata while the observer clears pending/error data', async () => {
    const hook = setup();
    expect(hook.result.current.publication.result).toBeUndefined();
    act(() => hook.result.current.mutation.mutate(structuredClone(inputs)));
    await waitFor(() => expect(hook.requests).toHaveLength(1));
    expect(hook.result.current.publication.pending).toBe(true);
    expect(hook.result.current.publication.result).toBeUndefined();
    act(() => hook.requests[0].resolve(original));
    await waitFor(() => expect(hook.result.current.publication.result).toBe(original));
    const published = hook.result.current.publication.published;
    expect(published?.inputs).toEqual(inputs);

    act(() => hook.result.current.mutation.mutate({
      vehicle_id: 7, scenarios: [{ distance_m: 90000, horizon_s: 7200 }],
    }));
    await waitFor(() => expect(hook.requests).toHaveLength(2));
    await waitFor(() => expect(hook.result.current.mutation.data).toBeUndefined());
    expect(hook.result.current.publication.published).toBe(published);
    expect(deriveDataState(hook.result.current.publication.source).isRefreshing).toBe(true);
    act(() => hook.requests[1].reject(new Error('recalculation unavailable')));
    await waitFor(() => expect(hook.result.current.mutation.isError).toBe(true));
    expect(hook.result.current.mutation.data).toBeUndefined();
    expect(hook.result.current.publication.published).toBe(published);
    const trust = deriveDataState(hook.result.current.publication.source);
    expect(trust.status).toBe('stale');
    expect(trust.refreshError?.message).toBe('recalculation unavailable');
    expect(trust.fatalError).toBeNull();
    expect(trust.data?.energy_wh).toBe(0);
    expect(trust.data?.window).toEqual(original.window);
    expect(trust.data?.generated_at).toBe(original.generated_at);
  });

  it('publishes a successful replacement atomically with its own submitted inputs and unknown value', async () => {
    const hook = setup();
    act(() => hook.result.current.mutation.mutate(inputs));
    await waitFor(() => expect(hook.requests).toHaveLength(1));
    act(() => hook.requests[0].resolve(original));
    await waitFor(() => expect(hook.result.current.publication.result).toBe(original));
    const nextInputs: Inputs = { vehicle_id: 7, scenarios: [{ distance_m: 0, horizon_s: 0 }] };
    const nextResult: Result = {
      ...original, energy_wh: null, generated_at: '2026-08-05T00:00:00Z',
      window: { start: '2026-08-04T00:00:00Z', end: '2026-08-05T00:00:00Z' },
    };
    act(() => hook.result.current.mutation.mutate(nextInputs));
    await waitFor(() => expect(hook.requests).toHaveLength(2));
    act(() => hook.requests[1].resolve(nextResult));
    await waitFor(() => expect(hook.result.current.publication.result).toBe(nextResult));
    expect(hook.result.current.publication.published?.inputs).toEqual(nextInputs);
    expect(hook.result.current.publication.published?.inputs).not.toBe(nextInputs);
    nextInputs.scenarios[0].distance_m = 123456;
    expect(hook.result.current.publication.published?.inputs?.scenarios[0].distance_m).toBe(0);
    expect(deriveDataState(hook.result.current.publication.source).status).toBe('ok');
  });

  it.each(['success', 'error'] as const)('detaches a pending prior vehicle and ignores late %s even after returning', async outcome => {
    const hook = setup();
    act(() => hook.result.current.mutation.mutate(inputs));
    await waitFor(() => expect(hook.requests).toHaveLength(1));
    act(() => hook.requests[0].resolve(original));
    await waitFor(() => expect(hook.result.current.publication.result).toBe(original));
    act(() => hook.result.current.mutation.mutate(inputs));
    await waitFor(() => expect(hook.requests).toHaveLength(2));
    hook.rerender({ vehicleId: 8 });
    expect(hook.result.current.publication.result).toBeUndefined();
    expect(hook.result.current.publication.pending).toBe(false);
    await waitFor(() => expect(hook.result.current.mutation.isIdle).toBe(true));
    hook.rerender({ vehicleId: 7 });
    expect(hook.result.current.publication.result).toBeUndefined();
    await act(async () => {
      if (outcome === 'success') hook.requests[1].resolve(original);
      else hook.requests[1].reject(new Error('old vehicle failed'));
      await hook.requests[1].promise.catch(() => undefined);
    });
    expect(hook.result.current.publication.result).toBeUndefined();
    expect(hook.result.current.publication.error).toBeNull();
    expect(hook.result.current.mutation.isIdle).toBe(true);
  });

  it('keeps initial failure separate from retained failure and clears deselected scope', async () => {
    const hook = setup();
    act(() => hook.result.current.mutation.mutate(inputs));
    await waitFor(() => expect(hook.requests).toHaveLength(1));
    act(() => hook.requests[0].reject(new Error('initial source unavailable')));
    await waitFor(() => expect(hook.result.current.mutation.isError).toBe(true));
    const trust = deriveDataState(hook.result.current.publication.source);
    expect(trust.status).toBe('initialFailure');
    expect(trust.fatalError?.message).toBe('initial source unavailable');
    hook.rerender({ vehicleId: null });
    expect(hook.result.current.publication.error).toBeNull();
    expect(hook.result.current.publication.result).toBeUndefined();
  });

  it('rejects a response for another vehicle rather than replacing the scoped publication', async () => {
    const hook = setup();
    act(() => hook.result.current.mutation.mutate(inputs));
    await waitFor(() => expect(hook.requests).toHaveLength(1));
    act(() => hook.requests[0].resolve({ ...original, vehicle_id: 8 }));
    await waitFor(() => expect(hook.result.current.mutation.isSuccess).toBe(true));
    expect(hook.result.current.publication.result).toBeUndefined();
  });

  it('publishes only the newly selected vehicle after detaching the prior observer', async () => {
    const hook = setup();
    act(() => hook.result.current.mutation.mutate(inputs));
    await waitFor(() => expect(hook.requests).toHaveLength(1));
    act(() => hook.requests[0].resolve(original));
    await waitFor(() => expect(hook.result.current.publication.result).toBe(original));
    hook.rerender({ vehicleId: 8 });
    const selectedInputs: Inputs = {
      vehicle_id: 8, scenarios: [{ distance_m: 80000, horizon_s: 7200 }],
    };
    const selectedResult: Result = {
      ...original, vehicle_id: 8, energy_wh: 15000,
      generated_at: '2026-08-06T00:00:00Z',
    };
    act(() => hook.result.current.mutation.mutate(selectedInputs));
    await waitFor(() => expect(hook.requests).toHaveLength(2));
    expect(hook.result.current.publication.result).toBeUndefined();
    act(() => hook.requests[1].resolve(selectedResult));
    await waitFor(() => expect(hook.result.current.publication.result).toBe(selectedResult));
    expect(hook.result.current.publication.published?.inputs).toEqual(selectedInputs);
    hook.rerender({ vehicleId: null });
    expect(hook.result.current.publication.result).toBeUndefined();
    expect(hook.result.current.publication.pending).toBe(false);
  });

  it('marks retained publication stale when a recalculation is paused, without a fresh measurement', () => {
    const hook = renderHook(({ pending, paused }) => useRetainedMutation({
      data: pending ? undefined : original,
      variables: inputs,
      isPending: pending,
      isPaused: paused,
      error: null,
    }, 7, vehicleScope), { initialProps: { pending: false, paused: false } });
    hook.rerender({ pending: true, paused: true });
    const trust = deriveDataState(hook.result.current.source);
    expect(trust.data).toBe(original);
    expect(trust.status).toBe('stale');
    expect(trust.isRefreshBlocked).toBe(true);
    expect(trust.isRefreshing).toBe(false);
  });

  it('snapshots submitted inputs before a pending request completes', async () => {
    const hook = setup();
    const submitted = structuredClone(inputs);
    act(() => hook.result.current.mutation.mutate(submitted));
    await waitFor(() => expect(hook.requests).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.publication.pending).toBe(true));
    submitted.scenarios[0].distance_m = 999999;
    act(() => hook.requests[0].resolve(original));
    await waitFor(() => expect(hook.result.current.publication.result).toBe(original));
    expect(hook.result.current.publication.published?.inputs).toEqual(inputs);
    expect(hook.result.current.publication.result?.window).toEqual(original.window);
  });

  it('replaces input metadata even when the successful server reply reuses its object', async () => {
    const hook = setup();
    act(() => hook.result.current.mutation.mutate(inputs));
    await waitFor(() => expect(hook.requests).toHaveLength(1));
    act(() => hook.requests[0].resolve(original));
    await waitFor(() => expect(hook.result.current.publication.result).toBe(original));
    const firstPublication = hook.result.current.publication.published;
    const replacement: Inputs = { vehicle_id: 7, scenarios: [{ distance_m: 123, horizon_s: 456 }] };
    act(() => hook.result.current.mutation.mutate(replacement));
    await waitFor(() => expect(hook.requests).toHaveLength(2));
    expect(hook.result.current.publication.published).toBe(firstPublication);
    act(() => hook.requests[1].resolve(original));
    await waitFor(() => expect(hook.result.current.publication.published?.inputs).toEqual(replacement));
    expect(hook.result.current.publication.published).not.toBe(firstPublication);
  });

  it('supports non-vehicle string scopes without interpreting or converting the raw payload', () => {
    interface Request { site: string; power_w: number }
    interface Response { site: string; energy_wh: number; provenance: string }
    const variables: Request = { site: 'north', power_w: 0 };
    const data: Response = { site: 'north', energy_wh: 0, provenance: 'returned site model' };
    const initialProps: { selected: string | null; pending: boolean } = {
      selected: 'north', pending: false,
    };
    const hook = renderHook(({ selected, pending }) => useRetainedMutation({
      data: pending ? undefined : data, variables, isPending: pending, error: null,
    }, selected, {
      data: (response) => response.site,
      inputs: (request) => request.site,
    }), { initialProps });
    expect(hook.result.current.result).toBe(data);
    hook.rerender({ selected: 'north', pending: true });
    expect(hook.result.current.result).toBe(data);
    expect(hook.result.current.published?.inputs).toEqual(variables);
    hook.rerender({ selected: 'south', pending: true });
    expect(hook.result.current.result).toBeUndefined();
    expect(hook.result.current.pending).toBe(false);
    hook.rerender({ selected: null, pending: false });
    expect(hook.result.current.result).toBeUndefined();
  });

  it('retains the current publication when a matching request returns another scope', async () => {
    const hook = setup();
    act(() => hook.result.current.mutation.mutate(inputs));
    await waitFor(() => expect(hook.requests).toHaveLength(1));
    act(() => hook.requests[0].resolve(original));
    await waitFor(() => expect(hook.result.current.publication.result).toBe(original));
    const published = hook.result.current.publication.published;
    act(() => hook.result.current.mutation.mutate({
      vehicle_id: 7, scenarios: [{ distance_m: 1, horizon_s: 1 }],
    }));
    await waitFor(() => expect(hook.requests).toHaveLength(2));
    act(() => hook.requests[1].resolve({ ...original, vehicle_id: 8 }));
    await waitFor(() => expect(hook.result.current.mutation.isSuccess).toBe(true));
    expect(hook.result.current.publication.published).toBe(published);
  });
});
