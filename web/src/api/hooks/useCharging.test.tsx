// useCharging hook-suite tests.
//
// Covers EVERY export of useCharging.ts:
//   - key factories (chargingKeys, teslaChargingHistoryKeys,
//     teslaChargingSessionKeys, chargePlannerKeys) — stable tuple shape.
//   - getChargingSessions: URLSearchParams construction (default + date
//     range), value encoding, and AbortSignal threading.
//   - getTeslaChargingInvoiceURL: v1-prefixed path + reserved-char encoding.
//   - every query hook: correct request() URL, signal threading, enabled
//     guards (disabled → no fetch, idle fetchStatus), safeArray coercion,
//     and a representative error path.
//   - every mutation hook: HTTP method + body, conditional query-string
//     assembly, cache invalidation, and success/error toast wiring.
//
// Network is stubbed at the request() boundary; the mutation-toast bridge
// is replaced with spies so we can assert the exact i18n key + fallback
// each handler emits without mounting a ToastProvider.
//
// Keep this test next to the hook — the gate's path-scoped checks match
// `api/hooks/useCharging` as a contiguous substring.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// Replace the toast bridge with spies so onSuccess/onError assertions are
// exact and no ToastProvider / i18n instance is required.
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: successToast, error: errorToast }),
}));

import { request } from '@/api/client';
import { __flushQueryBroadcastForTests } from '@/lib/queryBroadcast';
import {
  getChargingSessions,
  chargingKeys,
  useChargingSessions,
  useChargingHistory,
  useChargingSession,
  useChargingSessionDetail,
  useChargeTelemetry,
  useChargingSessionsPaginated,
  useCostForecast,
  useChargingOptimizer,
  teslaChargingHistoryKeys,
  useTeslaChargingHistory,
  useRefreshTeslaChargingHistory,
  getTeslaChargingInvoiceURL,
  teslaChargingSessionKeys,
  useTeslaChargingSessions,
  useRefreshTeslaChargingSessions,
  chargePlannerKeys,
  useOptimizeCharge,
  useApplySchedule,
  useChargePlans,
  useRatePlans,
  useBulkDeleteCharging,
  type TeslaChargingHistoryResponse,
  type TeslaChargingSessionResponse,
} from './useCharging';
import type {
  OptimizeChargeRequest,
  ApplyScheduleRequest,
} from '@/types/charging';

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

/** Lets a disabled query settle so we can assert it never fired. */
const tick = () => new Promise((r) => setTimeout(r, 10));

const historyPayload: TeslaChargingHistoryResponse = {
  entries: [],
  summary: {
    total_sessions: 0,
    total_wh: 0,
    total_spend: 0,
    avg_cost_per_kwh: null,
  },
};

const sessionsPayload: TeslaChargingSessionResponse = {
  sessions: [],
  summary: {
    total_sessions: 0,
    total_wh: null,
    total_cost: null,
    avg_cost_per_kwh: null,
    peak_power_kw: null,
  },
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
// Key factories
// ---------------------------------------------------------------------------

describe('key factories', () => {
  it('chargingKeys produces stable, distinct tuples', () => {
    expect(chargingKeys.all).toEqual(['charging-sessions']);
    expect(chargingKeys.detail('a1')).toEqual(['charging-sessions', 'a1']);
    expect(chargingKeys.detailById(7)).toEqual(['charging-session', 7]);
    expect(chargingKeys.telemetry(7)).toEqual(['charge-telemetry', 7]);
    expect(chargingKeys.byVehicle('3')).toEqual([
      'charging-sessions',
      'vehicle',
      '3',
    ]);
    expect(chargingKeys.history('3')).toEqual([
      'charging-sessions',
      'history',
      '3',
      1000,
    ]);
  });

  it('tesla + charge-planner key factories are namespaced', () => {
    expect(teslaChargingHistoryKeys.all).toEqual(['tesla-charging-history']);
    expect(teslaChargingHistoryKeys.byVin('5YJ')).toEqual([
      'tesla-charging-history',
      '5YJ',
    ]);
    expect(teslaChargingSessionKeys.all).toEqual(['tesla-charging-sessions']);
    expect(teslaChargingSessionKeys.byVin('5YJ')).toEqual([
      'tesla-charging-sessions',
      '5YJ',
    ]);
    expect(chargePlannerKeys.all).toEqual(['charge-plans']);
    expect(chargePlannerKeys.byVehicle(9)).toEqual(['charge-plans', 9]);
    expect(chargePlannerKeys.ratePlans).toEqual(['charge-planner-rate-plans']);
  });
});

// ---------------------------------------------------------------------------
// getChargingSessions (plain fetcher)
// ---------------------------------------------------------------------------

describe('getChargingSessions', () => {
  it('builds the default query string and threads the signal', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const ctrl = new AbortController();
    await getChargingSessions(5, undefined, undefined, undefined, undefined, {
      signal: ctrl.signal,
    });
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/charging?vehicle_id=5&limit=50&offset=0');
    expect(opts.signal).toBe(ctrl.signal);
  });

  it('appends and URL-encodes the start/end range', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    await getChargingSessions(9, 10, 20, '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z');
    const url = mockedRequest.mock.calls[0][0];
    expect(url).toBe(
      '/charging?vehicle_id=9&limit=10&offset=20&start=2024-01-01T00%3A00%3A00Z&end=2024-02-01T00%3A00%3A00Z',
    );
  });

  it('omits start/end when only one bound is supplied', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    await getChargingSessions(1, 5, 0, undefined, '2024-02-01');
    const url = mockedRequest.mock.calls[0][0];
    expect(url).toContain('end=2024-02-01');
    expect(url).not.toContain('start=');
  });
});

// ---------------------------------------------------------------------------
// getTeslaChargingInvoiceURL (plain URL builder)
// ---------------------------------------------------------------------------

describe('getTeslaChargingInvoiceURL', () => {
  it('builds a v1-prefixed invoice download path', () => {
    expect(getTeslaChargingInvoiceURL('inv-123')).toBe(
      '/api/v1/tesla/charging/invoice/inv-123',
    );
  });

  it('URL-encodes reserved characters so the content id cannot break the path', () => {
    expect(getTeslaChargingInvoiceURL('a/b?c=1&d#e')).toBe(
      '/api/v1/tesla/charging/invoice/a%2Fb%3Fc%3D1%26d%23e',
    );
  });
});

// ---------------------------------------------------------------------------
// useChargingSessions
// ---------------------------------------------------------------------------

describe('useChargingSessions', () => {
  it('GETs the per-vehicle sessions endpoint with the vehicle_id param', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: '1' }]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargingSessions('7'), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/charging-sessions?vehicle_id=7');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data).toHaveLength(1);
  });

  it('is disabled when no vehicleId is given', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargingSessions(undefined), {
      wrapper: Wrapper,
    });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('coerces a non-array payload to [] via safeArray', async () => {
    mockedRequest.mockResolvedValueOnce(null as unknown as unknown[]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargingSessions('7'), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useChargingHistory', () => {
  it('requests an isolated maximum-size analytical history window', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: '1' }]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargingHistory('7'), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/charging?vehicle_id=7&limit=1000');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data).toHaveLength(1);
  });

  it('stays disabled without a vehicle id', async () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useChargingHistory(undefined), { wrapper: Wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useChargingSession
// ---------------------------------------------------------------------------

describe('useChargingSession', () => {
  it('GETs /charging/{id} when id is truthy', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 'abc' });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargingSession('abc'), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/charging/abc');
  });

  it('stays idle for an empty id', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargingSession(''), {
      wrapper: Wrapper,
    });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// useChargingSessionDetail
// ---------------------------------------------------------------------------

describe('useChargingSessionDetail', () => {
  it('GETs /charging/{id} and surfaces the live flag', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 42, live: true });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargingSessionDetail(42), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/charging/42');
    expect(result.current.data?.live).toBe(true);
  });

  it('is disabled when id is null', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargingSessionDetail(null), {
      wrapper: Wrapper,
    });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces request failures as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargingSessionDetail(42), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// useChargeTelemetry
// ---------------------------------------------------------------------------

describe('useChargeTelemetry', () => {
  it('GETs the telemetry sub-resource and safeArray-wraps the result', async () => {
    mockedRequest.mockResolvedValueOnce([{ vehicle_id: 1 }, { vehicle_id: 1 }]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargeTelemetry(42), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/charging/42/telemetry');
    expect(result.current.data).toHaveLength(2);
  });

  it('is disabled when sessionId is null', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargeTelemetry(null), {
      wrapper: Wrapper,
    });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// useChargingSessionsPaginated
// ---------------------------------------------------------------------------

describe('useChargingSessionsPaginated', () => {
  it('delegates to getChargingSessions with the supplied pagination + range', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useChargingSessionsPaginated(3, {
          limit: 25,
          offset: 50,
          start: '2024-03-01',
          end: '2024-03-31',
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe(
      '/charging?vehicle_id=3&limit=25&offset=50&start=2024-03-01&end=2024-03-31',
    );
    expect(opts).toHaveProperty('signal');
  });

  it('uses default limit/offset when options are omitted', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const { Wrapper } = makeWrapper();
    renderHook(() => useChargingSessionsPaginated(3), { wrapper: Wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/charging?vehicle_id=3&limit=50&offset=0',
    );
  });

  it('is disabled when vehicleId is null', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargingSessionsPaginated(null), {
      wrapper: Wrapper,
    });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// useCostForecast / useChargingOptimizer
// ---------------------------------------------------------------------------

describe('useCostForecast', () => {
  it('defaults to a 6-month horizon', async () => {
    mockedRequest.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    renderHook(() => useCostForecast('3'), { wrapper: Wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/analytics/cost-forecast?vehicle_id=3&months=6',
    );
  });

  it('honours a custom month count and is disabled when vehicleId is null', async () => {
    mockedRequest.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    const { rerender, result } = renderHook(
      ({ id }: { id: string | null }) => useCostForecast(id, 12),
      { wrapper: Wrapper, initialProps: { id: null as string | null } },
    );
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');

    rerender({ id: '4' });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/analytics/cost-forecast?vehicle_id=4&months=12',
    );
  });
});

describe('useChargingOptimizer', () => {
  it('GETs the optimizer analytics endpoint', async () => {
    mockedRequest.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    renderHook(() => useChargingOptimizer('3'), { wrapper: Wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/analytics/charging-optimizer?vehicle_id=3',
    );
  });

  it('is disabled when vehicleId is null', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargingOptimizer(null), {
      wrapper: Wrapper,
    });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Tesla charging history (query + refresh mutation)
// ---------------------------------------------------------------------------

describe('useTeslaChargingHistory', () => {
  it('GETs the history endpoint without a vin filter', async () => {
    mockedRequest.mockResolvedValueOnce(historyPayload);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTeslaChargingHistory(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/tesla/charging/history');
    expect(result.current.data).toEqual(historyPayload);
  });

  it('appends the vin query param when provided', async () => {
    mockedRequest.mockResolvedValueOnce(historyPayload);
    const { Wrapper } = makeWrapper();
    renderHook(() => useTeslaChargingHistory('5YJ3E1EA'), { wrapper: Wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/tesla/charging/history?vin=5YJ3E1EA',
    );
  });
});

describe('useRefreshTeslaChargingHistory', () => {
  it('POSTs a bare refresh, invalidates the cache, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(historyPayload);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRefreshTeslaChargingHistory(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync(undefined);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/tesla/charging/history/refresh');
    expect(opts.method).toBe('POST');
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: teslaChargingHistoryKeys.all,
    });
    expect(successToast).toHaveBeenCalledWith(
      'toast.charging.history.success',
      'Charging history refreshed',
    );
  });

  it('assembles the vin/start_time/end_time query string', async () => {
    mockedRequest.mockResolvedValueOnce(historyPayload);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRefreshTeslaChargingHistory(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      vin: '5YJ',
      start_time: '2024-01-01',
      end_time: '2024-02-01',
    });

    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/tesla/charging/history/refresh?vin=5YJ&start_time=2024-01-01&end_time=2024-02-01',
    );
  });

  it('toasts the error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('rate limit'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRefreshTeslaChargingHistory(), {
      wrapper: Wrapper,
    });

    await expect(result.current.mutateAsync(undefined)).rejects.toThrow(
      'rate limit',
    );
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.charging.history.error',
      'Failed to refresh charging history',
    );
  });
});

// ---------------------------------------------------------------------------
// Tesla fleet charging sessions (query + refresh mutation)
// ---------------------------------------------------------------------------

describe('useTeslaChargingSessions', () => {
  it('GETs the fleet sessions endpoint and appends vin when provided', async () => {
    mockedRequest.mockResolvedValueOnce(sessionsPayload);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTeslaChargingSessions('5YJ'), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/tesla/charging/sessions?vin=5YJ',
    );
    expect(result.current.data).toEqual(sessionsPayload);
  });
});

describe('useRefreshTeslaChargingSessions', () => {
  it('POSTs date_from/date_to, invalidates, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(sessionsPayload);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRefreshTeslaChargingSessions(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      vin: '5YJ',
      date_from: '2024-01-01',
      date_to: '2024-02-01',
    });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe(
      '/tesla/charging/sessions/refresh?vin=5YJ&date_from=2024-01-01&date_to=2024-02-01',
    );
    expect(opts.method).toBe('POST');
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: teslaChargingSessionKeys.all,
    });
    expect(successToast).toHaveBeenCalledWith(
      'toast.charging.sessions.success',
      'Charging sessions refreshed',
    );
  });

  it('toasts the error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('nope'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRefreshTeslaChargingSessions(), {
      wrapper: Wrapper,
    });
    await expect(result.current.mutateAsync(undefined)).rejects.toThrow('nope');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.charging.sessions.error',
      'Failed to refresh charging sessions',
    );
  });
});

// ---------------------------------------------------------------------------
// Smart charge planner: optimize + apply mutations
// ---------------------------------------------------------------------------

const optimizeReq: OptimizeChargeRequest = {
  vehicle_id: 3,
  target_soc: 80,
  depart_by: '2024-01-02T08:00:00Z',
  rate_plan_id: 'pge-ev2a',
};

describe('useOptimizeCharge', () => {
  it('POSTs the optimize request and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce({ plan_id: 12 });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useOptimizeCharge(), {
      wrapper: Wrapper,
    });

    const res = await result.current.mutateAsync(optimizeReq);
    expect(res).toEqual({ plan_id: 12 });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/charge-planner/optimize');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual(optimizeReq);
    expect(successToast).toHaveBeenCalledWith(
      'toast.charging.optimize.success',
      'Charge schedule optimized',
    );
  });

  it('toasts the error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('infeasible'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useOptimizeCharge(), {
      wrapper: Wrapper,
    });
    await expect(result.current.mutateAsync(optimizeReq)).rejects.toThrow(
      'infeasible',
    );
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.charging.optimize.error',
      'Failed to optimize charge',
    );
  });
});

describe('useApplySchedule', () => {
  const applyReq: ApplyScheduleRequest = { plan_id: 12 };

  it('POSTs the plan id, invalidates the plan cache, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce({ status: 'ok', plan_id: 12, message: 'done' });
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useApplySchedule(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync(applyReq);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/charge-planner/apply');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual(applyReq);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chargePlannerKeys.all });
    expect(successToast).toHaveBeenCalledWith(
      'toast.charging.apply.success',
      'Charge schedule applied',
    );
  });

  it('toasts the error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('offline'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useApplySchedule(), {
      wrapper: Wrapper,
    });
    await expect(result.current.mutateAsync(applyReq)).rejects.toThrow('offline');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.charging.apply.error',
      'Failed to apply schedule',
    );
  });
});

// ---------------------------------------------------------------------------
// useChargePlans / useRatePlans
// ---------------------------------------------------------------------------

describe('useChargePlans', () => {
  it('GETs the plan history for the vehicle and safeArray-wraps it', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: 1 }]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargePlans(9), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/charge-planner/history?vehicle_id=9',
    );
    expect(result.current.data).toHaveLength(1);
  });

  it('is disabled when vehicleId is falsy', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChargePlans(undefined), {
      wrapper: Wrapper,
    });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useRatePlans', () => {
  it('GETs the rate-plans catalog and coerces a null payload to []', async () => {
    mockedRequest.mockResolvedValueOnce(null as unknown as unknown[]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRatePlans(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/charge-planner/rate-plans');
    expect(result.current.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// useBulkDeleteCharging
// ---------------------------------------------------------------------------

describe('useBulkDeleteCharging', () => {
  it('DELETEs the id list, invalidates, and reports the deleted count', async () => {
    mockedRequest.mockResolvedValueOnce({ deleted: 3 });
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useBulkDeleteCharging(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync([1, 2, 3]);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/charging/bulk');
    expect(opts.method).toBe('DELETE');
    expect(JSON.parse(opts.body as string)).toEqual({ ids: [1, 2, 3] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chargingKeys.all });
    expect(successToast).toHaveBeenCalledWith(
      'toast.bulk.delete.success',
      '{{count}} deleted',
      { count: 3 },
    );
  });

  it('falls back to a zero count when the server omits `deleted`', async () => {
    mockedRequest.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBulkDeleteCharging(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync([9]);

    expect(successToast).toHaveBeenCalledWith(
      'toast.bulk.delete.success',
      '{{count}} deleted',
      { count: 0 },
    );
  });

  it('toasts the error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('fk violation'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBulkDeleteCharging(), {
      wrapper: Wrapper,
    });
    await expect(result.current.mutateAsync([1])).rejects.toThrow('fk violation');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.bulk.delete.error',
      'Failed to delete selection',
    );
  });
});
