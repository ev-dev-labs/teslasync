import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSudoStateForTests, ApiError, registerSudoChallengeProvider } from '../client';
import { OperationalModeWriteError } from '@/lib/operationalMode';
import {
  useGuardConfig, useGuardEvents, useGuardPanic, useSetGuardConfig,
  useAcknowledgeGuardEvent, type GuardConfig, type GuardEvent,
} from './useGuard';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/feedback/Toast', () => ({ useToast: () => toast }));
vi.mock('@/lib/queryBroadcast', () => ({ invalidateAndBroadcast: vi.fn() }));

const clients: QueryClient[] = [];
const policy: GuardConfig = {
  vehicle_id: 42, enabled: false, home_geofence_id: 0, sensitivity: 'medium',
  auto_panic: false, created_at: '2026-10-14T12:00:00Z', updated_at: '2026-10-14T12:00:00Z',
};
const event: GuardEvent = {
  id: 7, vehicle_id: 42, ts: '2026-10-14T12:00:00Z', event_type: 'locked',
  from_state: 'false', to_state: 'true', details: null,
  acknowledged_at: null, acknowledged_by: null,
};

function wrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      // Guard writes must not inherit automatic mutation replay.
      mutations: { retry: 2 },
    },
  });
  clients.push(client);
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetSudoStateForTests();
  onlineManager.setOnline(true);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  onlineManager.setOnline(true);
  __resetSudoStateForTests();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Guard retained source outcomes through the actual request transport', () => {
  it('distinguishes active loading from an offline paused first load', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    const active = renderHook(() => useGuardConfig(42), { wrapper: wrapper() });
    expect(active.result.current.isLoading).toBe(true);
    expect(active.result.current.state).toMatchObject({
      status: 'initial', hasData: false, provenance: 'unknown', isRefreshBlocked: false,
      fatalError: null, refreshError: null,
    });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    active.unmount();
    fetch.mockClear();
    onlineManager.setOnline(false);
    const paused = renderHook(() => useGuardEvents(42), { wrapper: wrapper() });
    await waitFor(() => expect(paused.result.current.fetchStatus).toBe('paused'));
    expect(paused.result.current.isLoading).toBe(false);
    expect(paused.result.current.state).toMatchObject({
      status: 'initial', hasData: false, isRefreshBlocked: true,
      fatalError: null, refreshError: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a confirmed null policy and empty events distinct from unknown data', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input =>
      json(String(input).endsWith('/config') ? null : { vehicle_id: 42, events: [] }),
    );
    const { result } = renderHook(() => ({
      config: useGuardConfig(42), events: useGuardEvents(42),
    }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.events.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.config.isSuccess).toBe(true));
    expect(result.current.config.state).toMatchObject({
      data: null, hasData: true, status: 'unavailable', fatalError: null,
    });
    expect(result.current.events.state).toMatchObject({
      data: [], hasData: true, status: 'unavailable', provenance: 'historical',
    });
  });

  it('preserves actual false/zero policy values', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(policy));
    const { result } = renderHook(() => useGuardConfig(42), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.state).toMatchObject({
      status: 'ok', hasData: true, data: { enabled: false, home_geofence_id: 0 },
    });
  });

  it.each(['config', 'events'] as const)('retains confirmed empty %s through failure and recovery', async domain => {
    let failing = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      failing ? json({ error: 'Guard upstream unavailable' }, 502)
        : json(domain === 'config' ? null : { vehicle_id: 42, events: [] }),
    );
    const useGuardRead = domain === 'config' ? useGuardConfig : useGuardEvents;
    const { result } = renderHook(() => useGuardRead(42), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
    const retained = result.current.data;
    failing = true;
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.state.status).toBe('stale'));
    expect(result.current.state).toMatchObject({
      data: retained, hasData: true, fatalError: null, refreshError: { status: 502 },
    });
    failing = false;
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
    expect(result.current.state.refreshError).toBeNull();
  });

  it.each(['config', 'events'] as const)('retains %s on failed refresh and recovers independently', async domain => {
    let failing = false;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      failing ? json({ error: 'Guard upstream unavailable' }, 502)
        : json(domain === 'config' ? policy : { vehicle_id: 42, events: [event] }),
    );
    const useGuardRead = domain === 'config' ? useGuardConfig : useGuardEvents;
    const { result } = renderHook(
      () => useGuardRead(42),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const retained = result.current.data;
    const updatedAt = result.current.state.updatedAt;
    failing = true;
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.state).toMatchObject({
      data: retained, hasData: true, status: 'stale', fatalError: null, updatedAt,
      refreshError: { status: 502 },
    });
    expect(result.current.data).toBe(retained);
    expect(fetch.mock.calls.every(([url]) => String(url).endsWith(`/guard/${domain}`))).toBe(true);
    failing = false;
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.state.status).toBe('ok');
    expect(result.current.state.refreshError).toBeNull();
  });

  it('retains event rows during a paused refresh without inventing an error', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ vehicle_id: 42, events: [event] }),
    );
    const { result } = renderHook(() => useGuardEvents(42), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    fetch.mockClear();
    onlineManager.setOnline(false);
    act(() => { void result.current.refetch(); });
    await waitFor(() => expect(result.current.fetchStatus).toBe('paused'));
    expect(result.current.state).toMatchObject({
      data: [event], status: 'stale', hasData: true, isRefreshBlocked: true,
      fatalError: null, refreshError: null,
    });
    expect(fetch).not.toHaveBeenCalled();
    act(() => { onlineManager.setOnline(true); });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(result.current.state.status).toBe('ok');
  });

  it('does not leak retained policy across vehicle query keys or fetch disabled vehicles', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(policy));
    const { result, rerender } = renderHook(({ id }) => useGuardConfig(id), {
      initialProps: { id: 42 }, wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    fetch.mockClear();
    rerender({ id: 0 });
    expect(result.current.data).toBeUndefined();
    expect(result.current.state.hasData).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps initial HTTP failure fatal instead of fabricating an empty event feed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ error: 'Forbidden' }, 403));
    const { result } = renderHook(() => useGuardEvents(42), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.state).toMatchObject({
      status: 'initialFailure', data: undefined, hasData: false,
      fatalError: { status: 403 }, refreshError: null,
    });
  });
});

describe('Guard actual write transport boundaries', () => {
  it.each(['panic', 'config', 'acknowledge'] as const)(
    '%s rejects HTTP 502 without announcing success or replaying the write',
    async kind => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({
        error: 'Guard command failed',
        results: [{ command: 'honk_horn', ok: false, error: 'upstream failed' }],
      }, 502));
      const { result } = renderHook(() => ({
        panic: useGuardPanic(), config: useSetGuardConfig(), ack: useAcknowledgeGuardEvent(),
      }), { wrapper: wrapper() });
      await act(async () => {
        const attempt = kind === 'panic' ? result.current.panic.mutateAsync(42)
          : kind === 'config' ? result.current.config.mutateAsync({
            vehicleId: 42, enabled: true, home_geofence_id: null,
            sensitivity: 'medium', auto_panic: false,
          })
            : result.current.ack.mutateAsync({ vehicleId: 42, eventId: 7 });
        await expect(attempt).rejects.toMatchObject({ status: 502 });
      });
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['historical', 'offline'] as const)('blocks %s writes before any network attempt', async mode => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    if (mode === 'historical') {
      window.history.replaceState(null, '', '/?as_of=2026-10-14T12:00:00Z');
    } else {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      onlineManager.setOnline(false);
    }
    const { result } = renderHook(() => ({
      panic: useGuardPanic(), config: useSetGuardConfig(), ack: useAcknowledgeGuardEvent(),
    }), { wrapper: wrapper() });
    await act(async () => {
      await expect(result.current.panic.mutateAsync(42)).rejects.toBeInstanceOf(OperationalModeWriteError);
      await expect(result.current.config.mutateAsync({
        vehicleId: 42, enabled: true, home_geofence_id: null,
        sensitivity: 'medium', auto_panic: false,
      })).rejects.toBeInstanceOf(OperationalModeWriteError);
      await expect(result.current.ack.mutateAsync({ vehicleId: 42, eventId: 7 }))
        .rejects.toBeInstanceOf(OperationalModeWriteError);
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps sudo reauthentication fail-closed without a mounted challenge provider', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ error: 'Reauthentication required', code: 'SUDO_REQUIRED' }, 401),
    );
    const { result } = renderHook(() => useGuardPanic(), { wrapper: wrapper() });
    await act(async () => {
      await expect(result.current.mutateAsync(42)).rejects.toMatchObject({ name: 'SudoCanceledError' });
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each([401, 403])('rejects ordinary auth failure %s without bypass or replay', async status => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ error: 'Guard access denied' }, status),
    );
    const { result } = renderHook(() => useGuardPanic(), { wrapper: wrapper() });
    await act(async () => {
      await expect(result.current.mutateAsync(42)).rejects.toMatchObject({ status });
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('does not replay a write after an ambiguous network failure', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useGuardPanic(), { wrapper: wrapper() });
    await act(async () => {
      await expect(result.current.mutateAsync(42)).rejects.toThrow('Failed to fetch');
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('preserves the explicit sudo challenge and credentialed attempt', async () => {
    const challenge = vi.fn().mockResolvedValue({
      mode: 'session', token: 'guard-test-sudo',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    registerSudoChallengeProvider(challenge);
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ error: 'Reauthentication required', code: 'SUDO_REQUIRED' }, 401))
      .mockResolvedValueOnce(json({ vehicle_id: 42, vin: 'fixture', results: [] }));
    const { result } = renderHook(() => useGuardPanic(), { wrapper: wrapper() });
    await act(async () => { await result.current.mutateAsync(42); });
    expect(challenge).toHaveBeenCalledWith('/vehicles/42/guard/panic');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('X-Sudo-Token'))
      .toBe('guard-test-sudo');
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
