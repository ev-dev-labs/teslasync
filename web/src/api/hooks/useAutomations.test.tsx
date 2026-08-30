// Behavioural coverage for the `useAutomations` domain hooks.
//
// Every export is exercised through its real call site: query-key factories,
// list/detail/history reads, the import envelope POST, optimistic toggle
// (including the object-shaped-sibling-cache guard), re-enable, delete, bulk
// ops, test-run, full create/update, and the preset reads (with query-param /
// path-segment encoding).
//
// Network is mocked at the `request` boundary (the repo convention — see
// useAlerts.test.tsx / __tests__/useNotifications.test.tsx). Toast + cross-tab
// broadcast are mocked so we can assert i18n keys and invalidation targets
// without a live Toast/BroadcastChannel bus.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  automationKeys,
  presetKeys,
  useAutomations,
  useAutomationHistory,
  useImportAutomations,
  useToggleAutomation,
  useReEnableAutomation,
  useDeleteAutomation,
  useBulkAutomationsUpdate,
  useTestRunAutomation,
  useAutomation,
  useCreateAutomationFull,
  useUpdateAutomationFull,
  useAutomationPresets,
  useAutomationPreset,
  type AutomationFullInput,
  type AutomationImportEnvelope,
} from './useAutomations';
import type {
  Automation,
  AutomationFull,
  AutomationHistoryListResponse,
  AutomationPreset,
  AutomationPresetsResponse,
} from '@/api/types';

// ── Mocks ─────────────────────────────────────────────────────────────────
// Hoisted so the (also-hoisted) mock factories close over the same spy
// instances the assertions later read.
const { requestMock, toastSuccess, toastError, invalidateSpy } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidateSpy: vi.fn(),
}));

vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toastSuccess, error: toastError }),
}));

// Mock the cross-tab invalidation helper so mutation invalidations are
// observable AND deterministic (no 50ms coalesce timer leaking a
// BroadcastChannel post into the next test). `useOptimisticMutation` also
// routes its broadcast:true settle through this symbol, so the toggle test
// can assert on it too.
vi.mock('@/lib/queryBroadcast', () => ({
  invalidateAndBroadcast: (...args: unknown[]) => invalidateSpy(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** URL string the mocked `request` was called with on invocation `i`. */
function calledUrl(i = 0): string {
  return requestMock.mock.calls[i]?.[0] as string;
}
/** RequestInit the mocked `request` was called with on invocation `i`. */
function calledOpts(i = 0): RequestInit {
  return requestMock.mock.calls[i]?.[1] as RequestInit;
}

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 1,
    name: 'Nightly precondition',
    description: null,
    enabled: true,
    vehicle_id: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    stop_on_failure: false,
    notify_on_run: false,
    notify_on_failure: false,
    seasonal_start: null,
    seasonal_end: null,
    last_triggered_at: null,
    last_success_at: null,
    last_failure_at: null,
    execution_count: 0,
    failure_count: 0,
    consecutive_failures: 0,
    auto_disabled: false,
    auto_disabled_reason: null,
    preset_id: null,
    ...overrides,
    // The `RemovedAutomationRootCompatibility` mapped type makes several
    // keys `never`; a plain object literal can't satisfy it, so cast.
  } as Automation;
}

function makeHistoryResponse(
  overrides: Partial<AutomationHistoryListResponse> = {},
): AutomationHistoryListResponse {
  return {
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
    summary: {
      total_executions: 0,
      succeeded: 0,
      failed: 0,
      partial: 0,
      success_rate: 0,
      avg_duration_ms: 0,
    },
    ...overrides,
  };
}

const validFullInput: AutomationFullInput = {
  name: 'Charge to 80% overnight',
  description: 'Weeknights',
  vehicle_id: 12,
  enabled: true,
  triggers: [],
  conditions: [],
  actions: [],
};

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  invalidateSpy.mockReset();
});

// ── Query-key factories ──────────────────────────────────────────────────────
describe('automationKeys', () => {
  it('produces stable, parameterised key tuples', () => {
    expect(automationKeys.all).toEqual(['automations']);
    expect(automationKeys.detail(7)).toEqual(['automations', 7]);
    expect(automationKeys.history(50)).toEqual(['automation-history', 50]);
    expect(automationKeys.history()).toEqual(['automation-history', undefined]);
  });
});

describe('presetKeys', () => {
  it('produces stable preset key tuples', () => {
    expect(presetKeys.all).toEqual(['automation-presets']);
    expect(presetKeys.category('comfort')).toEqual(['automation-presets', 'comfort']);
    expect(presetKeys.detail('warm-up')).toEqual(['automation-preset', 'warm-up']);
  });
});

// ── Reads ────────────────────────────────────────────────────────────────────
describe('useAutomations', () => {
  it('GETs /automations, threads the AbortSignal, and surfaces the array', async () => {
    requestMock.mockResolvedValueOnce([makeAutomation({ id: 1 }), makeAutomation({ id: 2 })]);
    const { result } = renderHook(() => useAutomations(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/automations');
    expect(calledOpts()).toHaveProperty('signal');
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].id).toBe(1);
  });

  it('coerces a non-array payload to [] via the safeArray select', async () => {
    requestMock.mockResolvedValueOnce(null as unknown as Automation[]);
    const { result } = renderHook(() => useAutomations(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useAutomationHistory', () => {
  it('defaults to limit=20 and returns the envelope', async () => {
    const payload = makeHistoryResponse({ total: 3, limit: 20 });
    requestMock.mockResolvedValueOnce(payload);
    const { result } = renderHook(() => useAutomationHistory(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/automations/history?limit=20');
    expect(result.current.data?.total).toBe(3);
  });

  it('honours a caller-supplied limit', async () => {
    requestMock.mockResolvedValueOnce(makeHistoryResponse({ limit: 5 }));
    renderHook(() => useAutomationHistory(5), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(calledUrl()).toBe('/automations/history?limit=5');
  });

  it('surfaces request failures as isError', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useAutomationHistory(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ── Import ───────────────────────────────────────────────────────────────────
describe('useImportAutomations', () => {
  const envelope: AutomationImportEnvelope = {
    version: 1,
    exported_at: '2025-05-01T00:00:00Z',
    automations: [{ name: 'x' }],
  };

  it('POSTs the envelope, invalidates list + history, and toasts success', async () => {
    requestMock.mockResolvedValueOnce({ imported: 1, skipped: 0 });
    const client = makeClient();
    const { result } = renderHook(() => useImportAutomations(), { wrapper: wrapperFor(client) });

    let out: { imported?: number } | undefined;
    await act(async () => {
      out = await result.current.mutateAsync(envelope);
    });

    expect(calledUrl()).toBe('/automations/import');
    expect(calledOpts().method).toBe('POST');
    expect(calledOpts().requiresLiveMode).toBe(true);
    expect(JSON.parse(calledOpts().body as string)).toEqual(envelope);
    expect(out?.imported).toBe(1);

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[1]));
    expect(keys).toContain(JSON.stringify({ queryKey: automationKeys.all }));
    expect(keys).toContain(JSON.stringify({ queryKey: ['automation-history'] }));
    expect(toastSuccess).toHaveBeenCalledWith('toast.automation.import.success', 'Automations imported');
  });

  it('toasts an error and rejects when the import fails', async () => {
    const boom = new Error('HTTP 422');
    requestMock.mockRejectedValueOnce(boom);
    const { result } = renderHook(() => useImportAutomations(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await expect(result.current.mutateAsync(envelope)).rejects.toThrow('HTTP 422');
    });
    expect(toastError).toHaveBeenCalledWith(boom, 'toast.automation.import.error', 'Failed to import automations');
  });
});

// ── Toggle (optimistic) ──────────────────────────────────────────────────────
describe('useToggleAutomation', () => {
  it('PATCHes /automations/{id}/toggle, optimistically flips enabled, and toasts the disabled key', async () => {
    requestMock.mockResolvedValueOnce({ id: 1, enabled: false });
    const client = makeClient();
    client.setQueryData(automationKeys.all, [makeAutomation({ id: 1, enabled: true })]);

    const { result } = renderHook(() => useToggleAutomation(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync({ id: 1, enabled: false });
    });

    expect(calledUrl()).toBe('/automations/1/toggle');
    expect(calledOpts().method).toBe('PATCH');
    expect(calledOpts().requiresLiveMode).toBe(true);
    expect(calledOpts().body).toBe(JSON.stringify({ enabled: false }));
    const cached = client.getQueryData<Automation[]>(automationKeys.all) ?? [];
    expect(cached[0]?.enabled).toBe(false);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.automation.disabled', 'Automation disabled'),
    );
  });

  it('toasts the enabled key when flipping an automation on', async () => {
    requestMock.mockResolvedValueOnce({ id: 1, enabled: true });
    const client = makeClient();
    client.setQueryData(automationKeys.all, [makeAutomation({ id: 1, enabled: false })]);

    const { result } = renderHook(() => useToggleAutomation(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync({ id: 1, enabled: true });
    });

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.automation.enabled', 'Automation enabled'),
    );
  });

  it('leaves the object-shaped detail cache under the automations prefix untouched (no prev.map crash)', async () => {
    // Regression guard: `getQueriesData({ queryKey: ['automations'] })` also
    // matches the `['automations', id]` detail cache, whose payload is a
    // single AutomationFull object. Without the Array.isArray guard the
    // optimistic updater would call `.map` on that object and throw.
    requestMock.mockResolvedValueOnce({ id: 1, enabled: false });
    const client = makeClient();
    const detail = { ...makeAutomation({ id: 1, enabled: true }), triggers: [], conditions: [], actions: [] } as AutomationFull;
    client.setQueryData(automationKeys.all, [makeAutomation({ id: 1, enabled: true })]);
    client.setQueryData(automationKeys.detail(1), detail);

    const { result } = renderHook(() => useToggleAutomation(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync({ id: 1, enabled: false });
    });

    // Mutation succeeded (didn't throw) and the object cache is returned as-is.
    expect(result.current.isError).toBe(false);
    expect(client.getQueryData(automationKeys.detail(1))).toBe(detail);
    const list = client.getQueryData<Automation[]>(automationKeys.all) ?? [];
    expect(list[0]?.enabled).toBe(false);
  });

  it('rolls the optimistic write back and toasts an error when the PATCH fails', async () => {
    const boom = new Error('HTTP 500');
    requestMock.mockRejectedValueOnce(boom);
    const client = makeClient();
    client.setQueryData(automationKeys.all, [makeAutomation({ id: 1, enabled: true })]);

    const { result } = renderHook(() => useToggleAutomation(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync({ id: 1, enabled: false }).catch(() => undefined);
    });

    const cached = client.getQueryData<Automation[]>(automationKeys.all) ?? [];
    expect(cached[0]?.enabled).toBe(true);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]?.[0]).toBe(boom);
  });
});

// ── Re-enable / delete ───────────────────────────────────────────────────────
describe('useReEnableAutomation', () => {
  it('PATCHes /automations/{id}/re-enable, invalidates the list, and toasts success', async () => {
    requestMock.mockResolvedValueOnce({ id: 4, enabled: true, auto_disabled: false });
    const { result } = renderHook(() => useReEnableAutomation(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync(4);
    });

    expect(calledUrl()).toBe('/automations/4/re-enable');
    expect(calledOpts().method).toBe('PATCH');
    expect(calledOpts().requiresLiveMode).toBe(true);
    expect(invalidateSpy).toHaveBeenCalledWith(expect.anything(), { queryKey: automationKeys.all });
    expect(toastSuccess).toHaveBeenCalledWith('toast.automation.reEnable.success', 'Automation re-enabled');
  });

  it('toasts an error when re-enable fails', async () => {
    const boom = new Error('nope');
    requestMock.mockRejectedValueOnce(boom);
    const { result } = renderHook(() => useReEnableAutomation(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync(4).catch(() => undefined);
    });
    expect(toastError).toHaveBeenCalledWith(boom, 'toast.automation.reEnable.error', 'Failed to re-enable automation');
  });
});

describe('useDeleteAutomation', () => {
  it('DELETEs /automations/{id}, invalidates list + history, and toasts success', async () => {
    requestMock.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useDeleteAutomation(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync(9);
    });

    expect(calledUrl()).toBe('/automations/9');
    expect(calledOpts().method).toBe('DELETE');
    expect(calledOpts().requiresLiveMode).toBe(true);
    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[1]));
    expect(keys).toContain(JSON.stringify({ queryKey: automationKeys.all }));
    expect(keys).toContain(JSON.stringify({ queryKey: ['automation-history'] }));
    expect(toastSuccess).toHaveBeenCalledWith('toast.automation.delete.success', 'Automation deleted');
  });
});

// ── Bulk ─────────────────────────────────────────────────────────────────────
describe('useBulkAutomationsUpdate', () => {
  it('POSTs /automations/bulk with a JSON Content-Type and the allowlisted op', async () => {
    requestMock.mockResolvedValueOnce({ updated: 2, failed: [] });
    const { result } = renderHook(() => useBulkAutomationsUpdate(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ ids: [1, 2], op: 'enable' });
    });

    expect(calledUrl()).toBe('/automations/bulk');
    expect(calledOpts().method).toBe('POST');
    expect(calledOpts().requiresLiveMode).toBe(true);
    // Content-Type must be explicit so it survives the resilientFetch fallback.
    expect((calledOpts().headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(calledOpts().body as string)).toEqual({ ids: [1, 2], op: 'enable' });
    expect(toastSuccess).toHaveBeenCalledWith('toast.automation.bulk.enable.success', 'Automations enabled');
  });

  it.each([
    ['disable', 'Automations disabled'],
    ['delete', 'Automations deleted'],
  ] as const)('maps the %s op to its fallback toast', async (op, fallback) => {
    requestMock.mockResolvedValueOnce({ updated: 0, deleted: 0, failed: [] });
    const { result } = renderHook(() => useBulkAutomationsUpdate(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ ids: [3], op });
    });

    expect(toastSuccess).toHaveBeenCalledWith(`toast.automation.bulk.${op}.success`, fallback);
  });

  it('toasts an error when the bulk op fails', async () => {
    const boom = new Error('HTTP 500');
    requestMock.mockRejectedValueOnce(boom);
    const { result } = renderHook(() => useBulkAutomationsUpdate(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync({ ids: [1], op: 'enable' }).catch(() => undefined);
    });
    expect(toastError).toHaveBeenCalledWith(boom, 'toast.automation.bulk.error', 'Bulk automation update failed');
  });
});

// ── Test-run ─────────────────────────────────────────────────────────────────
describe('useTestRunAutomation', () => {
  it('POSTs /automations/{id}/test-run, invalidates history locally, and toasts success', async () => {
    requestMock.mockResolvedValueOnce(undefined);
    const client = makeClient();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useTestRunAutomation(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(6);
    });

    expect(calledUrl()).toBe('/automations/6/test-run');
    expect(calledOpts().method).toBe('POST');
    expect(calledOpts().requiresLiveMode).toBe(true);
    // Test-run is a per-click local poke — it uses invalidateQueries directly
    // rather than the cross-tab broadcast helper.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['automation-history'] });
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('toast.automation.testRun.success', 'Test run started');
  });

  it('toasts an error when the test run cannot start', async () => {
    const boom = new Error('busy');
    requestMock.mockRejectedValueOnce(boom);
    const { result } = renderHook(() => useTestRunAutomation(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync(6).catch(() => undefined);
    });
    expect(toastError).toHaveBeenCalledWith(boom, 'toast.automation.testRun.error', 'Failed to start test run');
  });
});

// ── Detail read (enabled gating + numeric normalisation) ─────────────────────
describe('useAutomation', () => {
  it('is disabled — and issues no request — when the id is undefined', async () => {
    const { result } = renderHook(() => useAutomation(undefined), { wrapper: wrapperFor(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it.each([0, -3, 'abc'])('stays disabled for the non-positive / non-numeric id %p', async (id) => {
    renderHook(() => useAutomation(id as number | string), { wrapper: wrapperFor(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('fetches the canonical /automations/{numericId} URL, normalising a string id', async () => {
    const full = { ...makeAutomation({ id: 5 }), triggers: [], conditions: [], actions: [] } as AutomationFull;
    requestMock.mockResolvedValueOnce(full);
    const { result } = renderHook(() => useAutomation('05'), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // "05" → 5 in both the query key and the request URL.
    expect(calledUrl()).toBe('/automations/5');
    expect(calledOpts()).toHaveProperty('signal');
    expect(result.current.data?.id).toBe(5);
  });

  it('surfaces detail request errors', async () => {
    requestMock.mockRejectedValueOnce(new Error('404'));
    const { result } = renderHook(() => useAutomation(5), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ── Full create / update ─────────────────────────────────────────────────────
describe('useCreateAutomationFull', () => {
  it('POSTs the full input to /automations, invalidates the list, and toasts success', async () => {
    const created = { ...makeAutomation({ id: 42 }), triggers: [], conditions: [], actions: [] } as AutomationFull;
    requestMock.mockResolvedValueOnce(created);
    const { result } = renderHook(() => useCreateAutomationFull(), { wrapper: wrapperFor(makeClient()) });

    let out: AutomationFull | undefined;
    await act(async () => {
      out = await result.current.mutateAsync(validFullInput);
    });

    expect(calledUrl()).toBe('/automations');
    expect(calledOpts().method).toBe('POST');
    expect(calledOpts().requiresLiveMode).toBe(true);
    expect(JSON.parse(calledOpts().body as string)).toEqual(validFullInput);
    expect(out?.id).toBe(42);
    expect(invalidateSpy).toHaveBeenCalledWith(expect.anything(), { queryKey: automationKeys.all });
    expect(toastSuccess).toHaveBeenCalledWith('toast.automation.create.success', 'Automation created');
  });

  it('toasts an error when create fails', async () => {
    const boom = new Error('HTTP 400');
    requestMock.mockRejectedValueOnce(boom);
    const { result } = renderHook(() => useCreateAutomationFull(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync(validFullInput).catch(() => undefined);
    });
    expect(toastError).toHaveBeenCalledWith(boom, 'toast.automation.create.error', 'Failed to create automation');
  });
});

describe('useUpdateAutomationFull', () => {
  it('PUTs /automations/{id}, invalidates list + detail, and toasts success', async () => {
    const updated = { ...makeAutomation({ id: 7, name: 'renamed' }), triggers: [], conditions: [], actions: [] } as AutomationFull;
    requestMock.mockResolvedValueOnce(updated);
    const { result } = renderHook(() => useUpdateAutomationFull(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ id: 7, input: { ...validFullInput, name: 'renamed' } });
    });

    expect(calledUrl()).toBe('/automations/7');
    expect(calledOpts().method).toBe('PUT');
    expect(calledOpts().requiresLiveMode).toBe(true);
    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[1]));
    expect(keys).toContain(JSON.stringify({ queryKey: automationKeys.all }));
    expect(keys).toContain(JSON.stringify({ queryKey: automationKeys.detail(7) }));
    expect(toastSuccess).toHaveBeenCalledWith('toast.automation.update.success', 'Automation updated');
  });

  it('toasts an error when update fails', async () => {
    const boom = new Error('conflict');
    requestMock.mockRejectedValueOnce(boom);
    const { result } = renderHook(() => useUpdateAutomationFull(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync({ id: 7, input: validFullInput }).catch(() => undefined);
    });
    expect(toastError).toHaveBeenCalledWith(boom, 'toast.automation.update.error', 'Failed to update automation');
  });
});

// ── Presets ──────────────────────────────────────────────────────────────────
const presetsPayload: AutomationPresetsResponse = { categories: [], presets: [] };

describe('useAutomationPresets', () => {
  it('GETs /automations/presets with no query param when no category is given', async () => {
    requestMock.mockResolvedValueOnce(presetsPayload);
    const { result } = renderHook(() => useAutomationPresets(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/automations/presets');
    expect(calledOpts()).toHaveProperty('signal');
  });

  it('appends the category query param', async () => {
    requestMock.mockResolvedValueOnce(presetsPayload);
    renderHook(() => useAutomationPresets('comfort'), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(calledUrl()).toBe('/automations/presets?category=comfort');
  });

  it('URL-encodes a category with special characters', async () => {
    requestMock.mockResolvedValueOnce(presetsPayload);
    renderHook(() => useAutomationPresets('road & trip'), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(calledUrl()).toBe('/automations/presets?category=road%20%26%20trip');
  });
});

describe('useAutomationPreset', () => {
  it('is disabled — and issues no request — when the id is undefined', async () => {
    const { result } = renderHook(() => useAutomationPreset(undefined), { wrapper: wrapperFor(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('GETs /automations/presets/{id}, URL-encoding the id segment', async () => {
    const preset = { id: 'road/trip', name: 'Road trip' } as AutomationPreset;
    requestMock.mockResolvedValueOnce(preset);
    const { result } = renderHook(() => useAutomationPreset('road/trip'), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/automations/presets/road%2Ftrip');
    expect(result.current.data?.name).toBe('Road trip');
  });
});
