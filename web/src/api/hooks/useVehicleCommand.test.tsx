// useVehicleCommand hook tests.
//
// Covers the single export of ./useVehicleCommand — the shared mutation used
// by both the CommandPalette and the Commands page to POST a remote command
// to a vehicle. The contract under test is:
//
//   - the exact request shape: POST /vehicles/{id}/command with a JSON body of
//     { command, params } (params omitted when absent);
//   - the success path: a success toast + invalidation of the four caches the
//     command can dirty (vehicle-state, command-latest, command-history,
//     vehicles);
//   - the "soft failure" path: the backend answers HTTP 200 with
//     { success:false, error:"<reason>" }, and the hook must surface that
//     backend `error` — not a generic string — so the user learns WHY the
//     command was rejected (this is the real bug the tests pin down: the
//     handler never sends a `message` field, so the old `data.message` read was
//     always undefined and the reason was silently dropped);
//   - null-safety: a 204 / empty body must not throw (the old `data.success`
//     read crashed on undefined);
//   - the Tesla-token-expired path: the failed args are queued for replay and
//     NO error toast fires (the <TeslaReauthBanner> owns that surface), and the
//     queued closure genuinely replays the original command;
//   - the hard-failure path: a thrown Error becomes an interpolated error toast
//     and does NOT queue or invalidate.
//
// Network is mocked at the `../client` boundary (repo convention). The toast
// bridge, the i18n `t`, and the Tesla-recovery queue are stubbed so we can
// assert the exact user-visible string + replay call each branch produces
// without mounting providers. The real TeslaAuthExpiredError class is used so
// the hook's `isTeslaAuthExpiredError` duck-type runs against a genuine
// instance.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

const { queueSpy } = vi.hoisted(() => ({ queueSpy: vi.fn() }));

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return { ...actual, request: vi.fn() };
});

vi.mock('@/components/feedback', async () => {
  const actual = await vi.importActual<typeof import('@/components/feedback')>(
    '@/components/feedback',
  );
  return {
    ...actual,
    useToast: () => ({
      success: successToast,
      error: errorToast,
      info: vi.fn(),
      warning: vi.fn(),
      toast: vi.fn(),
      dismiss: vi.fn(),
    }),
  };
});

vi.mock('@/lib/teslaAuthRecovery', () => ({
  queueTeslaMutation: queueSpy,
}));

// Deterministic, interpolation-faithful `t` so assertions read the real
// English default strings the hook passes. Mirrors i18next semantics for both
// `t(key, 'default', vars)` and `t(key, { defaultValue, ...vars })`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars: Record<string, unknown>) =>
    tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k] ?? ''));
  const t = (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
    if (typeof defaultValue === 'string') return interpolate(defaultValue, options ?? {});
    if (defaultValue && typeof defaultValue === 'object') {
      const opts = defaultValue as Record<string, unknown>;
      const tpl = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
      return interpolate(tpl, opts);
    }
    return key;
  };
  return { ...actual, useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

import { request } from '../client';
import { TeslaAuthExpiredError } from '@/lib/resilience';
import { useVehicleCommand } from './useVehicleCommand';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

function lastRequest(idx = 0): { url: string; opts: { method?: string; headers?: Record<string, string>; body?: string } } {
  const [url, opts] = mockedRequest.mock.calls[idx] as [string, { method?: string; headers?: Record<string, string>; body?: string }];
  return { url, opts };
}

function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>): unknown[][] {
  return spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
}

beforeEach(() => {
  mockedRequest.mockReset();
  successToast.mockReset();
  errorToast.mockReset();
  queueSpy.mockReset();
});

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

describe('useVehicleCommand — request shape', () => {
  it('POSTs /vehicles/{id}/command with a JSON body of { command, params }', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true, result: 'success' });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehicleCommand(), { wrapper: Wrapper });

    await result.current.mutateAsync({ vehicleId: 7, command: 'honk_horn', params: { times: 2 } });

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const { url, opts } = lastRequest();
    // No /api/v1 prefix — the client adds it. Path id is interpolated raw.
    expect(url).toBe('/vehicles/7/command');
    expect(opts.method).toBe('POST');
    expect(opts.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body as string)).toEqual({
      command: 'honk_horn',
      params: { times: 2 },
    });
  });

  it('omits params from the body when the caller does not supply them', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true, result: 'success' });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehicleCommand(), { wrapper: Wrapper });

    await result.current.mutateAsync({ vehicleId: 3, command: 'flash_lights' });

    // JSON.stringify drops the undefined `params` key entirely.
    expect(JSON.parse(lastRequest().opts.body as string)).toEqual({ command: 'flash_lights' });
  });
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe('useVehicleCommand — success', () => {
  it('shows a success toast and invalidates the four command-dirtied caches', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true, result: 'success' });
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useVehicleCommand(), { wrapper: Wrapper });

    await result.current.mutateAsync({ vehicleId: 7, command: 'honk_horn' });

    expect(successToast).toHaveBeenCalledTimes(1);
    expect(successToast).toHaveBeenCalledWith('Command sent successfully');
    expect(errorToast).not.toHaveBeenCalled();

    const keys = invalidatedKeys(invalidateSpy);
    expect(invalidateSpy).toHaveBeenCalledTimes(4);
    expect(keys).toContainEqual(['vehicle-state', 7]);
    // Both command query keys are normalized so numeric ids invalidate
    // consumers initialized from string route params (and vice versa).
    expect(keys).toContainEqual(['command-latest', '7']);
    expect(keys).toContainEqual(['command-history', '7']);
    expect(keys).toContainEqual(['vehicles']);
  });

  it('prefers a backend-supplied friendly message over the default when present', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true, message: 'Horn honked' });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehicleCommand(), { wrapper: Wrapper });

    await result.current.mutateAsync({ vehicleId: 1, command: 'honk_horn' });

    expect(successToast).toHaveBeenCalledWith('Horn honked');
  });
});

// ---------------------------------------------------------------------------
// Soft failure (HTTP 200, success:false) — the dropped-error bug fix
// ---------------------------------------------------------------------------

describe('useVehicleCommand — soft failure (success:false)', () => {
  it('surfaces the backend `error` reason instead of a generic message', async () => {
    // Backend contract: { success:false, error:"<reason>" } with HTTP 200.
    mockedRequest.mockResolvedValueOnce({ success: false, error: 'vehicle is offline' });
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useVehicleCommand(), { wrapper: Wrapper });

    await result.current.mutateAsync({ vehicleId: 7, command: 'lock' });

    expect(errorToast).toHaveBeenCalledTimes(1);
    expect(errorToast).toHaveBeenCalledWith('vehicle is offline');
    expect(successToast).not.toHaveBeenCalled();
    // The HTTP call still succeeded, so the caches are refreshed regardless of
    // the command-level outcome.
    expect(invalidateSpy).toHaveBeenCalledTimes(4);
  });

  it('falls back to a generic failure message when the body carries no reason', async () => {
    mockedRequest.mockResolvedValueOnce({ success: false });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehicleCommand(), { wrapper: Wrapper });

    await result.current.mutateAsync({ vehicleId: 7, command: 'lock' });

    expect(errorToast).toHaveBeenCalledWith('Command failed');
  });

  it('treats a 204 / empty body as a soft failure without throwing (null-safety)', async () => {
    // The old code read `data.success` directly and crashed on undefined.
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehicleCommand(), { wrapper: Wrapper });

    await result.current.mutateAsync({ vehicleId: 7, command: 'lock' });

    // The mutation itself resolved (no throw); only the command outcome is a
    // failure, surfaced via the generic toast.
    expect(result.current.isError).toBe(false);
    expect(errorToast).toHaveBeenCalledWith('Command failed');
    expect(successToast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tesla token expiry — queue + silent, then replay
// ---------------------------------------------------------------------------

describe('useVehicleCommand — Tesla token expiry', () => {
  it('queues the command for replay and stays silent (no error toast)', async () => {
    mockedRequest.mockRejectedValueOnce(new TeslaAuthExpiredError('Tesla account disconnected'));
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useVehicleCommand(), { wrapper: Wrapper });

    await expect(
      result.current.mutateAsync({ vehicleId: 7, command: 'honk_horn' }),
    ).rejects.toBeInstanceOf(TeslaAuthExpiredError);

    expect(queueSpy).toHaveBeenCalledTimes(1);
    expect(queueSpy.mock.calls[0][0]).toBeTypeOf('function');
    // The <TeslaReauthBanner> is the recovery surface — no toast here.
    expect(errorToast).not.toHaveBeenCalled();
    // onError path only — no cache invalidation.
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('replays the original command when the queued closure is drained', async () => {
    mockedRequest.mockRejectedValueOnce(new TeslaAuthExpiredError('Tesla account disconnected'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehicleCommand(), { wrapper: Wrapper });

    await expect(
      result.current.mutateAsync({ vehicleId: 7, command: 'honk_horn', params: { times: 1 } }),
    ).rejects.toBeInstanceOf(TeslaAuthExpiredError);

    const replay = queueSpy.mock.calls[0][0] as () => Promise<unknown>;
    mockedRequest.mockResolvedValueOnce({ success: true, result: 'success' });

    await act(async () => {
      await replay();
    });

    // The closure re-issued the exact same command with the original args.
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    const replayed = lastRequest(1);
    expect(replayed.url).toBe('/vehicles/7/command');
    expect(JSON.parse(replayed.opts.body as string)).toEqual({
      command: 'honk_horn',
      params: { times: 1 },
    });
  });
});

// ---------------------------------------------------------------------------
// Hard failure — thrown Error
// ---------------------------------------------------------------------------

describe('useVehicleCommand — hard failure', () => {
  it('shows an interpolated error toast and neither queues nor invalidates', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('network down'));
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useVehicleCommand(), { wrapper: Wrapper });

    await expect(
      result.current.mutateAsync({ vehicleId: 7, command: 'honk_horn' }),
    ).rejects.toThrow('network down');

    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));
    expect(errorToast).toHaveBeenCalledWith('Command failed: network down');
    expect(queueSpy).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
