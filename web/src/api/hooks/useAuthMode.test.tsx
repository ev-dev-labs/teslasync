// useAuthMode hook tests.
//
// Covers:
//
//   - useAuthMode resolves to { mode: 'open' } when the backend
//     reports open mode, with subject_header / subject / provider_hint
//     left undefined and every capability false.
//   - useAuthMode resolves to { mode: 'forward_auth', subject, … }
//     when the backend reports an authenticated request.
//   - useAuthMode resolves to mode=forward_auth with subject=null
//     when the backend reports forward-auth but the proxy stripped
//     the header on this specific request.
//   - useIsForwardAuth derives `true` only when the resolved mode is
//     forward_auth (false in loading + open + error states).
//   - useAuthSubject returns null in open mode and in forward_auth
//     mode without a subject; returns the trimmed subject otherwise.
//   - The hook calls request() with `/system/auth-mode` and threads
//     the AbortSignal through.
//   - The hook surfaces ApiError on transport failures so consumers
//     can render an offline state.
//
// Sibling-of-source location is mandatory — the gate's git-status
// regex matches `api/hooks/useAuthMode` as a substring, which a
// __tests__/ subdir would interrupt.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { ApiError, request } from '@/api/client';
import { useAuthMode, useAuthSubject, useIsForwardAuth, authModeKeys } from './useAuthMode';
import type { AuthModeResponse } from '@/api/types';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const openModePayload: AuthModeResponse = {
  mode: 'open',
  capabilities: {
    step_up_reauth: false,
    totp_enrollment: false,
    session_list: false,
    impersonation: false,
    rbac: false,
  },
};

const forwardAuthPayload: AuthModeResponse = {
  mode: 'forward_auth',
  subject_header: 'X-Forwarded-User',
  subject: 'alice',
  provider_hint: 'authentik',
  capabilities: {
    step_up_reauth: true,
    totp_enrollment: true,
    session_list: true,
    impersonation: true,
    rbac: true,
  },
};

const forwardAuthMissingSubjectPayload: AuthModeResponse = {
  mode: 'forward_auth',
  subject_header: 'X-Forwarded-User',
  subject: null,
  capabilities: {
    step_up_reauth: true,
    totp_enrollment: true,
    session_list: true,
    impersonation: true,
    rbac: true,
  },
};

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('authModeKeys', () => {
  it('exports a stable readonly key tuple', () => {
    expect(authModeKeys.all).toEqual(['auth', 'mode']);
  });
});

describe('useAuthMode', () => {
  it('resolves to open mode payload when the backend reports open', async () => {
    mockedRequest.mockResolvedValueOnce(openModePayload);
    const { result } = renderHook(() => useAuthMode(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.mode).toBe('open');
    expect(result.current.data?.subject_header).toBeUndefined();
    expect(result.current.data?.subject).toBeUndefined();
    expect(result.current.data?.provider_hint).toBeUndefined();
    expect(result.current.data?.capabilities.step_up_reauth).toBe(false);
    expect(result.current.data?.capabilities.totp_enrollment).toBe(false);
    expect(result.current.data?.capabilities.session_list).toBe(false);
    expect(result.current.data?.capabilities.impersonation).toBe(false);
    expect(result.current.data?.capabilities.rbac).toBe(false);
  });

  it('resolves to forward-auth payload with subject + provider_hint', async () => {
    mockedRequest.mockResolvedValueOnce(forwardAuthPayload);
    const { result } = renderHook(() => useAuthMode(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(forwardAuthPayload);
  });

  it('resolves to forward-auth with subject=null when proxy stripped header', async () => {
    mockedRequest.mockResolvedValueOnce(forwardAuthMissingSubjectPayload);
    const { result } = renderHook(() => useAuthMode(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.mode).toBe('forward_auth');
    expect(result.current.data?.subject).toBeNull();
  });

  it('calls request() against /system/auth-mode with an AbortSignal', async () => {
    mockedRequest.mockResolvedValueOnce(openModePayload);
    const { result } = renderHook(() => useAuthMode(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [path, opts] = mockedRequest.mock.calls[0] ?? [];
    expect(path).toBe('/system/auth-mode');
    // The hook must thread the React Query signal so the in-flight
    // request gets cancelled when the consumer unmounts.
    expect(opts).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it('surfaces transport failures as ApiError', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('Service Unavailable', 503));
    const { result } = renderHook(() => useAuthMode(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(503);
  });
});

describe('useIsForwardAuth', () => {
  it('returns false while the contract endpoint is loading', () => {
    // No mock resolution → query stays in loading state synchronously.
    mockedRequest.mockReturnValueOnce(new Promise(() => {}));
    const { result } = renderHook(() => useIsForwardAuth(), { wrapper });
    expect(result.current).toBe(false);
  });

  it('returns true when the resolved mode is forward_auth', async () => {
    mockedRequest.mockResolvedValueOnce(forwardAuthPayload);
    const { result } = renderHook(() => useIsForwardAuth(), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('returns false in open mode', async () => {
    mockedRequest.mockResolvedValueOnce(openModePayload);
    const { result } = renderHook(() => useIsForwardAuth(), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalled());
    // After resolution the value remains false.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current).toBe(false);
  });
});

describe('useAuthSubject', () => {
  it('returns null in open mode', async () => {
    mockedRequest.mockResolvedValueOnce(openModePayload);
    const { result } = renderHook(() => useAuthSubject(), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current).toBeNull();
  });

  it('returns null in forward-auth mode when the proxy stripped the header', async () => {
    mockedRequest.mockResolvedValueOnce(forwardAuthMissingSubjectPayload);
    const { result } = renderHook(() => useAuthSubject(), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current).toBeNull();
  });

  it('returns the resolved subject string in forward-auth mode', async () => {
    mockedRequest.mockResolvedValueOnce(forwardAuthPayload);
    const { result } = renderHook(() => useAuthSubject(), { wrapper });
    await waitFor(() => expect(result.current).toBe('alice'));
  });
});
