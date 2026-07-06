// usePinned hook-suite tests.
//
// Covers EVERY export of ./usePinned:
//   - pinnedKeys        — the query-key factory (all / type / list) is stable,
//                         namespaced, and produces prefix-compatible tuples.
//   - usePinned         — GET /pinned?type=… (+ context), threads the abort
//                         signal, coerces a null body to [], and exposes an
//                         array from the very first render (never undefined).
//   - useTogglePin      — POST create (with/without context), cache-first +
//                         cold-cache DELETE lookup, no-op when unpinned,
//                         null-safe fallback, invalidation, success/error toasts.
//   - useReorderPin     — PATCH position, context-prefix invalidation (the bug
//                         fix), and the reorder-specific error toast.
//   - TogglePinInput /
//     ReorderPinInput   — exercised as the mutation input types.
//
// Network is mocked at the api/client boundary and toasts at the _toastHelpers
// boundary — the repo convention (see useExports.test.tsx /
// useMarkNotificationRead.test.tsx). Never hits real network.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Toast spies — asserted against the exact i18n key + fallback each path emits.
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toastSuccess, error: toastError }),
}));

// HTTP client stub. The deferred wrapper means `requestMock` is only touched
// when the mocked `request` is *called* (render/mutation time), never during
// Vitest's hoisted factory evaluation — so no temporal-dead-zone error.
const requestMock = vi.fn();
vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import {
  usePinned,
  useTogglePin,
  useReorderPin,
  pinnedKeys,
  type TogglePinInput,
  type ReorderPinInput,
} from './usePinned';
import type { PinnedItem } from '../types';

function makeWrapper(client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

function makePin(overrides: Partial<PinnedItem> = {}): PinnedItem {
  return {
    id: 1,
    item_type: 'vehicle',
    item_id: '42',
    position: 0,
    pinned_at: '2025-01-01T00:00:00Z',
    context: null,
    ...overrides,
  };
}

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

// ---------------------------------------------------------------------------
// pinnedKeys
// ---------------------------------------------------------------------------

describe('pinnedKeys', () => {
  it('exposes a stable root namespace', () => {
    expect(pinnedKeys.all).toEqual(['pinned']);
  });

  it('defaults the list key context slot to null', () => {
    expect(pinnedKeys.list('vehicle')).toEqual(['pinned', 'vehicle', null]);
  });

  it('threads an explicit context into the list key', () => {
    expect(pinnedKeys.list('widget', 'glance')).toEqual(['pinned', 'widget', 'glance']);
  });

  it('builds a context-agnostic type prefix that is a strict prefix of any context list key', () => {
    const prefix = pinnedKeys.type('widget');
    expect(prefix).toEqual(['pinned', 'widget']);
    // The invalidation-fix contract: `type(t)` must be a leading slice of
    // every `list(t, ctx)` so prefix-based invalidateQueries reaches them.
    const contextList = pinnedKeys.list('widget', 'glance');
    const nullList = pinnedKeys.list('widget');
    expect(contextList.slice(0, prefix.length)).toEqual(prefix);
    expect(nullList.slice(0, prefix.length)).toEqual(prefix);
  });
});

// ---------------------------------------------------------------------------
// usePinned
// ---------------------------------------------------------------------------

describe('usePinned', () => {
  it('GETs /pinned?type=<type> and threads the abort signal', async () => {
    const rows = [makePin({ id: 7, item_id: '42' })];
    requestMock.mockResolvedValueOnce(rows);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePinned('vehicle'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [url, opts] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/pinned?type=vehicle');
    expect(opts).toHaveProperty('signal');
  });

  it('appends the context query param when provided', async () => {
    requestMock.mockResolvedValueOnce([makePin({ item_type: 'widget', context: 'glance' })]);
    const { Wrapper } = makeWrapper();

    renderHook(() => usePinned('widget', 'glance'), { wrapper: Wrapper });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][0]).toBe('/pinned?type=widget&context=glance');
  });

  it('coerces a null body to an empty array (never undefined)', async () => {
    requestMock.mockResolvedValueOnce(null);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePinned('vehicle'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(Array.isArray(result.current.data)).toBe(true);
  });

  it('reports a loading state before the first response arrives', () => {
    // A promise that never settles keeps the query pending so we observe the
    // idiomatic loading phase (no placeholder masking isLoading / isSuccess).
    requestMock.mockImplementation(() => new Promise<PinnedItem[]>(() => {}));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePinned('vehicle'), { wrapper: Wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isSuccess).toBe(false);
  });

  it('surfaces request failures as isError', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom'));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePinned('vehicle'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// useTogglePin
// ---------------------------------------------------------------------------

describe('useTogglePin', () => {
  it('POSTs /pinned with item_type + item_id (context omitted) when pinning', async () => {
    requestMock.mockResolvedValueOnce(makePin({ id: 99 }));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useTogglePin('vehicle'), { wrapper: Wrapper });
    const input: TogglePinInput = { itemId: '42', pin: true };

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    const [url, opts] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/pinned');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(String(opts.body));
    expect(body).toEqual({ item_type: 'vehicle', item_id: '42' });
    expect('context' in body).toBe(false);
    expect(toastSuccess).toHaveBeenCalledWith('toast.pin.pinned.success', 'Pinned');
  });

  it('includes the context in the POST body when provided', async () => {
    requestMock.mockResolvedValueOnce(makePin({ id: 100, item_type: 'widget', context: 'glance' }));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useTogglePin('widget'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ itemId: 'soc', context: 'glance', pin: true });
    });

    const body = JSON.parse(String((requestMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ item_type: 'widget', item_id: 'soc', context: 'glance' });
  });

  it('reads the row id from the cache and DELETEs it when unpinning', async () => {
    const { Wrapper, qc } = makeWrapper();
    qc.setQueryData(pinnedKeys.list('vehicle'), [makePin({ id: 7, item_id: '42' })]);
    requestMock.mockResolvedValueOnce(undefined); // DELETE

    const { result } = renderHook(() => useTogglePin('vehicle'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ itemId: '42', pin: false });
    });

    // Cache hit → no list refetch, only the DELETE.
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [url, opts] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/pinned/7');
    expect(opts.method).toBe('DELETE');
    expect(toastSuccess).toHaveBeenCalledWith('toast.pin.unpinned.success', 'Unpinned');
  });

  it('falls back to a fresh fetch when the cache is cold, then DELETEs the resolved id', async () => {
    const { Wrapper } = makeWrapper();
    requestMock.mockImplementation((url: string) =>
      url.startsWith('/pinned?')
        ? Promise.resolve([makePin({ id: 9, item_id: '42' })])
        : Promise.resolve(undefined),
    );

    const { result } = renderHook(() => useTogglePin('vehicle'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ itemId: '42', pin: false });
    });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[0][0]).toBe('/pinned?type=vehicle');
    expect(requestMock.mock.calls[0][1]).toBeUndefined();
    expect(requestMock.mock.calls[1][0]).toBe('/pinned/9');
    expect((requestMock.mock.calls[1][1] as RequestInit).method).toBe('DELETE');
  });

  it('is a no-op (no DELETE) when the item is not pinned anywhere', async () => {
    const { Wrapper, qc } = makeWrapper();
    qc.setQueryData(pinnedKeys.list('vehicle'), [makePin({ id: 1, item_id: 'other' })]);
    // Cold-for-this-item cache → fallback fetch also lacks the item.
    requestMock.mockResolvedValueOnce([makePin({ id: 1, item_id: 'other' })]);

    const { result } = renderHook(() => useTogglePin('vehicle'), { wrapper: Wrapper });

    let outcome: unknown = 'unset';
    await act(async () => {
      outcome = await result.current.mutateAsync({ itemId: '42', pin: false });
    });

    expect(outcome).toBeNull();
    // Only the fallback list fetch happened — never a DELETE.
    expect(requestMock).toHaveBeenCalledTimes(1);
    const deleteCalls = requestMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('does not throw when the unpin fallback list resolves null (null-safety)', async () => {
    const { Wrapper } = makeWrapper();
    // No cache seeded → fallback fetch runs and returns null. Without the
    // `?? []` guard, `.find` on null would throw and reject the mutation.
    requestMock.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useTogglePin('vehicle'), { wrapper: Wrapper });

    let outcome: unknown = 'unset';
    await act(async () => {
      outcome = await result.current.mutateAsync({ itemId: 'ghost', pin: false });
    });

    // The mutation RESOLVING (not rejecting) is the null-safety proof: without
    // the `?? []` guard, `.find` on the null body would throw and reject here.
    expect(outcome).toBeNull();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('invalidates every pinned query on success', async () => {
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    requestMock.mockResolvedValueOnce(makePin({ id: 5 }));

    const { result } = renderHook(() => useTogglePin('vehicle'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ itemId: '42', pin: true });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pinned'] });
  });

  it('shows a pin-specific error toast when the POST fails', async () => {
    const { Wrapper } = makeWrapper();
    const err = new Error('server 500');
    requestMock.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useTogglePin('vehicle'), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ itemId: '42', pin: true })).rejects.toThrow(
        'server 500',
      );
    });

    expect(toastError).toHaveBeenCalledWith(err, 'toast.pin.pinned.error', 'Failed to pin');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('shows an unpin-specific error toast when the DELETE fails', async () => {
    const { Wrapper, qc } = makeWrapper();
    qc.setQueryData(pinnedKeys.list('vehicle'), [makePin({ id: 7, item_id: '42' })]);
    const err = new Error('delete blew up');
    requestMock.mockRejectedValueOnce(err); // the DELETE

    const { result } = renderHook(() => useTogglePin('vehicle'), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ itemId: '42', pin: false })).rejects.toThrow(
        'delete blew up',
      );
    });

    expect(toastError).toHaveBeenCalledWith(err, 'toast.pin.unpinned.error', 'Failed to unpin');
  });
});

// ---------------------------------------------------------------------------
// useReorderPin
// ---------------------------------------------------------------------------

describe('useReorderPin', () => {
  it('PATCHes /pinned/{id} with the new position', async () => {
    requestMock.mockResolvedValueOnce(makePin({ id: 5, position: 2 }));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useReorderPin('vehicle'), { wrapper: Wrapper });
    const input: ReorderPinInput = { id: 5, position: 2 };

    let row: PinnedItem | undefined;
    await act(async () => {
      row = await result.current.mutateAsync(input);
    });

    expect(row?.position).toBe(2);
    const [url, opts] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/pinned/5');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(String(opts.body))).toEqual({ position: 2 });
  });

  it('invalidates ALL context buckets for the type on success, not just the null bucket', async () => {
    const { Wrapper, qc } = makeWrapper();
    // Seed both a context-scoped and a null-context query for the same type.
    qc.setQueryData(pinnedKeys.list('widget', 'glance'), [
      makePin({ id: 1, item_type: 'widget', context: 'glance' }),
    ]);
    qc.setQueryData(pinnedKeys.list('widget'), [makePin({ id: 2, item_type: 'widget' })]);
    requestMock.mockResolvedValueOnce(makePin({ id: 1, item_type: 'widget', position: 1 }));

    const { result } = renderHook(() => useReorderPin('widget'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 1, position: 1 });
    });

    // The bug fix: prefix `['pinned','widget']` reaches the context query.
    // The old `list('widget')` = `['pinned','widget',null]` would NOT.
    await waitFor(() => {
      expect(qc.getQueryState(pinnedKeys.list('widget', 'glance'))?.isInvalidated).toBe(true);
    });
    expect(qc.getQueryState(pinnedKeys.list('widget'))?.isInvalidated).toBe(true);
  });

  it('shows a reorder-specific error toast on failure', async () => {
    const { Wrapper } = makeWrapper();
    const err = new Error('reorder failed');
    requestMock.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useReorderPin('vehicle'), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 3, position: 0 })).rejects.toThrow(
        'reorder failed',
      );
    });

    expect(toastError).toHaveBeenCalledWith(err, 'toast.pin.reorder.error', 'Failed to reorder pins');
  });
});
