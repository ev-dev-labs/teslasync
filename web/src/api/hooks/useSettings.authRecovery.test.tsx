import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetSudoStateForTests,
  registerSudoChallengeProvider,
  SudoCanceledError,
} from '../client';
import { OfflineWriteRejectedError } from '../offlineCache';
import { __flushQueryBroadcastForTests } from '@/lib/queryBroadcast';
import { settingsKeys, useAuthURL, useDisconnectAuth, useRefreshAuth } from './useSettings';

const { success, error } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success, error }),
}));

const actions = [
  { hook: useAuthURL, path: '/auth/url' },
  { hook: useRefreshAuth, path: '/auth/refresh' },
  { hook: useDisconnectAuth, path: '/auth/disconnect' },
] as const;

function setup<T>(hook: () => T) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { networkMode: 'online', retry: 2, retryDelay: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { ...renderHook(hook, { wrapper: Wrapper }), qc };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  __resetSudoStateForTests();
  success.mockReset();
  error.mockReset();
  onlineManager.setOnline(true);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  __flushQueryBroadcastForTests();
  __resetSudoStateForTests();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  window.history.replaceState(null, '', '/');
});

describe.each(actions)('auth recovery $path', ({ hook, path }) => {
  it('rejects offline immediately and never replays after reconnect', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    onlineManager.setOnline(false);
    const fetch = vi.spyOn(globalThis, 'fetch');
    const challenge = vi.fn();
    registerSudoChallengeProvider(challenge);
    const { result, qc } = setup(() => hook());
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toBeInstanceOf(OfflineWriteRejectedError);
    });
    expect(result.current.isPaused).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(challenge).not.toHaveBeenCalled();

    await act(async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      onlineManager.setOnline(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves online recovery in historical views and the sudo replay', async () => {
    window.history.replaceState(null, '', '/settings?as_of=2026-10-01T00:00:00Z');
    const payload = path === '/auth/url' ? { auth_url: 'https://auth.tesla.com/recovery' } : undefined;
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ error: 'Step up required', code: 'SUDO_REQUIRED' }, 401))
      .mockResolvedValueOnce(payload ? json(payload) : new Response(null, { status: 204 }));
    const challenge = vi.fn().mockResolvedValue({ mode: 'session', token: 'test-sudo-token' });
    registerSudoChallengeProvider(challenge);
    const { result, qc } = setup(() => hook());
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    await act(async () => {
      // directRequest exposes camelCase aliases alongside the snake_case
      // wire keys, so the replayed payload carries authUrl too.
      const expected = payload ? { ...payload, authUrl: payload.auth_url } : payload;
      await expect(result.current.mutateAsync()).resolves.toEqual(expected);
    });
    expect(challenge).toHaveBeenCalledExactlyOnceWith(path);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, options] = fetch.mock.calls[1]!;
    expect(url).toBe(`/api/v1${path}`);
    expect(options?.method).toBe('POST');
    expect(new Headers(options?.headers).get('X-Sudo-Token')).toBe('test-sudo-token');
    expect(success).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    if (path !== '/auth/url') {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsKeys.authStatus });
    }
  });

  it('does not retry a cancelled sudo challenge even with retry-enabled defaults', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ error: 'Step up required', code: 'SUDO_REQUIRED' }, 401));
    const cancelled = new SudoCanceledError();
    const challenge = vi.fn().mockRejectedValue(cancelled);
    registerSudoChallengeProvider(challenge);
    const { result, qc } = setup(() => hook());
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toBe(cancelled);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(challenge).toHaveBeenCalledExactlyOnceWith(path);
    expect(error).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
