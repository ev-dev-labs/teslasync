// Tests for the push_subscriptions API hooks.
//
// `usePush.ts` owns the *server* side of the browser-push contract:
//
//   - usePushPublicKey()   — GET /push/public-key, treating a 404 as
//                            "push is disabled" (null) rather than an error.
//   - usePushSubscriptions() — GET /push/subscribe (per-device list).
//   - useSubscribePush()   — POST /push/subscribe (idempotent register).
//   - useUnsubscribePush() — DELETE /push/subscribe (remove one endpoint).
//
// Every export is exercised through its public surface: request URL +
// method + body, snake_case wire shape pass-through, the disabled/empty/
// error branches, cache invalidation, and the success/error toast keys.
//
// Network is mocked at the `request` boundary (the repo convention — see
// useAlerts.test.tsx / useNotificationChannels.test.tsx). `../client` is
// spread from the real module so `ApiError` / `isApiError` stay intact for
// the 404-detection branch. Toast + cross-tab broadcast are mocked so we
// can assert on i18n keys and invalidation without a live Toast/BC bus.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Hoisted so the mock factories (also hoisted by Vitest) close over the
// same spy instances the assertions read.
const { requestMock, toastSuccess, toastError, invalidateSpy } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidateSpy: vi.fn(),
}));

// Keep the real module (ApiError, isApiError) and override only `request`
// so the source's `isApiError(err) && err.status === 404` branch resolves
// against genuine ApiError instances we construct below.
vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return {
    ...actual,
    request: (...args: unknown[]) => requestMock(...args),
  };
});

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock('@/lib/queryBroadcast', () => ({
  invalidateAndBroadcast: (...args: unknown[]) => invalidateSpy(...args),
}));

import { ApiError } from '../client';
import {
  pushKeys,
  usePushPublicKey,
  usePushSubscriptions,
  useSubscribePush,
  useUnsubscribePush,
} from './usePush';
import type { PushSubscribeBody, PushSubscriptionRow } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function calledUrl(i = 0): string {
  return requestMock.mock.calls[i]?.[0] as string;
}

function calledOpts(i = 0): RequestInit & { signal?: AbortSignal } {
  return (requestMock.mock.calls[i]?.[1] ?? {}) as RequestInit & { signal?: AbortSignal };
}

function makeRow(over: Partial<PushSubscriptionRow> = {}): PushSubscriptionRow {
  return {
    id: 1,
    user_id: null,
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    p256dh: 'p256dh-key',
    auth: 'auth-key',
    user_agent: 'Chrome/120',
    created_at: '2024-01-01T00:00:00Z',
    last_used_at: null,
    ...over,
  };
}

const subscribeBody: PushSubscribeBody = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  invalidateSpy.mockReset();
});

// ── Query-key factory ────────────────────────────────────────────────────────
describe('pushKeys', () => {
  it('exposes stable query-key tuples for the public key and device list', () => {
    expect(pushKeys.publicKey).toEqual(['push', 'public-key']);
    expect(pushKeys.list).toEqual(['push', 'subscriptions']);
  });
});

// ── usePushPublicKey ─────────────────────────────────────────────────────────
describe('usePushPublicKey', () => {
  it('GETs /push/public-key with an abort signal and returns the key string', async () => {
    requestMock.mockResolvedValue({ publicKey: 'BJ-vapid-key' });

    const { result } = renderHook(() => usePushPublicKey(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe('BJ-vapid-key');
    expect(calledUrl()).toBe('/push/public-key');
    expect(calledOpts().signal).toBeInstanceOf(AbortSignal);
  });

  it('treats a 404 ApiError as "push disabled" and resolves to null (not an error)', async () => {
    requestMock.mockRejectedValue(
      new ApiError('web push is not configured on this install', 404),
    );

    const { result } = renderHook(() => usePushPublicKey(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('falls back to message-matching when a non-ApiError says "not configured"', async () => {
    requestMock.mockRejectedValue(new Error('web push is Not Configured'));

    const { result } = renderHook(() => usePushPublicKey(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('maps an empty publicKey to null so the UI hides the Enable button', async () => {
    requestMock.mockResolvedValue({ publicKey: '' });

    const { result } = renderHook(() => usePushPublicKey(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('is null-safe when the server returns a null body', async () => {
    requestMock.mockResolvedValue(null);

    const { result } = renderHook(() => usePushPublicKey(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('rethrows non-404 failures so genuine outages surface as query errors — without retrying', async () => {
    requestMock.mockRejectedValue(new ApiError('boom', 500));

    const { result } = renderHook(() => usePushPublicKey(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain('boom');
    // retry: false — the hook must not hammer a failing endpoint.
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});

// ── usePushSubscriptions ─────────────────────────────────────────────────────
describe('usePushSubscriptions', () => {
  it('GETs /push/subscribe and returns the per-device rows', async () => {
    const rows = [
      makeRow({ id: 1 }),
      makeRow({ id: 2, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/xyz' }),
    ];
    requestMock.mockResolvedValue(rows);

    const { result } = renderHook(() => usePushSubscriptions(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.map((r) => r.id)).toEqual([1, 2]);
    expect(calledUrl()).toBe('/push/subscribe');
    expect(calledOpts().signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces an empty device list without erroring', async () => {
    requestMock.mockResolvedValue([]);

    const { result } = renderHook(() => usePushSubscriptions(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('propagates a fetch failure into the query error state', async () => {
    requestMock.mockRejectedValue(new ApiError('db down', 500));

    const { result } = renderHook(() => usePushSubscriptions(), { wrapper: wrapperFor(makeClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain('db down');
  });
});

// ── useSubscribePush ─────────────────────────────────────────────────────────
describe('useSubscribePush', () => {
  it('POSTs the subscription body, returns the row, invalidates the list, and toasts success', async () => {
    const row = makeRow({ id: 7 });
    requestMock.mockResolvedValue(row);
    const client = makeClient();

    const { result } = renderHook(() => useSubscribePush(), { wrapper: wrapperFor(client) });

    let returned: PushSubscriptionRow | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync(subscribeBody);
    });

    expect(returned).toEqual(row);
    expect(calledUrl()).toBe('/push/subscribe');
    expect(calledOpts().method).toBe('POST');
    expect(calledOpts().body).toBe(JSON.stringify(subscribeBody));
    expect(invalidateSpy).toHaveBeenCalledWith(client, { queryKey: pushKeys.list });
    expect(toastSuccess).toHaveBeenCalledWith(
      'toast.webpush.subscribe.success',
      'Browser push enabled on this device',
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('routes a server failure to the error toast and skips invalidation', async () => {
    const boom = new ApiError('save failed', 500);
    requestMock.mockRejectedValue(boom);

    const { result } = renderHook(() => useSubscribePush(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await expect(result.current.mutateAsync(subscribeBody)).rejects.toThrow(/save failed/);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]?.[0]).toBe(boom);
    expect(toastError.mock.calls[0]?.[1]).toBe('toast.webpush.subscribe.error');
  });
});

// ── useUnsubscribePush ───────────────────────────────────────────────────────
describe('useUnsubscribePush', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';

  it('DELETEs /push/subscribe with the endpoint body, invalidates, and toasts success', async () => {
    requestMock.mockResolvedValue(undefined); // backend replies 204 No Content
    const client = makeClient();

    const { result } = renderHook(() => useUnsubscribePush(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(endpoint);
    });

    expect(calledUrl()).toBe('/push/subscribe');
    expect(calledOpts().method).toBe('DELETE');
    expect(calledOpts().body).toBe(JSON.stringify({ endpoint }));
    expect(invalidateSpy).toHaveBeenCalledWith(client, { queryKey: pushKeys.list });
    expect(toastSuccess).toHaveBeenCalledWith(
      'toast.webpush.unsubscribe.success',
      'Browser push removed for this device',
    );
  });

  it('routes a 404 (already removed) to the error toast without invalidating', async () => {
    const notFound = new ApiError('subscription not found', 404);
    requestMock.mockRejectedValue(notFound);

    const { result } = renderHook(() => useUnsubscribePush(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await expect(result.current.mutateAsync(endpoint)).rejects.toThrow(/not found/);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]?.[1]).toBe('toast.webpush.unsubscribe.error');
  });
});
