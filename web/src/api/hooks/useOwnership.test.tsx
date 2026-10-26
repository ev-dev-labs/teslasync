import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationalModeWriteError } from '@/lib/operationalMode';
import type { CreateClaimRequest, CreateWarrantyRequest } from '@/types/ownership';
import {
  ownershipKeys,
  useCreateWarranty,
  useCreateWarrantyClaim,
  useDeleteWarranty,
  useRetentionRuns,
  useInsuranceRiskProfile,
  useSimulateGovernance,
  useWarranties,
} from './useOwnership';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('./_toastHelpers', () => ({ useMutationToast: () => toast }));

const coverage: CreateWarrantyRequest = {
  vehicle_id: 7,
  kind: 'basic',
  label: 'Basic coverage',
  provider: 'Tesla',
  start_at: '2026-10-01T00:00:00Z',
  start_odometer_m: 1000,
  term_s: 126144000,
  term_distance_m: 80000,
  capacity_floor_pct: null,
  deductible_minor: 0,
  currency: 'USD',
  notes: 'Registered coverage',
};
const claim: CreateClaimRequest = {
  warranty_id: 12,
  title: 'Repair claim',
  status: 'draft',
  amount_minor: 12000,
  evidence_note: 'Service invoice',
  confirmed: true,
};
const warranty = { ...coverage, id: 12, version: 1, created_at: coverage.start_at, updated_at: coverage.start_at };
const recordedClaim = { ...claim, id: 22, opened_at: coverage.start_at, closed_at: null };
const cases = [
  { name: 'create', path: '/warranty-command/warranties', method: 'POST', body: coverage,
    response: warranty, success: 'ownership.warranty.toast.created', error: 'ownership.warranty.toast.error' },
  { name: 'delete', path: '/warranty-command/warranties/12', method: 'DELETE', body: undefined,
    response: undefined, success: 'ownership.warranty.toast.deleted', error: 'ownership.warranty.toast.deleteError' },
  { name: 'claim', path: '/warranty-command/claims', method: 'POST', body: claim,
    response: recordedClaim, success: 'ownership.warranty.toast.claimed', error: 'ownership.warranty.toast.claimError' },
] as const;

describe('governance run-cache invalidation', () => {
    const matchingKeys = [
      ownershipKeys.governanceRuns(25, 0),
      ownershipKeys.governanceRuns(50, 0),
      ownershipKeys.governanceRuns(50, 50),
    ];
    const unrelatedKeys = [
      ownershipKeys.governance(),
      ownershipKeys.tariffs(25, 0),
      ['other-domain', 'governance-runs', 50, 0] as const,
    ];
    const page = { items: [], total: 0, limit: 50, offset: 50 };
    const body = { datasets: ['signal_log'], confirmed: true };

    function makeGovernanceHarness() {
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Infinity },
          mutations: { retry: false },
        },
      });
      for (const key of [...matchingKeys, ...unrelatedKeys]) {
        client.setQueryData(key, page);
      }
      function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
      }
      return { client, Wrapper };
    }

    it('invalidates all run pages after success and preserves unrelated entries', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ plan_only: true }), {
        headers: { 'Content-Type': 'application/json' },
      }));
      const { client, Wrapper } = makeGovernanceHarness();
      const { result, unmount } = renderHook(() => useSimulateGovernance(), { wrapper: Wrapper });

      await act(async () => { await result.current.mutateAsync(body); });

      for (const key of matchingKeys) {
        expect(client.getQueryState(key)?.isInvalidated).toBe(true);
        expect(client.getQueryData(key)).toEqual(page);
      }
      for (const key of unrelatedKeys) {
        expect(client.getQueryState(key)?.isInvalidated).toBe(false);
        expect(client.getQueryData(key)).toEqual(page);
      }
      expect(toast.success).toHaveBeenCalledWith(
        'ownership.governance.toast.simulated', 'Dry run complete',
      );
      expect(toast.error).not.toHaveBeenCalled();
      unmount();
      client.clear();
    });

    it('refetches the mounted non-default run page after recording a plan', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ plan_only: true }), {
          headers: { 'Content-Type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ...page, total: 1 }), {
          headers: { 'Content-Type': 'application/json' },
        }));
      const { client, Wrapper } = makeGovernanceHarness();
      const { result, unmount } = renderHook(() => ({
        runs: useRetentionRuns(50, 50),
        simulate: useSimulateGovernance(),
      }), { wrapper: Wrapper });
      expect(result.current.runs.data).toEqual(page);
      expect(fetchMock).not.toHaveBeenCalled();

      await act(async () => { await result.current.simulate.mutateAsync(body); });

      await waitFor(() => expect(result.current.runs.data?.total).toBe(1));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(1,
        expect.stringContaining('/data-governance/simulate'),
        expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(2,
        expect.stringContaining('/data-governance/runs?limit=50&offset=50'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      for (const key of unrelatedKeys) {
        expect(client.getQueryState(key)?.isInvalidated).toBe(false);
        expect(client.getQueryData(key)).toEqual(page);
      }
      unmount();
      client.clear();
    });

    it('preserves cached pages and does not refetch mounted readers on failure', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Plan recording failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }));
      const { client, Wrapper } = makeGovernanceHarness();
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      const { result, unmount } = renderHook(() => ({
        runs: useRetentionRuns(50, 50),
        simulate: useSimulateGovernance(),
      }), { wrapper: Wrapper });

      await act(async () => {
        await expect(result.current.simulate.mutateAsync(body)).rejects.toThrow('Plan recording failed');
      });

      expect(invalidate).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      for (const key of [...matchingKeys, ...unrelatedKeys]) {
        expect(client.getQueryState(key)?.isInvalidated).toBe(false);
        expect(client.getQueryData(key)).toEqual(page);
      }
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        expect.any(Error), 'ownership.governance.toast.simulateError', 'Dry run failed',
      );
      unmount();
      client.clear();
    });
});

function makeHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 3 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const hook = renderHook(() => ({
    create: useCreateWarranty(),
    delete: useDeleteWarranty(),
    claim: useCreateWarrantyClaim(),
  }), { wrapper: Wrapper });
  function submit(name: typeof cases[number]['name']) {
    if (name === 'create') return hook.result.current.create.mutateAsync(coverage);
    if (name === 'delete') return hook.result.current.delete.mutateAsync(12);
    return hook.result.current.claim.mutateAsync(claim);
  }
  return { ...hook, client, Wrapper, submit };
}

const fetchMock = vi.fn<typeof fetch>();

describe('insurance selected-clock query ownership', () => {
  it('keys and sends the effective clock without changing the rolling window', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ factors: [] }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const view = renderHook(({ timezone }) => useInsuranceRiskProfile(7, 90, timezone), {
      initialProps: { timezone: 'UTC' }, wrapper: Wrapper,
    });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    view.rerender({ timezone: 'America/Los_Angeles' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    for (const [index, zone] of ['UTC', 'America/Los_Angeles'].entries()) {
      const url = new URL(String(fetchMock.mock.calls[index]?.[0]), window.location.origin);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        vehicle_id: '7', window_days: '90', timezone: zone,
      });
      expect(client.getQueryData(ownershipKeys.insurance(7, 90, zone))).toBeDefined();
    }
    view.unmount();
    client.clear();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  onlineManager.setOnline(true);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  onlineManager.setOnline(true);
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('warranty commands', () => {
  for (const command of cases) {
    for (const mode of ['cached', 'as_of'] as const) {
      it(`${command.name} fails immediately in ${mode} mode with the existing explanation and no replay`, async () => {
        if (mode === 'cached') {
          vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
          onlineManager.setOnline(false);
        } else {
          window.history.replaceState(null, '', '/?as_of=2026-10-01T00:00:00Z');
        }
        const { result, client, submit } = makeHarness();
        const invalidate = vi.spyOn(client, 'invalidateQueries');
        const expected = new OperationalModeWriteError(mode);
        await act(async () => {
          await expect(submit(command.name)).rejects.toThrow(expected.message);
        });
        await waitFor(() => expect(result.current[command.name].isError).toBe(true));
        expect(result.current[command.name].isPaused).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(
          expect.objectContaining({ code: expected.code, mode, message: expected.message }),
          command.error,
          expect.any(String),
        );
        expect(fetchMock).not.toHaveBeenCalled();
        expect(invalidate).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
        await act(async () => {
          window.history.replaceState(null, '', '/');
          vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
          onlineManager.setOnline(true);
          await client.resumePausedMutations();
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(client.getMutationCache().getAll()[0].options.retry).toBe(false);
        client.clear();
      });
    }

    it(`${command.name} preserves the live request, response, success feedback and invalidation`, async () => {
      fetchMock.mockResolvedValue(new Response(
        command.response === undefined ? null : JSON.stringify(command.response),
        { status: command.response === undefined ? 204 : 200, headers: { 'Content-Type': 'application/json' } },
      ));
      const { client, submit } = makeHarness();
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      await act(async () => {
        const response = await submit(command.name);
        if (command.response !== undefined) expect(response).toMatchObject(command.response);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(command.path),
        expect.objectContaining({
          method: command.method,
          ...(command.body ? { body: JSON.stringify(command.body) } : {}),
        }),
      );
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ownershipKeys.all });
      expect(toast.success).toHaveBeenCalledWith(command.success, expect.any(String));
      expect(toast.error).not.toHaveBeenCalled();
      client.clear();
    });
  }

  it('preserves populated vehicle-scoped coverage reads', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [warranty], total: 1 }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const { client, Wrapper } = makeHarness();
    const { result } = renderHook(() => useWarranties(7), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toMatchObject([warranty]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/warranty-command/warranties?vehicle_id=7'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    client.clear();
  });
});
