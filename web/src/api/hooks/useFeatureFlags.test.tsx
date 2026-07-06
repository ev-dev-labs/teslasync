// Behavioural coverage for the typed feature-flag registry hooks
// (`/api/v1/system/flags*`). These hooks own real logic — URL shaping,
// conditional `enabled` gating, scoped-vs-global change feeds, sudo-aware
// mutations with cache invalidation + toast side-effects — so the tests
// exercise every export through its public call surface rather than smoke
// rendering.
//
// Network is mocked at the `request` boundary (the repo convention — see
// useAlerts.test.tsx / useExports.test.tsx). The client mock preserves the
// real `SudoCanceledError` via importActual so the `instanceof` guard in the
// mutation `onError` handlers narrows against the exact class the source
// throws. The toast bridge is mocked so we can assert on i18n keys +
// interpolation vars without mounting a ToastProvider / i18n context.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Keep the real client exports (notably SudoCanceledError) and swap only the
// HTTP entry point for a spy.
vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return { ...actual, request: vi.fn() };
});

// Hoisted so the (also hoisted) mock factory closes over the same spies the
// assertions read.
const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toastSuccess, error: toastError }),
}));

import { request, SudoCanceledError } from '../client';
import * as flagsModule from './useFeatureFlags';
import {
  featureFlagKeys,
  useFlags,
  useFlag,
  useFlagChanges,
  useSetFlag,
  useDeleteFlag,
  SudoCanceledError as ReexportedSudoCanceledError,
} from './useFeatureFlags';
import type {
  FeatureFlagsListResponse,
  FeatureFlagEntry,
  FeatureFlagWriteResponse,
  FeatureFlagChangesResponse,
} from '@/types/admin-diagnostics';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // The hooks override queries with `retry: 1`; retryDelay 0 keeps the
      // error paths instant instead of waiting on the default backoff.
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** URL string the mocked `request` was called with on invocation `i`. */
function calledUrl(i = 0): string {
  return mockedRequest.mock.calls[i]?.[0] as string;
}
/** RequestInit the mocked `request` was called with on invocation `i`. */
function calledOpts(i = 0): RequestInit {
  return (mockedRequest.mock.calls[i]?.[1] ?? {}) as RequestInit;
}

const listPayload: FeatureFlagsListResponse = {
  count: 2,
  flags: [
    { key: 'beta.dashboard', value: true },
    { key: 'rollout.percent', value: { pct: 25 } },
  ],
};

const changesPayload: FeatureFlagChangesResponse = {
  count: 0,
  flag_key: '',
  limit: 50,
  rows: [],
};

beforeEach(() => {
  mockedRequest.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

// ── Module surface ───────────────────────────────────────────────────────────
describe('useFeatureFlags module surface', () => {
  it('exports every hook as a function and the key factory as an object', () => {
    expect(typeof useFlags).toBe('function');
    expect(typeof useFlag).toBe('function');
    expect(typeof useFlagChanges).toBe('function');
    expect(typeof useSetFlag).toBe('function');
    expect(typeof useDeleteFlag).toBe('function');
    expect(typeof featureFlagKeys).toBe('object');
  });

  it('re-exports SudoCanceledError as the exact class from the client', () => {
    // A broken re-export shows up here as `undefined`, not just at tsc time.
    expect(ReexportedSudoCanceledError).toBe(SudoCanceledError);
    expect(flagsModule.SudoCanceledError).toBe(SudoCanceledError);
    expect(new ReexportedSudoCanceledError()).toBeInstanceOf(Error);
  });
});

// ── Query-key factory ────────────────────────────────────────────────────────
describe('featureFlagKeys', () => {
  it('builds stable list and per-flag cache keys', () => {
    expect(featureFlagKeys.list).toEqual(['system', 'flags', 'list']);
    expect(featureFlagKeys.flag('beta.dashboard')).toEqual([
      'system',
      'flags',
      'flag',
      'beta.dashboard',
    ]);
  });

  it('encodes the changes key, collapsing a null flagKey to __all__', () => {
    expect(featureFlagKeys.changes('beta.dashboard', 25)).toEqual([
      'system',
      'flags',
      'changes',
      'beta.dashboard',
      25,
    ]);
    expect(featureFlagKeys.changes(null, 50)).toEqual([
      'system',
      'flags',
      'changes',
      '__all__',
      50,
    ]);
  });
});

// ── useFlags ─────────────────────────────────────────────────────────────────
describe('useFlags', () => {
  it('GETs /system/flags, threads an abort signal, and surfaces the registry', async () => {
    mockedRequest.mockResolvedValueOnce(listPayload);
    const { result } = renderHook(() => useFlags(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/system/flags');
    expect(calledOpts()).toEqual(expect.objectContaining({ signal: expect.anything() }));
    expect(result.current.data).toEqual(listPayload);
    expect(result.current.data?.flags).toHaveLength(2);
  });

  it('surfaces a request failure as isError', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useFlags(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ── useFlag ──────────────────────────────────────────────────────────────────
describe('useFlag', () => {
  const entry: FeatureFlagEntry = { key: 'beta.dashboard', value: { rollout: 50 } };

  it('stays disabled and never fires when the key is null', async () => {
    const { result } = renderHook(() => useFlag(null), { wrapper: wrapperFor(makeClient()) });
    // Give the query a tick — a disabled query must not dispatch.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isPending).toBe(true);
  });

  it('stays disabled for an empty-string key', async () => {
    renderHook(() => useFlag(''), { wrapper: wrapperFor(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('GETs /system/flags/{key} URL-encoded when enabled and returns the entry', async () => {
    mockedRequest.mockResolvedValueOnce(entry);
    const { result } = renderHook(() => useFlag('beta/rollout flag'), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/system/flags/beta%2Frollout%20flag');
    expect(calledOpts()).toEqual(expect.objectContaining({ signal: expect.anything() }));
    expect(result.current.data).toEqual(entry);
  });
});

// ── useFlagChanges ───────────────────────────────────────────────────────────
describe('useFlagChanges', () => {
  it('GETs the global feed with the default limit when no flag is scoped', async () => {
    mockedRequest.mockResolvedValueOnce(changesPayload);
    const { result } = renderHook(() => useFlagChanges(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/system/flags/changes?limit=50');
    expect(calledOpts()).toEqual(expect.objectContaining({ signal: expect.anything() }));
  });

  it('scopes to a single flag with an encoded key and a custom limit', async () => {
    mockedRequest.mockResolvedValueOnce(changesPayload);
    const { result } = renderHook(() => useFlagChanges('beta/x', 10), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/system/flags/beta%2Fx/changes?limit=10');
  });

  it('treats an empty-string flagKey as the global feed (not a scoped one)', async () => {
    mockedRequest.mockResolvedValueOnce(changesPayload);
    const { result } = renderHook(() => useFlagChanges('', 5), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/system/flags/changes?limit=5');
  });

  it('surfaces a request failure as isError', async () => {
    mockedRequest.mockRejectedValue(new Error('feed down'));
    const { result } = renderHook(() => useFlagChanges('beta', 5), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ── useSetFlag ───────────────────────────────────────────────────────────────
describe('useSetFlag', () => {
  const write: FeatureFlagWriteResponse = {
    key: 'beta.dashboard',
    old_value: false,
    new_value: true,
    audit_id: 12,
  };

  it('PUTs {value,reason} to the encoded key, invalidates caches, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(write);
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSetFlag(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({ key: 'beta/x', value: true, reason: 'enable' });
    });

    expect(calledUrl()).toBe('/system/flags/beta%2Fx');
    expect(calledOpts().method).toBe('PUT');
    expect(JSON.parse(calledOpts().body as string)).toEqual({ value: true, reason: 'enable' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['system', 'flags'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: featureFlagKeys.flag('beta/x') });
    expect(toastSuccess).toHaveBeenCalledWith(
      'admin.flags.toast.saveSuccess',
      'Flag "{{key}}" saved',
      { key: 'beta/x' },
    );
  });

  it('toasts an error and skips success on a generic failure', async () => {
    const boom = new Error('HTTP 500');
    mockedRequest.mockRejectedValueOnce(boom);
    const { result } = renderHook(() => useSetFlag(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current
        .mutateAsync({ key: 'beta.dashboard', value: 1, reason: 'x' })
        .catch(() => undefined);
    });

    expect(toastError).toHaveBeenCalledWith(boom, 'admin.flags.toast.saveError', 'Failed to save flag');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('swallows a SudoCanceledError without any toast', async () => {
    mockedRequest.mockRejectedValueOnce(new SudoCanceledError());
    const { result } = renderHook(() => useSetFlag(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current
        .mutateAsync({ key: 'beta.dashboard', value: 1, reason: 'x' })
        .catch(() => undefined);
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

// ── useDeleteFlag ────────────────────────────────────────────────────────────
describe('useDeleteFlag', () => {
  const write: FeatureFlagWriteResponse = {
    key: 'beta.dashboard',
    old_value: true,
    deleted: true,
    audit_id: 13,
  };

  it('DELETEs the encoded key with the reason as an encoded query param and toasts', async () => {
    mockedRequest.mockResolvedValueOnce(write);
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteFlag(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({ key: 'beta/x', reason: 'clean up & remove' });
    });

    expect(calledUrl()).toBe('/system/flags/beta%2Fx?reason=clean+up+%26+remove');
    expect(calledOpts().method).toBe('DELETE');
    expect(calledOpts().body).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['system', 'flags'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: featureFlagKeys.flag('beta/x') });
    expect(toastSuccess).toHaveBeenCalledWith(
      'admin.flags.toast.deleteSuccess',
      'Flag "{{key}}" deleted',
      { key: 'beta/x' },
    );
  });

  it('toasts an error on failure', async () => {
    const boom = new Error('HTTP 403');
    mockedRequest.mockRejectedValueOnce(boom);
    const { result } = renderHook(() => useDeleteFlag(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ key: 'beta.dashboard', reason: 'x' }).catch(() => undefined);
    });

    expect(toastError).toHaveBeenCalledWith(
      boom,
      'admin.flags.toast.deleteError',
      'Failed to delete flag',
    );
  });

  it('swallows a SudoCanceledError without any toast', async () => {
    mockedRequest.mockRejectedValueOnce(new SudoCanceledError());
    const { result } = renderHook(() => useDeleteFlag(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ key: 'beta.dashboard', reason: 'x' }).catch(() => undefined);
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
