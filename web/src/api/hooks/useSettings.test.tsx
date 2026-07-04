// useSettings hook-suite tests.
//
// Covers EVERY runtime export of useSettings.ts — the `settingsKeys` query-key
// factory plus all 21 TanStack Query hooks (7 queries + 14 mutations) — and
// exercises the type-only exports (`AppSettings`, `GasPriceStatus`,
// `GasPriceHistory`, `DashboardLayoutsPayload`, `PollingConfig`) through fully
// typed fixtures so any interface drift fails `tsc --noEmit`.
//
// For every hook we assert the facets that actually matter in production:
//   - the exact request path (no `/api/v1` double-prefix, snake_case params);
//   - the HTTP method + JSON body for mutations;
//   - AbortSignal threading so a route change cancels the in-flight fetch;
//   - `enabled` gating (car-prefs stays idle without a vehicle id; the gas
//     hooks stay idle when their caller passes `enabled=false`);
//   - the `safeArray` select guard on the list hooks (non-array → []);
//   - the explicit per-hook retry overrides (`retry:false` on the gas hooks,
//     `retry:1` on dashboard layouts) proven against a retry-enabled client;
//   - cache invalidation (local + cross-tab) and the success/error toast keys
//     each mutation emits, including the branch-dependent toggle messages.
//
// Network is stubbed at the request() boundary; the mutation-toast bridge is
// replaced with spies so each handler's exact i18n key + English fallback is
// asserted without mounting a ToastProvider / i18n instance. The real
// invalidateAndBroadcast runs against the test QueryClient (spied) and its
// coalesced cross-tab timer is drained in afterEach.
//
// Keep this test next to the hook — the gate's path-scoped checks match
// `api/hooks/useSettings` as a contiguous substring.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return { ...actual, request: vi.fn() };
});

// Replace the toast bridge with spies so onSuccess/onError assertions are exact
// and no ToastProvider / i18n instance is required.
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: successToast, error: errorToast }),
}));

import { request } from '../client';
import { __flushQueryBroadcastForTests } from '@/lib/queryBroadcast';
import type { AppSettings, GasPriceStatus, GasPriceHistory } from '@/api/types';
import {
  settingsKeys,
  useSettings,
  useSaveSettings,
  useAuthStatus,
  useAuthURL,
  useRefreshAuth,
  useDisconnectAuth,
  useVehicles,
  useSyncVehicles,
  useCarPreferences,
  useGasPriceStatus,
  useGasPriceHistory,
  usePollGasPrice,
  useToggleGasPrice,
  useUpdateGasPriceConfig,
  useDashboardLayouts,
  useSaveDashboardLayouts,
  useToggleAPISuspend,
  usePollingConfig,
  useUpdatePollingConfig,
  useCaptureStats,
  useVersionInfo,
  type DashboardLayoutsPayload,
  type PollingConfig,
} from './useSettings';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

/** The captured (url, options) tuple of a `request()` invocation. */
type ReqOpts = { method?: string; body?: string; signal?: unknown };
function callAt(n = 0): [string, ReqOpts] {
  return mockedRequest.mock.calls[n] as [string, ReqOpts];
}
function bodyAt(n = 0): unknown {
  return JSON.parse(callAt(n)[1].body ?? '{}');
}

/**
 * Build a QueryClient wrapper. `retry`/`retryDelay` are overridable so the
 * retry-override tests can run against a client that DOES retry and observe the
 * per-hook opt-outs. Default: no retries, instant, so error paths resolve fast.
 */
function makeWrapper(opts?: { retry?: number | boolean; retryDelay?: number }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: opts?.retry ?? false,
        retryDelay: opts?.retryDelay ?? 0,
        gcTime: 0,
      },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

/** Let a disabled query settle so "did NOT fire" is a real observation. */
const tick = () => new Promise((r) => setTimeout(r, 10));

// ── Typed fixtures (drift in any interface fails tsc --noEmit) ──────────────

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    unit_of_length: 'mi',
    unit_of_temp: 'F',
    unit_of_pressure: 'psi',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'dark',
    mode: 'dark',
    custom_primary: '#00f0ff',
    custom_accent: '#ff2d9b',
    gas_price_per_unit: 3.5,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 30,
    decimal_precision: 1,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'immediate',
    ...overrides,
  };
}

function makePollingConfig(overrides: Partial<PollingConfig> = {}): PollingConfig {
  return {
    vehicle_discovery: true,
    charge_state: true,
    climate_state: false,
    drive_state: true,
    location_data: true,
    vehicle_state: true,
    vehicle_config: false,
    on_demand_vehicle_discovery: false,
    on_demand_charge_state: false,
    on_demand_climate_state: false,
    on_demand_drive_state: false,
    on_demand_location_data: false,
    on_demand_vehicle_state: false,
    on_demand_vehicle_config: false,
    nearby_charging_sites: false,
    release_notes: false,
    recent_alerts: true,
    service_data: false,
    wake_up: false,
    commands: true,
    telemetry_capture: true,
    telemetry_capture_retention_days: 30,
    ...overrides,
  };
}

const gasStatus: GasPriceStatus = {
  enabled: true,
  poll_interval: '24h',
  last_poll_time: '2026-07-01T00:00:00Z',
  current_price: 3.79,
  current_price_kwh_eq: 0.11,
};

const gasHistoryRow: GasPriceHistory = {
  id: 1,
  price_per_unit: 3.79,
  unit: 'gallon',
  efficiency_mpg: 30,
  effective_from: '2026-06-01T00:00:00Z',
  effective_to: null,
  created_at: '2026-06-01T00:00:00Z',
};

const layouts: DashboardLayoutsPayload = {
  dashboards: [{ id: 'main', widgets: [] }],
  active_id: 'main',
};

beforeEach(() => {
  mockedRequest.mockReset();
  successToast.mockReset();
  errorToast.mockReset();
});

afterEach(() => {
  // Drain the coalesced cross-tab broadcast timer scheduled by
  // invalidateAndBroadcast so it can't fire after the env tears down.
  __flushQueryBroadcastForTests();
});

// ---------------------------------------------------------------------------
// settingsKeys (query-key factory)
// ---------------------------------------------------------------------------

describe('settingsKeys', () => {
  it('exposes stable, distinct tuples for every cached resource', () => {
    expect(settingsKeys.settings).toEqual(['settings']);
    expect(settingsKeys.authStatus).toEqual(['auth-status']);
    expect(settingsKeys.vehicles).toEqual(['vehicles']);
    expect(settingsKeys.gasPriceStatus).toEqual(['gas-price-status']);
    expect(settingsKeys.gasPriceHistory).toEqual(['gas-price-history']);
    expect(settingsKeys.dashboardLayouts).toEqual(['dashboard-layouts']);
    // No two roots collide in the cache.
    const roots = [
      settingsKeys.settings[0],
      settingsKeys.authStatus[0],
      settingsKeys.vehicles[0],
      settingsKeys.gasPriceStatus[0],
      settingsKeys.gasPriceHistory[0],
      settingsKeys.dashboardLayouts[0],
    ];
    expect(new Set(roots).size).toBe(roots.length);
  });

  it('scopes carPrefs per vehicle and keeps null distinct from a real id', () => {
    expect(settingsKeys.carPrefs(7)).toEqual(['car-prefs', 7]);
    expect(settingsKeys.carPrefs(null)).toEqual(['car-prefs', null]);
    expect(settingsKeys.carPrefs(7)).not.toEqual(settingsKeys.carPrefs(8));
  });
});

// ---------------------------------------------------------------------------
// useSettings (query) + useSaveSettings (mutation)
// ---------------------------------------------------------------------------

describe('useSettings', () => {
  it('GETs /settings, threads the abort signal, and passes the payload through', async () => {
    const payload = makeSettings({ theme: 'midnight' });
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.theme).toBe('midnight');

    const [url, opts] = callAt(0);
    expect(url).toBe('/settings');
    expect(url).not.toContain('/api/v1');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a request rejection as isError without leaking stale data', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('settings 500'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('useSaveSettings', () => {
  it('PUTs the settings body, invalidates the settings cache, and toasts success', async () => {
    const saved = makeSettings({ decimal_precision: 2 });
    mockedRequest.mockResolvedValueOnce(saved);

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSaveSettings(), { wrapper: Wrapper });

    const returned = await result.current.mutateAsync(saved);
    expect(returned.decimal_precision).toBe(2);

    const [url, opts] = callAt(0);
    expect(url).toBe('/settings');
    expect(opts.method).toBe('PUT');
    expect(bodyAt(0)).toEqual(saved);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsKeys.settings });
    expect(successToast).toHaveBeenCalledWith('toast.settings.save.success', 'Settings saved');
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('toasts the error (no invalidation) when the PUT fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('save boom'));

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSaveSettings(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(makeSettings())).rejects.toThrow('save boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.settings.save.error',
      'Failed to save settings',
    );
    expect(successToast).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Auth: useAuthStatus / useAuthURL / useRefreshAuth / useDisconnectAuth
// ---------------------------------------------------------------------------

describe('useAuthStatus', () => {
  it('GETs /auth/status, threads the signal, and exposes the authenticated flag', async () => {
    mockedRequest.mockResolvedValueOnce({
      authenticated: true,
      expires_at: '2026-08-01T00:00:00Z',
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAuthStatus(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.authenticated).toBe(true);
    expect(result.current.data?.expires_at).toBe('2026-08-01T00:00:00Z');

    const [url, opts] = callAt(0);
    expect(url).toBe('/auth/status');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('useAuthURL', () => {
  it('POSTs /auth/url and returns the generated auth_url with a success toast', async () => {
    mockedRequest.mockResolvedValueOnce({ auth_url: 'https://auth.tesla.com/x' });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAuthURL(), { wrapper: Wrapper });

    const res = await result.current.mutateAsync();
    expect(res.auth_url).toBe('https://auth.tesla.com/x');

    const [url, opts] = callAt(0);
    expect(url).toBe('/auth/url');
    expect(opts.method).toBe('POST');
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.auth.url.success',
      'Auth URL generated',
    );
  });

  it('toasts the error when auth-url generation fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('url boom'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAuthURL(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync()).rejects.toThrow('url boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.settings.auth.url.error',
      'Failed to get auth URL',
    );
    expect(successToast).not.toHaveBeenCalled();
  });
});

describe('useRefreshAuth', () => {
  it('POSTs /auth/refresh, invalidates auth status, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRefreshAuth(), { wrapper: Wrapper });

    await result.current.mutateAsync();

    const [url, opts] = callAt(0);
    expect(url).toBe('/auth/refresh');
    expect(opts.method).toBe('POST');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsKeys.authStatus });
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.auth.refresh.success',
      'Auth refreshed',
    );
  });
});

describe('useDisconnectAuth', () => {
  it('POSTs /auth/disconnect, invalidates auth status, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDisconnectAuth(), { wrapper: Wrapper });

    await result.current.mutateAsync();

    expect(callAt(0)[0]).toBe('/auth/disconnect');
    expect(callAt(0)[1].method).toBe('POST');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsKeys.authStatus });
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.auth.disconnect.success',
      'Tesla account disconnected',
    );
  });

  it('toasts the error when disconnect fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('disconnect boom'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDisconnectAuth(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync()).rejects.toThrow('disconnect boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.settings.auth.disconnect.error',
      'Failed to disconnect',
    );
  });
});

// ---------------------------------------------------------------------------
// Vehicles: useVehicles (query + safeArray) / useSyncVehicles (mutation)
// ---------------------------------------------------------------------------

describe('useVehicles', () => {
  it('GETs /vehicles, threads the signal, and returns the list', async () => {
    const payload = [
      { id: 1, name: 'Model 3', vin: '5YJ3E1' },
      { id: 2, name: 'Model Y', vin: '5YJYGD' },
    ];
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehicles(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe('Model 3');

    const [url, opts] = callAt(0);
    expect(url).toBe('/vehicles');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('coerces a non-array response to [] via the safeArray select guard', async () => {
    mockedRequest.mockResolvedValueOnce(null);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehicles(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(Array.isArray(result.current.data)).toBe(true);
  });
});

describe('useSyncVehicles', () => {
  it('POSTs /vehicles/sync, invalidates the vehicle list, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce({ synced: 3 });

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSyncVehicles(), { wrapper: Wrapper });

    const res = await result.current.mutateAsync();
    expect(res.synced).toBe(3);

    expect(callAt(0)[0]).toBe('/vehicles/sync');
    expect(callAt(0)[1].method).toBe('POST');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsKeys.vehicles });
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.vehicles.sync.success',
      'Vehicles synced',
    );
  });

  it('toasts the error when the sync fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('sync boom'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSyncVehicles(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync()).rejects.toThrow('sync boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.settings.vehicles.sync.error',
      'Failed to sync vehicles',
    );
  });
});

// ---------------------------------------------------------------------------
// useCarPreferences (query + enabled gate)
// ---------------------------------------------------------------------------

describe('useCarPreferences', () => {
  it('GETs /user-preferences/latest?vehicle_id=… for a real id and threads the signal', async () => {
    mockedRequest.mockResolvedValueOnce({
      setting_distance_unit: 'km',
      setting_temperature_unit: 'C',
      setting_tire_pressure_unit: 'bar',
      setting_24hr_time: true,
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCarPreferences(42), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.setting_distance_unit).toBe('km');
    expect(result.current.data?.setting_24hr_time).toBe(true);

    const [url, opts] = callAt(0);
    expect(url).toBe('/user-preferences/latest?vehicle_id=42');
    // snake_case query param, no double-prefix.
    expect(url).not.toContain('/api/v1');
    expect(url).toContain('vehicle_id=');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('is disabled (no fetch) while the vehicle id is null', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCarPreferences(null), { wrapper: Wrapper });

    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Gas price: status / history queries (+ enabled gate + retry:false)
// ---------------------------------------------------------------------------

describe('useGasPriceStatus', () => {
  it('GETs /gas-price/status when enabled and returns the status payload', async () => {
    mockedRequest.mockResolvedValueOnce(gasStatus);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGasPriceStatus(true), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.current_price).toBe(3.79);
    expect(callAt(0)[0]).toBe('/gas-price/status');
    expect(callAt(0)[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('is disabled (no fetch) when the caller passes enabled=false', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGasPriceStatus(false), { wrapper: Wrapper });

    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does NOT retry a failed fetch even when the client retries (source pins retry:false)', async () => {
    mockedRequest.mockRejectedValue(new Error('gas status 500'));

    const { Wrapper } = makeWrapper({ retry: 2, retryDelay: 0 });
    const { result } = renderHook(() => useGasPriceStatus(true), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});

describe('useGasPriceHistory', () => {
  it('GETs /gas-price/history and returns the rows when enabled', async () => {
    mockedRequest.mockResolvedValueOnce([gasHistoryRow]);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGasPriceHistory(true), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].price_per_unit).toBe(3.79);
    expect(callAt(0)[0]).toBe('/gas-price/history');
  });

  it('coerces a non-array response to [] via the safeArray select guard', async () => {
    mockedRequest.mockResolvedValueOnce(null);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGasPriceHistory(true), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('is disabled (no fetch) when enabled=false', async () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useGasPriceHistory(false), { wrapper: Wrapper });

    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('gas-price mutations', () => {
  it('usePollGasPrice POSTs /gas-price/poll and invalidates BOTH status + history', async () => {
    mockedRequest.mockResolvedValueOnce({ status: 'ok' });

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => usePollGasPrice(), { wrapper: Wrapper });

    await result.current.mutateAsync();

    expect(callAt(0)[0]).toBe('/gas-price/poll');
    expect(callAt(0)[1].method).toBe('POST');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsKeys.gasPriceStatus });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsKeys.gasPriceHistory });
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.gasPrice.poll.success',
      'Gas prices updated',
    );
  });

  it('useToggleGasPrice sends the enabled flag and toasts the ENABLED message', async () => {
    mockedRequest.mockResolvedValueOnce({ enabled: true });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useToggleGasPrice(), { wrapper: Wrapper });

    await result.current.mutateAsync(true);

    expect(callAt(0)[0]).toBe('/gas-price/toggle');
    expect(callAt(0)[1].method).toBe('POST');
    expect(bodyAt(0)).toEqual({ enabled: true });
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.gasPrice.toggle.enabled',
      'Gas price tracking enabled',
    );
  });

  it('useToggleGasPrice toasts the DISABLED message when toggled off', async () => {
    mockedRequest.mockResolvedValueOnce({ enabled: false });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useToggleGasPrice(), { wrapper: Wrapper });

    await result.current.mutateAsync(false);

    expect(bodyAt(0)).toEqual({ enabled: false });
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.gasPrice.toggle.disabled',
      'Gas price tracking disabled',
    );
  });

  it('useUpdateGasPriceConfig PUTs the poll_interval and invalidates the status', async () => {
    mockedRequest.mockResolvedValueOnce({ poll_interval: '12h' });

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateGasPriceConfig(), { wrapper: Wrapper });

    await result.current.mutateAsync('12h');

    expect(callAt(0)[0]).toBe('/gas-price/config');
    expect(callAt(0)[1].method).toBe('PUT');
    expect(bodyAt(0)).toEqual({ poll_interval: '12h' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsKeys.gasPriceStatus });
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.gasPrice.config.success',
      'Gas price config updated',
    );
  });

  it('useUpdateGasPriceConfig toasts the error when the PUT fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('config boom'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateGasPriceConfig(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync('12h')).rejects.toThrow('config boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.settings.gasPrice.config.error',
      'Failed to update gas price config',
    );
  });
});

// ---------------------------------------------------------------------------
// Dashboard layouts: useDashboardLayouts / useSaveDashboardLayouts
// ---------------------------------------------------------------------------

describe('useDashboardLayouts', () => {
  it('GETs /settings/dashboard-layouts and returns the {dashboards, active_id} payload', async () => {
    mockedRequest.mockResolvedValueOnce(layouts);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDashboardLayouts(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.active_id).toBe('main');
    expect(result.current.data?.dashboards).toHaveLength(1);
    expect(callAt(0)[0]).toBe('/settings/dashboard-layouts');
  });

  it('retries exactly once on failure (source pins retry:1) even under a chattier client', async () => {
    mockedRequest.mockRejectedValue(new Error('layouts 500'));

    const { Wrapper } = makeWrapper({ retry: 5, retryDelay: 0 });
    const { result } = renderHook(() => useDashboardLayouts(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // 1 initial attempt + 1 retry from the hook's explicit retry:1.
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });
});

describe('useSaveDashboardLayouts', () => {
  it('PUTs the layout payload and toasts success (no cache invalidation)', async () => {
    mockedRequest.mockResolvedValueOnce(layouts);

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSaveDashboardLayouts(), { wrapper: Wrapper });

    const returned = await result.current.mutateAsync(layouts);
    expect(returned.active_id).toBe('main');

    expect(callAt(0)[0]).toBe('/settings/dashboard-layouts');
    expect(callAt(0)[1].method).toBe('PUT');
    expect(bodyAt(0)).toEqual(layouts);
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.dashboardLayouts.success',
      'Dashboard layout saved',
    );
    // This mutation intentionally does not invalidate — the caller owns local state.
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('toasts the error when the layout save fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('layout save boom'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveDashboardLayouts(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(layouts)).rejects.toThrow('layout save boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.settings.dashboardLayouts.error',
      'Failed to save dashboard layout',
    );
  });
});

// ---------------------------------------------------------------------------
// Fleet API / polling: useToggleAPISuspend / usePollingConfig / useUpdatePollingConfig
// ---------------------------------------------------------------------------

describe('useToggleAPISuspend', () => {
  it('POSTs {suspended:true}, invalidates settings, and toasts the SUSPENDED message', async () => {
    mockedRequest.mockResolvedValueOnce({ api_suspended: true });

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useToggleAPISuspend(), { wrapper: Wrapper });

    await result.current.mutateAsync(true);

    expect(callAt(0)[0]).toBe('/settings/suspend-api');
    expect(callAt(0)[1].method).toBe('POST');
    expect(bodyAt(0)).toEqual({ suspended: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsKeys.settings });
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.api.toggle.suspended',
      'API suspended',
    );
  });

  it('toasts the RESUMED message when suspended=false', async () => {
    mockedRequest.mockResolvedValueOnce({ api_suspended: false });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useToggleAPISuspend(), { wrapper: Wrapper });

    await result.current.mutateAsync(false);

    expect(bodyAt(0)).toEqual({ suspended: false });
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.api.toggle.resumed',
      'API resumed',
    );
  });
});

describe('usePollingConfig', () => {
  it('GETs /settings/polling-config and surfaces the boolean flags + retention', async () => {
    const pc = makePollingConfig({ telemetry_capture_retention_days: 14 });
    mockedRequest.mockResolvedValueOnce(pc);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePollingConfig(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.vehicle_discovery).toBe(true);
    expect(result.current.data?.telemetry_capture_retention_days).toBe(14);
    expect(callAt(0)[0]).toBe('/settings/polling-config');
    expect(callAt(0)[1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('useUpdatePollingConfig', () => {
  it('PUTs the config, invalidates polling-config + capture-stats, and toasts success', async () => {
    const pc = makePollingConfig({ telemetry_capture: false });
    mockedRequest.mockResolvedValueOnce(pc);

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdatePollingConfig(), { wrapper: Wrapper });

    const returned = await result.current.mutateAsync(pc);
    expect(returned.telemetry_capture).toBe(false);

    expect(callAt(0)[0]).toBe('/settings/polling-config');
    expect(callAt(0)[1].method).toBe('PUT');
    expect(bodyAt(0)).toEqual(pc);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['polling-config'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['capture-stats'] });
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.polling.success',
      'Polling config saved',
    );
  });

  it('toasts the error when the polling-config save fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('polling boom'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdatePollingConfig(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(makePollingConfig())).rejects.toThrow('polling boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.settings.polling.error',
      'Failed to save polling config',
    );
  });
});

// ---------------------------------------------------------------------------
// useCaptureStats / useVersionInfo (plain queries)
// ---------------------------------------------------------------------------

describe('useCaptureStats', () => {
  it('GETs /dev-tools/telemetry-capture/stats and surfaces the mongo document stats', async () => {
    mockedRequest.mockResolvedValueOnce({
      mongodb_enabled: true,
      total_documents: 1234,
      distinct_vins: ['5YJ3E1', '5YJYGD'],
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCaptureStats(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total_documents).toBe(1234);
    expect(result.current.data?.distinct_vins).toHaveLength(2);
    expect(callAt(0)[0]).toBe('/dev-tools/telemetry-capture/stats');
  });
});

describe('useVersionInfo', () => {
  it('GETs /system/version and exposes the version + cookie-consent gate', async () => {
    mockedRequest.mockResolvedValueOnce({
      chart_version: '1.2.3',
      go_version: 'go1.25',
      os: 'linux',
      arch: 'amd64',
      endpoints: { api: '/api/v1' },
      require_cookie_consent: true,
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVersionInfo(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.chart_version).toBe('1.2.3');
    expect(result.current.data?.require_cookie_consent).toBe(true);
    expect(callAt(0)[0]).toBe('/system/version');
    expect(callAt(0)[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a request rejection as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('version 500'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVersionInfo(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
