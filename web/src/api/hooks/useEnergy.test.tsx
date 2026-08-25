// useEnergy hook-suite tests.
//
// Covers EVERY export of ./useEnergy (24 hooks) at the api/client network
// boundary — never the real network:
//
//   Vehicle-scoped queries:
//     useEnergyStats, useBatteryHealth (live + as-of + malformed as-of),
//     useBatteryCells (STATIC cache reuse), useBatteryHealthAnalytics,
//     useBatteryDegradation, useEnergyFlow, useProjectedRange,
//     useSleepEfficiency (days-only, start+end, only-start-ignored).
//   Deprecated 404 queries (fail-fast retry:false):
//     useVampireDrainStats, useVampireDrainEvents (safeArray coercion).
//   Tesla energy-site queries (enabled gating + safeArray):
//     useTeslaEnergySites, useTeslaEnergySiteInfo, useTeslaEnergyHistory,
//     useTeslaBackupHistory, useTeslaWCChargingHistory,
//     useTeslaEnergyLiveStatus, useTeslaEnergyLiveStatusHistory.
//   Mutations (URL/method/body + toast + cache invalidation):
//     useRefreshTeslaEnergySites, useRefreshTeslaEnergySiteInfo,
//     useUpdateTOUSettings, useRefreshTeslaEnergyHistory,
//     useRefreshTeslaBackupHistory, useRefreshTeslaWCChargingHistory,
//     useRefreshTeslaEnergyLiveStatus.
//
// Network is mocked at the api/client boundary (repo convention — see
// useExports.test.tsx / useDashboard.test.tsx). The toast bridge is mocked
// with stable spies (see __tests__/useNotifications.test.tsx) so mutation
// success/error paths are observable without a ToastProvider or i18n runtime.
// A MemoryRouter wraps every render because useBatteryHealth reaches
// useAsOfDate → useSearchParams for the ?as_of= time-machine parameter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toastSuccess, error: toastError }),
}));

import { request } from '@/api/client';
import { STALE_TIMES } from '@/lib/constants';
import { __flushQueryBroadcastForTests } from '@/lib/queryBroadcast';
import {
  useEnergyStats,
  useBatteryHealth,
  useBatteryCells,
  useBatteryHealthAnalytics,
  useBatteryDegradation,
  useEnergyFlow,
  useVampireDrainStats,
  useVampireDrainEvents,
  useProjectedRange,
  useSleepEfficiency,
  useTeslaEnergySites,
  useRefreshTeslaEnergySites,
  useTeslaEnergySiteInfo,
  useRefreshTeslaEnergySiteInfo,
  useUpdateTOUSettings,
  useTeslaEnergyHistory,
  useTeslaBackupHistory,
  useTeslaWCChargingHistory,
  useRefreshTeslaEnergyHistory,
  useRefreshTeslaBackupHistory,
  useRefreshTeslaWCChargingHistory,
  useTeslaEnergyLiveStatus,
  useTeslaEnergyLiveStatusHistory,
  useRefreshTeslaEnergyLiveStatus,
} from './useEnergy';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

// A client that WOULD retry failed queries three times (with zero delay so
// the test stays fast). Used to prove the deprecated hooks pin retry:false
// at the hook level, overriding this default.
function makeRetryingClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 3, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(client: QueryClient, initialEntries: string[] = ['/']) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

/** URL string of the Nth (default first) request() call. */
function calledUrl(n = 0): string {
  return mockedRequest.mock.calls[n][0] as string;
}

/** RequestInit of the Nth (default first) request() call. */
function calledOpts(n = 0): RequestInit {
  return mockedRequest.mock.calls[n][1] as RequestInit;
}

beforeEach(() => {
  mockedRequest.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  // Drain the 50 ms cross-tab invalidation coalesce timer scheduled by
  // useUpdateTOUSettings' invalidateAndBroadcast so it can't bleed into
  // the next test.
  __flushQueryBroadcastForTests();
});

// ---------------------------------------------------------------------------
// Vehicle-scoped query hooks
// ---------------------------------------------------------------------------

describe('useEnergyStats', () => {
  it('GETs /vehicles/{id}/energy with the default 30-day window and an AbortSignal', async () => {
    const stats = { total_wh: 1000, daily_breakdown: [] };
    mockedRequest.mockResolvedValueOnce(stats);

    const { result } = renderHook(() => useEnergyStats('7'), { wrapper: makeWrapper(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stats);
    expect(calledUrl()).toBe('/vehicles/7/energy?days=30');
    expect(calledUrl()).not.toContain('/api/v1');
    expect(calledOpts()).toHaveProperty('signal');
  });

  it('forwards a custom day count into the query string', async () => {
    mockedRequest.mockResolvedValueOnce({ total_wh: 0, daily_breakdown: [] });
    renderHook(() => useEnergyStats('7', 90), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(calledUrl()).toBe('/vehicles/7/energy?days=90');
  });

  it('forwards a start date for an exact historical-window breakdown', async () => {
    mockedRequest.mockResolvedValueOnce({ total_wh: 0, daily_breakdown: [] });
    renderHook(
      () => useEnergyStats('7', { start: '2025-06-01' }),
      { wrapper: makeWrapper(makeClient()) },
    );
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(calledUrl()).toBe('/vehicles/7/energy?start=2025-06-01');
  });

  it('does not present a previous window as current while a new range loads', async () => {
    mockedRequest
      .mockResolvedValueOnce({
        total_wh: 1000,
        daily_breakdown: [{ date: '2025-06-01', energy_wh: 1000 }],
      })
      .mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(
      ({ start }) => useEnergyStats('7', { start }),
      {
        initialProps: { start: '2025-06-01' },
        wrapper: makeWrapper(makeClient()),
      },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ start: '2025-08-01' });

    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.isPlaceholderData).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('is disabled (no request) when vehicleId is null', async () => {
    const { result } = renderHook(() => useEnergyStats(null), { wrapper: makeWrapper(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces the error when the request rejects', async () => {
    const boom = new Error('energy down');
    mockedRequest.mockRejectedValueOnce(boom);
    const { result } = renderHook(() => useEnergyStats('7'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(boom);
    expect(result.current.data).toBeUndefined();
  });
});

describe('useBatteryHealth', () => {
  it('GETs the live /vehicles/{id}/battery path when no as-of is set', async () => {
    mockedRequest.mockResolvedValueOnce({ health_score: 92 });
    const { result } = renderHook(() => useBatteryHealth('7'), { wrapper: makeWrapper(makeClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/vehicles/7/battery');
    expect(calledUrl()).not.toContain('as_of');
    expect(result.current.data).toEqual({ health_score: 92 });
  });

  it('appends an encoded ?as_of= when the URL carries a valid RFC-3339 timestamp', async () => {
    mockedRequest.mockResolvedValueOnce({ health_score: 88 });
    const { result } = renderHook(() => useBatteryHealth('7'), {
      wrapper: makeWrapper(makeClient(), ['/?as_of=2024-11-12T14:30:00Z']),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // encodeURIComponent turns the colons into %3A.
    expect(calledUrl()).toBe('/vehicles/7/battery?as_of=2024-11-12T14%3A30%3A00Z');
  });

  it('ignores a malformed as_of and falls back to the live path', async () => {
    mockedRequest.mockResolvedValueOnce({ health_score: 70 });
    renderHook(() => useBatteryHealth('7'), {
      wrapper: makeWrapper(makeClient(), ['/?as_of=not-a-date']),
    });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(calledUrl()).toBe('/vehicles/7/battery');
  });

  it('is disabled when vehicleId is null', async () => {
    const { result } = renderHook(() => useBatteryHealth(null), { wrapper: makeWrapper(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useBatteryCells', () => {
  it('GETs /vehicles/{id}/battery/cells and serves the STATIC-cached value to a second observer', async () => {
    const client = makeClient();
    mockedRequest.mockResolvedValueOnce({ total_cells: 96, cells: [] });

    const first = renderHook(() => useBatteryCells('7'), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/vehicles/7/battery/cells');

    const second = renderHook(() => useBatteryCells('7'), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    // staleTime STATIC (Infinity) → the second observer is served from cache,
    // so request() fires exactly once across both mounts.
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(STALE_TIMES.STATIC).toBe(Infinity);
  });

  it('does not retry on failure (retry:false)', async () => {
    mockedRequest.mockRejectedValue(new Error('no cells table'));
    const { result } = renderHook(() => useBatteryCells('7'), { wrapper: makeWrapper(makeRetryingClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});

describe('useBatteryHealthAnalytics', () => {
  it('GETs /analytics/battery-health with a snake_case vehicle_id param', async () => {
    mockedRequest.mockResolvedValueOnce({ current_soh: 95 });
    const { result } = renderHook(() => useBatteryHealthAnalytics('42'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/analytics/battery-health?vehicle_id=42');
    expect(calledUrl()).not.toContain('vehicleId');
  });

  it('reuses fresh analytics for fifteen minutes instead of refetching on a second observer', async () => {
    mockedRequest.mockResolvedValue({ current_soh: 95 });
    const client = makeClient();
    const wrapper = makeWrapper(client);
    const first = renderHook(() => useBatteryHealthAnalytics('42'), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    const second = renderHook(() => useBatteryHealthAnalytics('42'), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(STALE_TIMES.ANALYTICS).toBe(15 * 60_000);
  });

  it('surfaces an analytics failure without a delayed retry cycle', async () => {
    mockedRequest.mockRejectedValue(new Error('analytics timeout'));
    const { result } = renderHook(
      () => useBatteryHealthAnalytics('42'),
      { wrapper: makeWrapper(makeRetryingClient()) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});

describe('useBatteryDegradation', () => {
  it('GETs /analytics/battery-degradation with a snake_case vehicle_id param', async () => {
    mockedRequest.mockResolvedValueOnce({ current_health: 90, snapshots: [] });
    const { result } = renderHook(() => useBatteryDegradation('42'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/analytics/battery-degradation?vehicle_id=42');
  });

  it('is disabled when vehicleId is null', async () => {
    renderHook(() => useBatteryDegradation(null), { wrapper: makeWrapper(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('useEnergyFlow', () => {
  it('GETs the live /vehicles/{id}/energy/flow snapshot path', async () => {
    mockedRequest.mockResolvedValueOnce({ soc: 0.8, charge_state: 'Charging' });
    const { result } = renderHook(() => useEnergyFlow('7'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/vehicles/7/energy/flow');
    expect(result.current.data?.charge_state).toBe('Charging');
  });

  it('does not retry on failure (retry:false)', async () => {
    mockedRequest.mockRejectedValue(new Error('flow unavailable'));
    const { result } = renderHook(() => useEnergyFlow('7'), { wrapper: makeWrapper(makeRetryingClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});

describe('useProjectedRange', () => {
  it('GETs /vehicles/{id}/battery/projected-range', async () => {
    mockedRequest.mockResolvedValueOnce({ current_range_km: 350, new_range_km: 400 });
    const { result } = renderHook(() => useProjectedRange('7'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/vehicles/7/battery/projected-range');
    expect(result.current.data?.current_range_km).toBe(350);
  });
});

describe('useSleepEfficiency', () => {
  it('GETs /analytics/sleep with vehicle_id + the default day window and no date range', async () => {
    mockedRequest.mockResolvedValueOnce({ sleep_efficiency_pct: 91 });
    const { result } = renderHook(() => useSleepEfficiency('7'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/analytics/sleep?vehicle_id=7&days=30');
    expect(calledUrl()).not.toContain('/api/v1');
    expect(calledOpts().signal).toBeInstanceOf(AbortSignal);
  });

  it('appends &start&end when BOTH bounds are supplied (canonical range picker)', async () => {
    mockedRequest.mockResolvedValueOnce({ sleep_efficiency_pct: 80 });
    renderHook(() => useSleepEfficiency('7', 30, '2025-01-01', '2025-01-31'), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(calledUrl()).toBe('/analytics/sleep?vehicle_id=7&days=30&start=2025-01-01&end=2025-01-31');
  });

  it('ignores a lone start date (needs a full window) and omits the range', async () => {
    mockedRequest.mockResolvedValueOnce({ sleep_efficiency_pct: 80 });
    renderHook(() => useSleepEfficiency('7', 14, '2025-01-01'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(calledUrl()).toBe('/analytics/sleep?vehicle_id=7&days=14');
    expect(calledUrl()).not.toContain('start=');
  });

  it('is disabled without a vehicle id', async () => {
    const { result } = renderHook(
      () => useSleepEfficiency(null, 30, '2025-01-01', '2025-01-30'),
      { wrapper: makeWrapper(makeClient()) },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('safely encodes every query value', async () => {
    mockedRequest.mockResolvedValueOnce({ state_distribution: [] });
    renderHook(
      () =>
        useSleepEfficiency(
          'fleet/7 &x',
          30,
          '2025-01-01 &start',
          '2025-01-30 &end',
        ),
      { wrapper: makeWrapper(makeClient()) },
    );
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(calledUrl()).toBe(
      '/analytics/sleep?vehicle_id=fleet%2F7+%26x&days=30&start=2025-01-01+%26start&end=2025-01-30+%26end',
    );
    expect(calledUrl()).not.toContain('vehicleId=');
  });
});

// ---------------------------------------------------------------------------
// Canonical vampire-drain hooks — FSM/signal-history derived API shape
// ---------------------------------------------------------------------------

describe('useVampireDrainStats', () => {
  it('GETs /vampire-drain/stats with a snake_case vehicle_id param', async () => {
    mockedRequest.mockResolvedValueOnce({
      event_count: 1,
      total_observed_hours: 24,
      avg_drain_pct_per_day: 1.2,
      median_drain_pct_per_day: 1.1,
      p95_drain_pct_per_day: 2.4,
      sample_window_days: 90,
    });
    const { result } = renderHook(() => useVampireDrainStats('7'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/vampire-drain/stats?vehicle_id=7');
    expect(result.current.data?.avg_drain_pct_per_day).toBe(1.2);
  });
});

describe('useVampireDrainEvents', () => {
  it('GETs /vampire-drain with vehicle_id and unwraps the response envelope', async () => {
    mockedRequest.mockResolvedValueOnce({
      vehicle_id: 7,
      events: [{
        started_at: '2025-01-01T00:00:00Z',
        ended_at: '2025-01-02T00:00:00Z',
        duration_hours: 24,
        start_battery_pct: 80,
        end_battery_pct: 79,
        drain_pct: 1,
        drain_pct_per_day: 1,
        ambient_temp_c_avg: null,
      }],
    });
    const { result } = renderHook(() => useVampireDrainEvents('7'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/vampire-drain?vehicle_id=7&limit=50');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.drain_pct_per_day).toBe(1);
  });

  it('honours a custom limit', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicle_id: 7, events: [] });
    renderHook(() => useVampireDrainEvents('7', 10), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(calledUrl()).toBe('/vampire-drain?vehicle_id=7&limit=10');
  });

  it('coerces a null events field to [] via safeArray select', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicle_id: 7, events: null });
    const { result } = renderHook(() => useVampireDrainEvents('7'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tesla energy-site query hooks
// ---------------------------------------------------------------------------

describe('useTeslaEnergySites', () => {
  it('GETs /tesla/energy-sites and surfaces the array', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: 1, site_name: 'Home' }]);
    const { result } = renderHook(() => useTeslaEnergySites(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/tesla/energy-sites');
    expect(result.current.data).toHaveLength(1);
  });

  it('coerces a missing payload to [] via safeArray select', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useTeslaEnergySites(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useTeslaEnergySiteInfo', () => {
  it('GETs /tesla/energy-sites/{siteId}/site-info when a truthy siteId is given', async () => {
    mockedRequest.mockResolvedValueOnce({ data: { site_name: 'Home' }, fetched_at: null });
    const { result } = renderHook(() => useTeslaEnergySiteInfo(55), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/tesla/energy-sites/55/site-info');
    expect(result.current.data?.data?.site_name).toBe('Home');
  });

  it('is disabled when siteId is undefined', async () => {
    const { result } = renderHook(() => useTeslaEnergySiteInfo(undefined), { wrapper: makeWrapper(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled for the falsy siteId 0', async () => {
    renderHook(() => useTeslaEnergySiteInfo(0), { wrapper: makeWrapper(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('useTeslaEnergyHistory', () => {
  it('GETs energy-history with the default day period', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: 1 }]);
    const { result } = renderHook(() => useTeslaEnergyHistory(55), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/tesla/energy-sites/55/energy-history?period=day');
  });

  it('threads period + since + until through the query string', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    renderHook(() => useTeslaEnergyHistory(55, 'month', '2025-01-01', '2025-02-01'), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    const params = new URLSearchParams(calledUrl().split('?')[1]);
    expect(params.get('period')).toBe('month');
    expect(params.get('since')).toBe('2025-01-01');
    expect(params.get('until')).toBe('2025-02-01');
  });

  it('coerces a non-array payload to [] and is disabled without a siteId', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const enabled = renderHook(() => useTeslaEnergyHistory(55), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(enabled.result.current.isSuccess).toBe(true));
    expect(enabled.result.current.data).toEqual([]);

    mockedRequest.mockReset();
    renderHook(() => useTeslaEnergyHistory(undefined), { wrapper: makeWrapper(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('useTeslaBackupHistory', () => {
  it('GETs backup-history and threads since + until', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: 3 }]);
    const { result } = renderHook(() => useTeslaBackupHistory(55, '2025-01-01', '2025-02-01'), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [path, query] = calledUrl().split('?');
    expect(path).toBe('/tesla/energy-sites/55/backup-history');
    const params = new URLSearchParams(query);
    expect(params.get('since')).toBe('2025-01-01');
    expect(params.get('until')).toBe('2025-02-01');
  });

  it('is disabled without a siteId', async () => {
    renderHook(() => useTeslaBackupHistory(undefined), { wrapper: makeWrapper(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('useTeslaWCChargingHistory', () => {
  it('GETs charging-history and coerces a missing payload to []', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useTeslaWCChargingHistory(55), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl().split('?')[0]).toBe('/tesla/energy-sites/55/charging-history');
    expect(result.current.data).toEqual([]);
  });
});

describe('useTeslaEnergyLiveStatus', () => {
  it('GETs the live-status snapshot for a site', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 9, grid_status: 'Active' });
    const { result } = renderHook(() => useTeslaEnergyLiveStatus(55), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/tesla/energy-sites/55/live-status');
    expect(result.current.data?.grid_status).toBe('Active');
  });

  it('is disabled without a siteId', async () => {
    renderHook(() => useTeslaEnergyLiveStatus(undefined), { wrapper: makeWrapper(makeClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('useTeslaEnergyLiveStatusHistory', () => {
  it('GETs live-status/history and threads since + until + limit', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: 1 }]);
    const { result } = renderHook(
      () => useTeslaEnergyLiveStatusHistory(55, '2025-01-01', '2025-02-01', 100),
      { wrapper: makeWrapper(makeClient()) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [path, query] = calledUrl().split('?');
    expect(path).toBe('/tesla/energy-sites/55/live-status/history');
    const params = new URLSearchParams(query);
    expect(params.get('since')).toBe('2025-01-01');
    expect(params.get('until')).toBe('2025-02-01');
    expect(params.get('limit')).toBe('100');
  });

  it('omits the limit param when not provided and coerces a null payload to []', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useTeslaEnergyLiveStatusHistory(55), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).not.toContain('limit=');
    expect(result.current.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Mutations — URL / method / body + toast + cache invalidation
// ---------------------------------------------------------------------------

describe('useRefreshTeslaEnergySites', () => {
  it('POSTs the refresh route, invalidates the sites key, and fires a success toast', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    mockedRequest.mockResolvedValueOnce([{ id: 1 }]);

    const { result } = renderHook(() => useRefreshTeslaEnergySites(), { wrapper: makeWrapper(client) });
    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(calledUrl()).toBe('/tesla/energy-sites/refresh');
    expect(calledOpts().method).toBe('POST');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tesla-energy-sites'] });
    expect(toastSuccess).toHaveBeenCalledWith('toast.energy.sites.success', 'Energy sites refreshed');
  });

  it('routes a rejection through the error toast and rejects the mutation', async () => {
    const boom = new Error('refresh failed');
    mockedRequest.mockRejectedValueOnce(boom);
    const { result } = renderHook(() => useRefreshTeslaEnergySites(), { wrapper: makeWrapper(makeClient()) });

    await expect(
      act(async () => {
        await result.current.mutateAsync();
      }),
    ).rejects.toThrow('refresh failed');

    expect(toastError).toHaveBeenCalledWith(boom, 'toast.energy.sites.error', 'Failed to refresh energy sites');
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('useRefreshTeslaEnergySiteInfo', () => {
  it('POSTs the per-site refresh route and invalidates the site-info key for that id', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    mockedRequest.mockResolvedValueOnce({ data: null, fetched_at: null });

    const { result } = renderHook(() => useRefreshTeslaEnergySiteInfo(), { wrapper: makeWrapper(client) });
    await act(async () => {
      await result.current.mutateAsync(42);
    });

    expect(calledUrl()).toBe('/tesla/energy-sites/42/site-info/refresh');
    expect(calledOpts().method).toBe('POST');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tesla-site-info', 42] });
    expect(toastSuccess).toHaveBeenCalledWith('toast.energy.siteInfo.success', 'Site info refreshed');
  });
});

describe('useUpdateTOUSettings', () => {
  it('POSTs the TOU payload as JSON and broadcasts a site-info invalidation', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    mockedRequest.mockResolvedValueOnce(undefined);
    const settings = { tou_settings: { optimization_strategy: 'economics' } };

    const { result } = renderHook(() => useUpdateTOUSettings(), { wrapper: makeWrapper(client) });
    await act(async () => {
      await result.current.mutateAsync({ siteId: 42, settings });
    });

    const opts = calledOpts();
    expect(calledUrl()).toBe('/tesla/energy-sites/42/tou-settings');
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body as string)).toEqual(settings);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tesla-site-info', 42] });
    expect(toastSuccess).toHaveBeenCalledWith('toast.energy.tou.success', 'TOU settings saved');
  });
});

describe('useRefreshTeslaEnergyHistory', () => {
  it('POSTs energy-history/refresh with default period plus optional date + tz params', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    mockedRequest.mockResolvedValueOnce({ entries: [], upserted: 0 });

    const { result } = renderHook(() => useRefreshTeslaEnergyHistory(), { wrapper: makeWrapper(client) });
    await act(async () => {
      await result.current.mutateAsync({
        siteId: 55,
        start_date: '2025-01-01',
        end_date: '2025-01-31',
        time_zone: 'America/New_York',
      });
    });

    const [path, query] = calledUrl().split('?');
    expect(path).toBe('/tesla/energy-sites/55/energy-history/refresh');
    const params = new URLSearchParams(query);
    expect(params.get('period')).toBe('day');
    expect(params.get('start_date')).toBe('2025-01-01');
    expect(params.get('end_date')).toBe('2025-01-31');
    expect(params.get('time_zone')).toBe('America/New_York');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tesla-energy-history'] });
    expect(toastSuccess).toHaveBeenCalledWith('toast.energy.history.success', 'Energy history refreshed');
  });
});

describe('useRefreshTeslaBackupHistory', () => {
  it('POSTs backup-history/refresh and invalidates the backup-history key', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    mockedRequest.mockResolvedValueOnce({ entries: [], upserted: 0 });

    const { result } = renderHook(() => useRefreshTeslaBackupHistory(), { wrapper: makeWrapper(client) });
    await act(async () => {
      await result.current.mutateAsync({ siteId: 55, period: 'week' });
    });

    const [path, query] = calledUrl().split('?');
    expect(path).toBe('/tesla/energy-sites/55/backup-history/refresh');
    expect(new URLSearchParams(query).get('period')).toBe('week');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tesla-backup-history'] });
    expect(toastSuccess).toHaveBeenCalledWith('toast.energy.backup.success', 'Backup history refreshed');
  });
});

describe('useRefreshTeslaWCChargingHistory', () => {
  it('POSTs charging-history/refresh WITHOUT a period param and invalidates the wc key', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    mockedRequest.mockResolvedValueOnce({ entries: [], upserted: 0 });

    const { result } = renderHook(() => useRefreshTeslaWCChargingHistory(), { wrapper: makeWrapper(client) });
    await act(async () => {
      await result.current.mutateAsync({ siteId: 55, time_zone: 'UTC' });
    });

    const [path, query] = calledUrl().split('?');
    expect(path).toBe('/tesla/energy-sites/55/charging-history/refresh');
    const params = new URLSearchParams(query);
    expect(params.has('period')).toBe(false);
    expect(params.get('time_zone')).toBe('UTC');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tesla-wc-charging-history'] });
    expect(toastSuccess).toHaveBeenCalledWith(
      'toast.energy.wcCharging.success',
      'Wall Connector charging history refreshed',
    );
  });
});

describe('useRefreshTeslaEnergyLiveStatus', () => {
  it('POSTs live-status/refresh and invalidates both the snapshot and history keys', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    mockedRequest.mockResolvedValueOnce({ id: 9 });

    const { result } = renderHook(() => useRefreshTeslaEnergyLiveStatus(), { wrapper: makeWrapper(client) });
    await act(async () => {
      await result.current.mutateAsync(55);
    });

    expect(calledUrl()).toBe('/tesla/energy-sites/55/live-status/refresh');
    expect(calledOpts().method).toBe('POST');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tesla-live-status'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tesla-live-status-history'] });
    expect(toastSuccess).toHaveBeenCalledWith('toast.energy.liveStatus.success', 'Live status refreshed');
  });
});
