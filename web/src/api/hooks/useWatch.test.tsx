// useWatch hook tests.
//
// Covers every export of `./useWatch`:
//   - WatchSummary / WatchComplication — the watch-face payload shapes.
//   - watchKeys.{summary,complication}  — the query-key factory.
//   - useWatchSummary   — GET /watch/summary[?vehicle_id=…]
//   - useWatchComplication — GET /watch/complication[?vehicle_id=…]
//   - useWatchCommand   — POST /watch/command  { vehicle_id, command }
//
// The interesting surface is the file's bespoke `watchRequest` client, which
// swaps cookie/OAuth auth for an X-API-Key header sourced from either the `key`
// URL param (persisted into sessionStorage) or a previously-persisted session
// value, and opts out of the resilient 401-refresh loop (`skipAuthRefresh`).
// These branches are exercised through the public hooks by inspecting the
// arguments handed to the mocked `request`.
//
// The mutation contract is the real reason these tests exist: the backend
// answers HTTP 200 for BOTH success and soft-failure, discriminated by
// `success` with the reason carried in `message`. The hook must (a) surface the
// backend message on each branch, (b) fall back to a translated default when it
// is absent, and — the hardening this suite pins down — (c) NOT throw when the
// body is a 204 / empty / malformed payload (the old `data.success` read
// crashed on undefined).
//
// Network is mocked at the `@/api/client` boundary; the toast bridge and i18n
// `t` are stubbed so we can assert the exact user-visible string per branch.
// Nothing here touches a real endpoint.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('@/components/feedback/Toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/feedback/Toast')>(
    '@/components/feedback/Toast',
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

// Deterministic, interpolation-faithful `t` so assertions read the real English
// default strings the hook passes. Mirrors i18next semantics for the
// `t(key, 'default', vars)` form the hook uses.
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

import { request } from '@/api/client';
import {
  useWatchSummary,
  useWatchComplication,
  useWatchCommand,
  watchKeys,
  type WatchSummary,
  type WatchComplication,
} from './useWatch';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const WATCH_KEY_STORAGE = 'teslasync-watch-key';

type ReqOpts = {
  signal?: AbortSignal | null;
  skipAuthRefresh?: boolean;
  headers?: Headers;
  method?: string;
  body?: string;
};

function callAt(idx = 0): { path: string; opts: ReqOpts } {
  const [path, opts] = mockedRequest.mock.calls[idx] as [string, ReqOpts];
  return { path, opts };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 1, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

let originalLocation: Location;

function setSearch(search: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, search },
  });
}

const sampleSummary: WatchSummary = {
  vehicle_name: 'Model 3',
  state: 'online',
  battery_level: 82,
  range_km: 350,
  is_charging: false,
  charge_rate: 0,
  time_to_full: 0,
  is_locked: true,
  sentry_mode: false,
  inside_temp_c: 21,
  outside_temp_c: 15,
  is_climate_on: false,
  last_updated: '2025-06-01T12:00:00Z',
};

const sampleComplication: WatchComplication = {
  battery: '82%',
  range: '350km',
  state: '🟢',
  charging: false,
};

beforeEach(() => {
  mockedRequest.mockReset();
  successToast.mockReset();
  errorToast.mockReset();
  sessionStorage.clear();
  sessionStorage.setItem(WATCH_KEY_STORAGE, 'synthetic-default-key');
  originalLocation = window.location;
  setSearch('');
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
  sessionStorage.clear();
});

describe('watch prerequisite read failures and recovery', () => {
    const hooks = [
      { name: 'summary', hook: useWatchSummary, payload: sampleSummary },
      { name: 'complication', hook: useWatchComplication, payload: sampleComplication },
    ] as const;

    it.each(hooks)('reports denied session reads without crashing, polling, or claiming a missing key: $name', async ({ hook }) => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Synthetic storage read denied', 'SecurityError');
      });
      vi.useFakeTimers();
      try {
        const { result, rerender, unmount } = renderHook(() => hook(7), { wrapper });
        expect(result.current.availability).toBe('prerequisite-error');
        expect(result.current.availabilityError?.message).toBe('Watch access could not be checked');
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isSuccess).toBe(false);
        const error = result.current.availabilityError;
        rerender();
        expect(result.current.availabilityError).toBe(error);
        await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
        expect(mockedRequest).not.toHaveBeenCalled();
        unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it.each(hooks)('distinguishes an unexpected read failure and recovers to genuinely absent without requesting: $name', ({ hook }) => {
      sessionStorage.clear();
      const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Synthetic session read failure');
      });
      const { result } = renderHook(() => hook(7), { wrapper });
      expect(result.current.availability).toBe('prerequisite-error');
      expect(result.current.availabilityError).toBeInstanceOf(Error);
      act(() => {
        read.mockRestore();
        result.current.recheckAvailability();
      });
      expect(result.current.availability).toBe('not-configured');
      expect(result.current.availabilityError).toBeNull();
      expect(result.current.isSuccess).toBe(false);
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it.each(hooks)('recovers a denied read to the existing configured session key through local retry: $name', async ({ hook, payload }) => {
      const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Synthetic storage read denied', 'SecurityError');
      });
      mockedRequest.mockResolvedValue(payload);
      const { result } = renderHook(() => hook(7), { wrapper });
      expect(result.current.availability).toBe('prerequisite-error');
      act(() => {
        read.mockRestore();
        result.current.recheckAvailability();
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.availability).toBe('configured');
      expect(result.current.availabilityError).toBeNull();
      expect(result.current.data).toBe(payload);
      expect(mockedRequest).toHaveBeenCalledTimes(1);
      expect(callAt().opts.headers?.get('X-API-Key')).toBe('synthetic-default-key');
      expect(callAt().opts.skipAuthRefresh).toBe(true);
    });

    it.each(hooks)('preserves URL-key precedence when only the stored-key read is denied: $name', async ({ hook, payload }) => {
      setSearch('?key=synthetic-url-prerequisite-key');
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Synthetic stored-key read denied', 'SecurityError');
      });
      mockedRequest.mockResolvedValue(payload);
      const { result } = renderHook(() => hook(7), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.availability).toBe('configured');
      expect(result.current.availabilityError).toBeNull();
      expect(callAt().opts.headers?.get('X-API-Key')).toBe('synthetic-url-prerequisite-key');
    });

    it.each(hooks)('reports URL-key persistence denial, stops retries and polling, and recovers without bypassing persistence: $name', async ({ hook, payload }) => {
      setSearch('?key=synthetic-url-persist-key');
      const persist = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Synthetic storage persistence denied', 'SecurityError');
      });
      mockedRequest.mockResolvedValue(payload);
      const { result, unmount } = renderHook(() => hook(7), { wrapper });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.availability).toBe('prerequisite-error');
      expect(result.current.availabilityError?.message).toBe('Watch access could not be checked');
      expect(result.current.error?.name).toBe('WatchPrerequisiteError');
      expect(result.current.isSuccess).toBe(false);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(mockedRequest).not.toHaveBeenCalled();
      vi.useFakeTimers();
      try {
        await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
        expect(persist).toHaveBeenCalledTimes(1);
        expect(mockedRequest).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
      act(() => {
        persist.mockRestore();
        result.current.recheckAvailability();
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.availability).toBe('configured');
      expect(result.current.availabilityError).toBeNull();
      expect(sessionStorage.getItem(WATCH_KEY_STORAGE)).toBe('synthetic-url-persist-key');
      expect(mockedRequest).toHaveBeenCalledTimes(1);
      expect(callAt().opts.headers?.get('X-API-Key')).toBe('synthetic-url-persist-key');
      unmount();
    });
  });

// ---------------------------------------------------------------------------
// watchKeys — query-key factory
// ---------------------------------------------------------------------------

describe('watchKeys', () => {
  it('produces distinct, prefixed tuples per domain', () => {
    expect(watchKeys.summary(7)).toEqual(['watch-summary', 7]);
    expect(watchKeys.complication(7)).toEqual(['watch-complication', 7]);
    // The two domains must never collide for the same vehicle.
    expect(watchKeys.summary(7)).not.toEqual(watchKeys.complication(7));
  });

  it('preserves undefined so a vehicle-less key stays distinct', () => {
    expect(watchKeys.summary(undefined)).toEqual(['watch-summary', undefined]);
    expect(watchKeys.complication(undefined)).toEqual(['watch-complication', undefined]);
    // undefined must NOT collapse onto a concrete id.
    expect(watchKeys.summary(undefined)).not.toEqual(watchKeys.summary(0));
  });
});

// ---------------------------------------------------------------------------
// Exported payload shapes
// ---------------------------------------------------------------------------

describe('WatchSummary / WatchComplication shapes', () => {
  it('describes the full watch-face summary row', () => {
    // Constructing a value of the exported type both type-checks the interface
    // (via tsc in the gate) and asserts its runtime shape.
    expect(sampleSummary.battery_level).toBe(82);
    expect(sampleSummary.is_locked).toBe(true);
    expect(sampleSummary.range_km).toBe(350);
    expect(sampleSummary.last_updated).toBe('2025-06-01T12:00:00Z');
  });

  it('describes the minimal complication row', () => {
    expect(sampleComplication.battery).toBe('82%');
    expect(sampleComplication.charging).toBe(false);
    expect(sampleComplication.state).toBe('🟢');
  });
});

// ---------------------------------------------------------------------------
// useWatchSummary
// ---------------------------------------------------------------------------

describe('useWatchSummary', () => {
  it('GETs /watch/summary with vehicle_id, skips the auth refresh, and threads the AbortSignal', async () => {
    mockedRequest.mockResolvedValueOnce(sampleSummary);
    const { result } = renderHook(() => useWatchSummary(7), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.battery_level).toBe(82);

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const { path, opts } = callAt();
    // snake_case query param; no /api/v1 prefix (the client adds it).
    expect(path).toBe('/watch/summary?vehicle_id=7');
    expect(opts.skipAuthRefresh).toBe(true);
    expect(opts.headers?.get('Accept')).toBe('application/json');
    // Cancellation support: TanStack Query's signal must reach the client.
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('omits the query string entirely when no vehicle id is supplied', async () => {
    mockedRequest.mockResolvedValueOnce(sampleSummary);
    renderHook(() => useWatchSummary(), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callAt().path).toBe('/watch/summary');
  });

  it('treats vehicle id 0 as "no vehicle" and omits the param (backend picks the default)', async () => {
    mockedRequest.mockResolvedValueOnce(sampleSummary);
    renderHook(() => useWatchSummary(0), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    // `vehicleId ? … : ''` collapses the falsy 0 to an empty query string.
    expect(callAt().path).toBe('/watch/summary');
  });

  it('attaches the X-API-Key header from sessionStorage', async () => {
    sessionStorage.setItem(WATCH_KEY_STORAGE, 'persisted-key');
    mockedRequest.mockResolvedValueOnce(sampleSummary);
    renderHook(() => useWatchSummary(3), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callAt().opts.headers?.get('X-API-Key')).toBe('persisted-key');
  });

  it('reads the key from the ?key= URL param and persists it for the session', async () => {
    setSearch('?key=url-key');
    mockedRequest.mockResolvedValueOnce(sampleSummary);
    renderHook(() => useWatchSummary(3), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));

    expect(callAt().opts.headers?.get('X-API-Key')).toBe('url-key');
    // Persisted so subsequent (param-less) navigations keep authenticating.
    expect(sessionStorage.getItem(WATCH_KEY_STORAGE)).toBe('url-key');
  });

  it('lets the ?key= URL param override a stale persisted key', async () => {
    sessionStorage.setItem(WATCH_KEY_STORAGE, 'old-key');
    setSearch('?key=new-key');
    mockedRequest.mockResolvedValueOnce(sampleSummary);
    renderHook(() => useWatchSummary(3), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));

    expect(callAt().opts.headers?.get('X-API-Key')).toBe('new-key');
    expect(sessionStorage.getItem(WATCH_KEY_STORAGE)).toBe('new-key');
  });

  it('omits the X-API-Key header entirely when no key is available', async () => {
    sessionStorage.clear();
    mockedRequest.mockResolvedValueOnce(sampleSummary);
    const { result } = renderHook(() => useWatchSummary(3), { wrapper });
    expect(result.current.availability).toBe('not-configured');
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isLoading).toBe(false);
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('watch read availability', () => {
  const hooks = [
    { name: 'summary', hook: useWatchSummary },
    { name: 'complication', hook: useWatchComplication },
  ] as const;

  it.each(hooks)('gates automatic reads and polling without a configured key: $name', async ({ hook }) => {
    sessionStorage.clear();
    vi.useFakeTimers();
    try {
      const { result, unmount } = renderHook(() => hook(7), { wrapper });
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(result.current.availability).toBe('not-configured');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.data).toBeUndefined();
      expect(mockedRequest).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(hooks)('reconciles session key addition and removal on storage notifications: $name', async ({ hook }) => {
    sessionStorage.clear();
    mockedRequest.mockResolvedValue(sampleSummary);
    const { result } = renderHook(() => hook(7), { wrapper });
    expect(result.current.availability).toBe('not-configured');
    act(() => {
      sessionStorage.setItem(WATCH_KEY_STORAGE, 'synthetic-added-key');
      window.dispatchEvent(new StorageEvent('storage', { key: WATCH_KEY_STORAGE }));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.availability).toBe('configured');
    expect(callAt().opts.headers?.get('X-API-Key')).toBe('synthetic-added-key');
    act(() => {
      sessionStorage.removeItem(WATCH_KEY_STORAGE);
      window.dispatchEvent(new StorageEvent('storage', { key: WATCH_KEY_STORAGE }));
    });
    expect(result.current.availability).toBe('not-configured');
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(sampleSummary);
  });

  it('reconciles URL navigation and same-tab key changes on focus without persisting during render', async () => {
    sessionStorage.clear();
    const persist = vi.spyOn(Storage.prototype, 'setItem');
    mockedRequest.mockResolvedValue(sampleSummary);
    const { result } = renderHook(() => useWatchSummary(7), { wrapper });
    expect(persist).not.toHaveBeenCalled();
    act(() => {
      setSearch('?key=synthetic-navigation-key');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callAt().opts.headers?.get('X-API-Key')).toBe('synthetic-navigation-key');
    expect(sessionStorage.getItem(WATCH_KEY_STORAGE)).toBe('synthetic-navigation-key');
    act(() => {
      setSearch('');
      sessionStorage.clear();
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current.availability).toBe('not-configured');
    persist.mockRestore();
  });

  it.each(hooks)('keeps nonempty invalid or expired keys as real authentication failures: $name', async ({ hook }) => {
    sessionStorage.setItem(WATCH_KEY_STORAGE, 'synthetic-invalid-key');
    const authError = Object.assign(new Error('Invalid or expired API key'), { status: 401 });
    mockedRequest.mockRejectedValue(authError);
    const { result } = renderHook(() => hook(7), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.availability).toBe('configured');
    expect(result.current.error).toBe(authError);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(callAt().opts.skipAuthRefresh).toBe(true);
    expect(callAt().opts.headers?.get('X-API-Key')).toBe('synthetic-invalid-key');
  });

  it.each(hooks)('stops an automatic retry when the existing session key disappears during a failed read: $name', async ({ hook }) => {
    mockedRequest.mockImplementationOnce(() => {
      sessionStorage.removeItem(WATCH_KEY_STORAGE);
      window.dispatchEvent(new StorageEvent('storage', { key: WATCH_KEY_STORAGE }));
      return Promise.reject(new Error('Synthetic failed in-flight read'));
    });
    const { result } = renderHook(() => hook(7), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    await waitFor(() => expect(result.current.availability).toBe('not-configured'));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(result.current.isSuccess).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useWatchComplication
// ---------------------------------------------------------------------------

describe('useWatchComplication', () => {
  it('GETs /watch/complication with vehicle_id and passes the payload through', async () => {
    mockedRequest.mockResolvedValueOnce(sampleComplication);
    const { result } = renderHook(() => useWatchComplication(9), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.battery).toBe('82%');

    const { path, opts } = callAt();
    expect(path).toBe('/watch/complication?vehicle_id=9');
    expect(opts.skipAuthRefresh).toBe(true);
  });

  it('omits the query string when no vehicle id is supplied', async () => {
    mockedRequest.mockResolvedValueOnce(sampleComplication);
    renderHook(() => useWatchComplication(), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callAt().path).toBe('/watch/complication');
  });

  it('surfaces request failures as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useWatchComplication(9), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// useWatchCommand
// ---------------------------------------------------------------------------

describe('useWatchCommand', () => {
  it('POSTs /watch/command with the { vehicle_id, command } body and shows the backend success message', async () => {
    sessionStorage.setItem(WATCH_KEY_STORAGE, 'cmd-key');
    mockedRequest.mockResolvedValueOnce({ success: true, message: 'Command sent successfully' });
    const { result } = renderHook(() => useWatchCommand(), { wrapper });

    await result.current.mutateAsync({ vehicleId: 5, command: 'lock' });

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const { path, opts } = callAt();
    expect(path).toBe('/watch/command');
    expect(opts.method).toBe('POST');
    expect(opts.headers?.get('Content-Type')).toBe('application/json');
    // The bespoke client still injects the watch API key on writes.
    expect(opts.headers?.get('X-API-Key')).toBe('cmd-key');
    expect(JSON.parse(opts.body as string)).toEqual({ vehicle_id: 5, command: 'lock' });

    expect(successToast).toHaveBeenCalledWith('Command sent successfully');
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('defaults vehicle_id to 0 and falls back to the translated success default when message is absent', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useWatchCommand(), { wrapper });

    await result.current.mutateAsync({ command: 'honk_horn' });

    // Backend resolves the default vehicle when id is 0.
    expect(JSON.parse(callAt().opts.body as string)).toEqual({ vehicle_id: 0, command: 'honk_horn' });
    expect(successToast).toHaveBeenCalledWith('Command sent');
  });

  it('surfaces the backend reason on a soft failure (HTTP 200, success:false)', async () => {
    mockedRequest.mockResolvedValueOnce({ success: false, message: 'Command failed: vehicle offline' });
    const { result } = renderHook(() => useWatchCommand(), { wrapper });

    await result.current.mutateAsync({ vehicleId: 5, command: 'unlock' });

    expect(errorToast).toHaveBeenCalledWith('Command failed: vehicle offline');
    expect(successToast).not.toHaveBeenCalled();
  });

  it('falls back to the translated failure default when a soft failure carries no message', async () => {
    mockedRequest.mockResolvedValueOnce({ success: false });
    const { result } = renderHook(() => useWatchCommand(), { wrapper });

    await result.current.mutateAsync({ vehicleId: 5, command: 'unlock' });

    expect(errorToast).toHaveBeenCalledWith('Command failed');
  });

  it('treats a 204 / empty body as a soft failure without throwing (null-safety)', async () => {
    // The old code read `data.success` directly and crashed on undefined.
    mockedRequest.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useWatchCommand(), { wrapper });

    await result.current.mutateAsync({ vehicleId: 5, command: 'lock' });

    // The mutation itself resolved (no throw); only the command outcome failed.
    expect(result.current.isError).toBe(false);
    expect(errorToast).toHaveBeenCalledWith('Command failed');
    expect(successToast).not.toHaveBeenCalled();
  });

  it('interpolates a thrown Error into the translated error toast on a hard failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useWatchCommand(), { wrapper });

    await expect(
      result.current.mutateAsync({ vehicleId: 5, command: 'lock' }),
    ).rejects.toThrow('network down');

    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));
    expect(errorToast).toHaveBeenCalledWith('Watch command failed: network down');
    expect(successToast).not.toHaveBeenCalled();
  });
});
