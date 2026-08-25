// useDLQ hook-layer tests.
//
// useDLQ.ts is the dead-letter-queue inspector TanStack Query surface:
// the recent-entries list (+ replay_enabled flag), a lazy full-entry
// fetch, the (optionally entry-scoped) replay-audit feed, and the
// sudo-gated replay mutation.
//
// These tests exercise the contract each export exposes — the exact
// request path (no /api/v1 prefix, snake_case query params), the
// AbortSignal thread-through, the enabled/id guards, the audit-limit
// clamp (both in the URL *and* the cache key), and the replay
// mutation's split toast behaviour (success vs. silent-on-cancel vs.
// silent-on-403 vs. error) plus its cache invalidation — without
// standing up the whole DLQ Inspector page.
//
// Sibling-of-source location is mandatory: the elevation gate matches
// `api/hooks/useDLQ` as a contiguous path substring, which a __tests__/
// subdir would interrupt.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Spy on the mutation-toast bridge so replay's success / silent / error
// branches are directly observable — and so the suite doesn't need a
// ToastProvider + initialised i18n instance just to assert them.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toast.success, error: toast.error }),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import {
  ApiError,
  request,
  SudoCanceledError as ClientSudoCanceledError,
} from '@/api/client';
import { PAGINATION } from '@/lib/constants';
import {
  dlqKeys,
  clampAuditLimit,
  useDLQList,
  useDLQEntry,
  useDLQAudit,
  useDLQReplay,
  SudoCanceledError,
} from './useDLQ';
import type {
  DLQEntrySummary,
  DLQEntryFull,
  DLQListResponse,
  DLQAuditResponse,
  DLQReplayResponse,
} from '@/types/admin-diagnostics';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

/**
 * Fresh QueryClient + provider per test (retry off, gcTime 0). Returns
 * the client too so mutation tests can spy on invalidateQueries and
 * audit tests can read back the cache under a specific key.
 */
function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      // retry:false is the baseline, but useDLQList/useDLQEntry override it
      // with retry:1. retryDelay:0 keeps that single retry from stalling the
      // error-path tests behind React Query's default exponential backoff.
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, wrapper };
}

/** Reads back the [path, options] pair from the Nth request() call. */
function callArgs(n = 0): [
  string,
  {
    method?: string;
    body?: unknown;
    signal?: unknown;
    requiresLiveMode?: boolean;
  },
] {
  return mockedRequest.mock.calls[n] as [
    string,
    {
      method?: string;
      body?: unknown;
      signal?: unknown;
      requiresLiveMode?: boolean;
    },
  ];
}

const summary: DLQEntrySummary = {
  id: 11,
  arrived_at: '2025-06-01T00:00:00Z',
  dlq_topic: 'dlq/telemetry',
  parsed_reason: 'codec',
  parsed_vehicle_id: 7,
  parsed_vin: '5YJ3',
  parsed_source_topic: 'telemetry/5YJ3/v/Soc',
  parsed_redeliveries: 2,
  parsed_timestamp: '2025-06-01T00:00:00Z',
  parse_error: null,
  replayable: true,
  raw_payload_size: 128,
  inner_payload_size: 64,
};

const listPayload: DLQListResponse = {
  count: 1,
  replay_enabled: true,
  entries: [summary],
};

const entryPayload: DLQEntryFull = {
  ...summary,
  raw_payload_b64: 'AAAA',
  inner_payload_b64: 'BBBB',
};

const auditPayload: DLQAuditResponse = {
  count: 0,
  limit: PAGINATION.DEFAULT_LIMIT,
  dlq_id: 0,
  rows: [],
};

const okReplay: DLQReplayResponse = {
  ok: true,
  replayed_id: 11,
  dst_topic: 'telemetry/5YJ3/v/Soc',
  result: 'ok',
  audit_id: 99,
};

beforeEach(() => {
  mockedRequest.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

// ---------------------------------------------------------------------------
// Query-key factory + re-export identity
// ---------------------------------------------------------------------------

describe('dlqKeys', () => {
  it('produces stable, distinct key tuples for every query variant', () => {
    expect(dlqKeys.list).toEqual(['system', 'dlq', 'list']);
    expect(dlqKeys.entry(11)).toEqual(['system', 'dlq', 'entry', 11]);
    expect(dlqKeys.audit(50)).toEqual(['system', 'dlq', 'audit', 50]);
    expect(dlqKeys.entryAudit(11, 25)).toEqual([
      'system',
      'dlq',
      'entry',
      11,
      'audit',
      25,
    ]);
  });
});

describe('SudoCanceledError re-export', () => {
  it('re-exports the client class identity so instanceof checks agree', () => {
    expect(SudoCanceledError).toBe(ClientSudoCanceledError);
    expect(new SudoCanceledError()).toBeInstanceOf(ClientSudoCanceledError);
  });
});

// ---------------------------------------------------------------------------
// clampAuditLimit — the documented cap useDLQAudit relies on
// ---------------------------------------------------------------------------

describe('clampAuditLimit', () => {
  it('passes through in-range integers unchanged', () => {
    expect(clampAuditLimit(1)).toBe(1);
    expect(clampAuditLimit(50)).toBe(50);
    expect(clampAuditLimit(PAGINATION.MAX_LIMIT)).toBe(PAGINATION.MAX_LIMIT);
  });

  it('caps values above MAX_LIMIT', () => {
    expect(clampAuditLimit(PAGINATION.MAX_LIMIT + 1)).toBe(PAGINATION.MAX_LIMIT);
    expect(clampAuditLimit(1_000_000)).toBe(PAGINATION.MAX_LIMIT);
  });

  it('floors fractional limits and lifts sub-1 values to 1', () => {
    expect(clampAuditLimit(10.9)).toBe(10);
    expect(clampAuditLimit(0)).toBe(1);
    expect(clampAuditLimit(-5)).toBe(1);
  });

  it('falls back to the default page size for non-finite input', () => {
    expect(clampAuditLimit(Number.NaN)).toBe(PAGINATION.DEFAULT_LIMIT);
    expect(clampAuditLimit(Number.POSITIVE_INFINITY)).toBe(PAGINATION.DEFAULT_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// useDLQList
// ---------------------------------------------------------------------------

describe('useDLQList', () => {
  it('GETs /system/dlq, threads the abort signal, and surfaces replay_enabled + entries', async () => {
    mockedRequest.mockResolvedValueOnce(listPayload);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDLQList(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = callArgs();
    expect(url).toBe('/system/dlq');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data?.replay_enabled).toBe(true);
    expect(result.current.data?.entries).toHaveLength(1);
  });

  it('surfaces request failures as isError', async () => {
    // retry:1 on this hook overrides the wrapper's retry:false, so reject
    // *every* attempt (mockRejectedValue, not …Once) to reach the error state.
    mockedRequest.mockRejectedValue(new ApiError('boom', 500));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDLQList(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});

// ---------------------------------------------------------------------------
// useDLQEntry
// ---------------------------------------------------------------------------

describe('useDLQEntry', () => {
  it('GETs /system/dlq/{id} for a positive integer id and surfaces the payload blobs', async () => {
    mockedRequest.mockResolvedValueOnce(entryPayload);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDLQEntry(11), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = callArgs();
    expect(url).toBe('/system/dlq/11');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data?.raw_payload_b64).toBe('AAAA');
  });

  it('stays idle (disabled) when id is null', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDLQEntry(null), { wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('treats a non-integer id as disabled — a path param must be a whole number', async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useDLQEntry(2.5), { wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('respects the explicit enabled=false gate even for a valid id', async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useDLQEntry(11, false), { wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useDLQAudit
// ---------------------------------------------------------------------------

describe('useDLQAudit', () => {
  it('GETs the global feed with the default limit when no dlqId is given', async () => {
    mockedRequest.mockResolvedValueOnce(auditPayload);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDLQAudit(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = callArgs();
    expect(url).toBe(`/system/dlq/audit?limit=${PAGINATION.DEFAULT_LIMIT}`);
    expect(opts).toHaveProperty('signal');
  });

  it('scopes to /system/dlq/{id}/audit when a positive dlqId is given', async () => {
    mockedRequest.mockResolvedValueOnce({ ...auditPayload, dlq_id: 11 });
    const { wrapper } = makeWrapper();
    renderHook(() => useDLQAudit(11, 25), { wrapper });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callArgs()[0]).toBe('/system/dlq/11/audit?limit=25');
  });

  it('clamps an over-large limit down to MAX_LIMIT in the request URL', async () => {
    mockedRequest.mockResolvedValueOnce(auditPayload);
    const { wrapper } = makeWrapper();
    renderHook(() => useDLQAudit(null, 999_999), { wrapper });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callArgs()[0]).toBe(`/system/dlq/audit?limit=${PAGINATION.MAX_LIMIT}`);
  });

  it('keys the cache with the clamped limit so cache identity matches the URL that was fetched', async () => {
    mockedRequest.mockResolvedValue(auditPayload);
    const { qc, wrapper } = makeWrapper();
    renderHook(() => useDLQAudit(11, 999_999), { wrapper });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    // The raw limit (999_999) must NOT be the cache key…
    expect(qc.getQueryData(dlqKeys.entryAudit(11, 999_999))).toBeUndefined();
    // …the clamped MAX_LIMIT must be.
    expect(qc.getQueryData(dlqKeys.entryAudit(11, PAGINATION.MAX_LIMIT))).toEqual(
      auditPayload,
    );
  });
});

// ---------------------------------------------------------------------------
// useDLQReplay — split success / silent / error toast behaviour
// ---------------------------------------------------------------------------

describe('useDLQReplay', () => {
  it('POSTs /system/dlq/{id}/replay, invalidates the DLQ tree, and toasts success with the topic', async () => {
    mockedRequest.mockResolvedValueOnce(okReplay);
    const { qc, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDLQReplay(), { wrapper });

    await act(async () => {
      const res = await result.current.mutateAsync({ id: 11 });
      expect(res.result).toBe('ok');
    });

    const [url, opts] = callArgs();
    expect(url).toBe('/system/dlq/11/replay');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['system', 'dlq'] });
    expect(toast.success).toHaveBeenCalledWith(
      'admin.dlq.toast.replaySuccess',
      'Replay published to {{topic}}',
      { topic: 'telemetry/5YJ3/v/Soc' },
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('substitutes a placeholder topic when the server omits dst_topic (never "undefined" in the toast)', async () => {
    mockedRequest.mockResolvedValueOnce({
      ok: true,
      replayed_id: 11,
      result: 'ok',
    } as unknown as DLQReplayResponse);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDLQReplay(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 11 });
    });

    expect(toast.success).toHaveBeenCalledWith(
      'admin.dlq.toast.replaySuccess',
      'Replay published to {{topic}}',
      { topic: '—' },
    );
  });

  it('stays silent (no toast) when the user cancels the sudo reauth dialog', async () => {
    mockedRequest.mockRejectedValueOnce(new SudoCanceledError());
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDLQReplay(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 11 })).rejects.toBeInstanceOf(
        SudoCanceledError,
      );
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('stays silent (no error toast) on a 403 disabled-gate response — the page renders a banner instead', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('replay disabled', 403));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDLQReplay(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 11 })).rejects.toBeInstanceOf(
        ApiError,
      );
    });

    expect(toast.error).not.toHaveBeenCalled();
  });

  it('emits an error toast for any other failure', async () => {
    const err = new ApiError('publish failed', 500);
    mockedRequest.mockRejectedValueOnce(err);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDLQReplay(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 11 })).rejects.toThrow(
        'publish failed',
      );
    });

    expect(toast.error).toHaveBeenCalledWith(
      err,
      'admin.dlq.toast.replayError',
      'Replay failed',
    );
  });
});
