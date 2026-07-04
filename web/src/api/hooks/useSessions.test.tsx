// useSessions hook tests.
//
// Covers every runtime export of api/hooks/useSessions:
//
//   - sessionKeys                — stable readonly list-key tuple.
//   - useSessions()              — the layered list query. Exercises the
//     happy path, the null-safe empty-list coercions, the AUTH_MODE_OPEN
//     "feature unavailable" 501 branch that must read as SUCCESS (not an
//     error), the re-throw of genuine failures, and the `enabled` gate.
//   - useRevokeSession()         — single-session DELETE, URL-encoding,
//     list invalidation, and the error path.
//   - useRevokeAllOtherSessions()— bulk DELETE, pluralised success toast,
//     the revoked-count null-safety fix, and the error path.
//
// Sibling-of-source location is mandatory — the elevation gate's
// git-status regex matches `api/hooks/useSessions` as a contiguous
// substring, which a __tests__/ subdir would interrupt.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Network boundary: mock request() but keep the real ApiError / isApiError
// so the queryFn's `isApiError(err) && err.code === AUTH_MODE_OPEN_CODE`
// discriminator runs against genuine instances.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

// Toast + cross-tab broadcast are side effects we assert on directly
// rather than routing through the real ToastProvider / BroadcastChannel.
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock('@/lib/queryBroadcast', () => ({
  invalidateAndBroadcast: vi.fn(),
}));

import { ApiError, request, AUTH_MODE_OPEN_CODE } from '@/api/client';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import {
  sessionKeys,
  useSessions,
  useRevokeSession,
  useRevokeAllOtherSessions,
  type ActiveSession,
  type ActiveSessionsResponse,
  type RevokeAllOthersResponse,
} from './useSessions';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;
const mockedInvalidate = invalidateAndBroadcast as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const sessionRow: ActiveSession = {
  id: 'sess-1',
  user_agent: 'Mozilla/5.0',
  ip: '203.0.113.7',
  created_at: '2025-06-01T10:00:00Z',
  last_seen_at: '2025-06-02T12:30:00Z',
  current: true,
};

const otherRow: ActiveSession = {
  id: 'sess-2',
  user_agent: 'TeslaSync/1.0',
  ip: '198.51.100.4',
  created_at: '2025-05-20T08:00:00Z',
  last_seen_at: '2025-05-21T09:00:00Z',
  revoked_at: undefined,
  current: false,
};

beforeEach(() => {
  mockedRequest.mockReset();
  mockedInvalidate.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe('sessionKeys', () => {
  it('exports a stable readonly list-key tuple', () => {
    expect(sessionKeys.list).toEqual(['sessions', 'list']);
  });
});

describe('useSessions', () => {
  it('maps the backend payload to { mode: "session", sessions } and threads the AbortSignal', async () => {
    mockedRequest.mockResolvedValueOnce({ mode: 'session', sessions: [sessionRow, otherRow] });
    const { result } = renderHook(() => useSessions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data as Extract<ActiveSessionsResponse, { mode: 'session' }>;
    expect(data.mode).toBe('session');
    expect(data.sessions).toHaveLength(2);
    expect(data.sessions.map((s) => s.id)).toEqual(['sess-1', 'sess-2']);

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [path, opts] = mockedRequest.mock.calls[0] ?? [];
    expect(path).toBe('/auth/sessions');
    expect(opts).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it('coerces a payload with a missing sessions array to an empty list', async () => {
    // Backend contract says sessions is always present, but the hook must
    // never hand `.map()` an undefined — defend the render boundary.
    mockedRequest.mockResolvedValueOnce({ mode: 'session' });
    const { result } = renderHook(() => useSessions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data as Extract<ActiveSessionsResponse, { mode: 'session' }>;
    expect(data.sessions).toEqual([]);
  });

  it('coerces a null payload (e.g. an empty 204 body) to an empty session list without throwing', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useSessions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    const data = result.current.data as Extract<ActiveSessionsResponse, { mode: 'session' }>;
    expect(data).toEqual({ mode: 'session', sessions: [] });
  });

  it('treats the AUTH_MODE_OPEN 501 response as a successful { mode: "open" } no-op', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError('feature requires forward-auth', 501, AUTH_MODE_OPEN_CODE),
    );
    const { result } = renderHook(() => useSessions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual({ mode: 'open' });
  });

  it('re-throws a non-open ApiError so the query surfaces isError', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('Service Unavailable', 503, 'UPSTREAM_DOWN'));
    const { result } = renderHook(() => useSessions(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(503);
    expect(result.current.data).toBeUndefined();
  });

  it('re-throws a plain (non-ApiError) transport failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useSessions(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain('network down');
  });

  it('does not fire the query when disabled via options.enabled = false', async () => {
    const { result } = renderHook(() => useSessions({ enabled: false }), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useRevokeSession', () => {
  it('DELETEs /auth/sessions/{id} and invalidates the list on success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useRevokeSession(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('sess-1');
    });

    const [path, opts] = mockedRequest.mock.calls[0] ?? [];
    expect(path).toBe('/auth/sessions/sess-1');
    expect(opts?.method).toBe('DELETE');
    expect(mockedInvalidate).toHaveBeenCalledWith(expect.anything(), {
      queryKey: ['sessions', 'list'],
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'settings.sessions.toasts.revoked',
      'Session signed out.',
    );
  });

  it('URL-encodes an id containing reserved characters', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useRevokeSession(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('a b/c#d');
    });

    expect(mockedRequest.mock.calls[0]?.[0]).toBe('/auth/sessions/a%20b%2Fc%23d');
  });

  it('routes failures to the error toast and does NOT invalidate the list', async () => {
    const err = new ApiError('forbidden', 403, 'SUDO_REQUIRED');
    mockedRequest.mockRejectedValueOnce(err);
    const { result } = renderHook(() => useRevokeSession(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync('sess-9')).rejects.toThrow(/forbidden/);
    });

    expect(mockedInvalidate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      err,
      'settings.sessions.errors.revoke',
      'Failed to sign out session',
    );
  });
});

describe('useRevokeAllOtherSessions', () => {
  it('DELETEs /auth/sessions/all-others, invalidates, and pluralises the toast for many devices', async () => {
    const response: RevokeAllOthersResponse = { mode: 'session', revoked: 3 };
    mockedRequest.mockResolvedValueOnce(response);
    const { result } = renderHook(() => useRevokeAllOtherSessions(), { wrapper });

    let resolved: RevokeAllOthersResponse | undefined;
    await act(async () => {
      resolved = await result.current.mutateAsync();
    });

    expect(resolved?.revoked).toBe(3);
    const [path, opts] = mockedRequest.mock.calls[0] ?? [];
    expect(path).toBe('/auth/sessions/all-others');
    expect(opts?.method).toBe('DELETE');
    expect(mockedInvalidate).toHaveBeenCalledWith(expect.anything(), {
      queryKey: ['sessions', 'list'],
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'settings.sessions.toasts.revokedAllOthers',
      'Signed out 3 other devices.',
    );
  });

  it('uses the singular noun when exactly one device was revoked', async () => {
    mockedRequest.mockResolvedValueOnce({ mode: 'session', revoked: 1 });
    const { result } = renderHook(() => useRevokeAllOtherSessions(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(toastSuccess).toHaveBeenCalledWith(
      'settings.sessions.toasts.revokedAllOthers',
      'Signed out 1 other device.',
    );
  });

  it('falls back to a zero count when the server omits revoked (null-safety)', async () => {
    // Guards against a malformed body rendering "Signed out undefined other devices."
    mockedRequest.mockResolvedValueOnce({ mode: 'session' } as RevokeAllOthersResponse);
    const { result } = renderHook(() => useRevokeAllOtherSessions(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(toastSuccess).toHaveBeenCalledWith(
      'settings.sessions.toasts.revokedAllOthers',
      'Signed out 0 other devices.',
    );
  });

  it('routes failures to the error toast without invalidating', async () => {
    const err = new ApiError('boom', 500);
    mockedRequest.mockRejectedValueOnce(err);
    const { result } = renderHook(() => useRevokeAllOtherSessions(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow(/boom/);
    });

    expect(mockedInvalidate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      err,
      'settings.sessions.errors.revokeAllOthers',
      'Failed to sign out other sessions',
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
