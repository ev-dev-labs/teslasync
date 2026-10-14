// useUser hook-suite tests.
//
// Covers EVERY export of useUser.ts:
//   - userKeys — stable, distinct query-key tuples (including the params-
//     bearing myActivity factory).
//   - useCurrentUser / useMyRecentActivity — request() URL, AbortSignal
//     threading, snake_case query params, safeArray coercion, and a faithful
//     ApiError (503) surfacing path.
//   - useUpdateUser — PUT method + camelCase body (matches the Go
//     `json:"displayName"` tag), optimistic cache write, success/error toast.
//   - the four Tesla envelope queries (feature-config, region, orders,
//     profile) — exact GET paths + envelope passthrough.
//   - the four refresh mutations — POST path, cache invalidation, and
//     success/error toast wiring.
//
// Network is stubbed at the request() boundary except for the guarded live-mode
// cases, which use the real request() with mocked fetch. The mutation-toast bridge is
// replaced with spies so onSuccess/onError assertions are exact and no
// ToastProvider / i18n instance is required.
//
// Keep this test next to the hook — the gate's path-scoped checks match
// `api/hooks/useUser` as a contiguous substring.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
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

import { request, ApiError, __resetSudoStateForTests } from '@/api/client';
import { createQueryClient } from '@/api/queryClient';
import {
  OperationalModeWriteError,
  OPERATIONAL_MODE_READ_ONLY_CODE,
  readOperationalModeFromEnvironment,
} from '@/lib/operationalMode';
import {
  userKeys,
  useCurrentUser,
  useUpdateUser,
  useMyRecentActivity,
  useTeslaFeatureConfig,
  useRefreshTeslaFeatureConfig,
  useTeslaUserRegion,
  useRefreshTeslaRegion,
  useTeslaUserOrders,
  useRefreshTeslaOrders,
  useTeslaUserProfile,
  useRefreshTeslaProfile,
  type MyActivityParams,
  type TeslaOrder,
  type TeslaUserProfile,
} from './useUser';
import type { User } from '@/types/user';
import type { UserActivityEntry } from '@/types/admin';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeWrapper(client?: QueryClient) {
  const qc = client ?? new QueryClient({
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const userFixture: User = {
  id: 'u-1',
  email: 'driver@example.com',
  displayName: 'Nikola',
  avatarUrl: undefined,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-02T00:00:00Z',
};

const activityFixture: UserActivityEntry = {
  id: 42,
  ts: '2025-06-01T12:00:00Z',
  action: 'vehicle.wake',
  entity_type: 'vehicle',
  entity_id: '3',
  detail: null,
  ip: '10.0.0.1',
  user_agent: 'jest',
};

const orderFixture: TeslaOrder = {
  id: 7,
  order_id: 'RN123',
  model: 'Model Y',
  status: 'BOOKED',
  delivery_date: null,
  vin: null,
  referral_code: null,
  is_upgradable: true,
  fetched_at: '2025-06-01T00:00:00Z',
  created_at: '2025-05-01T00:00:00Z',
  updated_at: '2025-06-01T00:00:00Z',
};

const profileFixture: TeslaUserProfile = {
  id: 9,
  email: 'owner@example.com',
  full_name: 'Grace Hopper',
  profile_image_url: null,
  fetched_at: '2025-06-01T00:00:00Z',
  created_at: '2025-05-01T00:00:00Z',
  updated_at: '2025-06-01T00:00:00Z',
};

beforeEach(() => {
  mockedRequest.mockReset();
  successToast.mockReset();
  errorToast.mockReset();
});

// ---------------------------------------------------------------------------
// userKeys — key factory
// ---------------------------------------------------------------------------

describe('userKeys', () => {
  it('produces stable, distinct tuples for every namespace', () => {
    expect(userKeys.me).toEqual(['users', 'me']);
    expect(userKeys.teslaFeatureConfig).toEqual(['tesla-feature-config']);
    expect(userKeys.teslaRegion).toEqual(['tesla-user-region']);
    expect(userKeys.teslaOrders).toEqual(['tesla-user-orders']);
    expect(userKeys.teslaProfile).toEqual(['tesla-user-profile']);
  });

  it('embeds the params object in the myActivity key so distinct filters cache separately', () => {
    const a: MyActivityParams = { start: '2025-01-01', limit: 10 };
    const b: MyActivityParams = { start: '2025-02-01', limit: 10 };
    expect(userKeys.myActivity(a)).toEqual(['users', 'me', 'activity', a]);
    expect(userKeys.myActivity(a)).not.toEqual(userKeys.myActivity(b));
    expect(userKeys.myActivity({})).toEqual(['users', 'me', 'activity', {}]);
  });
});

// ---------------------------------------------------------------------------
// useCurrentUser
// ---------------------------------------------------------------------------

describe('useCurrentUser', () => {
  it('GETs /users/me, threads the AbortSignal, and surfaces the user', async () => {
    mockedRequest.mockResolvedValueOnce(userFixture);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCurrentUser(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/users/me');
    expect(opts).toHaveProperty('signal');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(result.current.data?.displayName).toBe('Nikola');
  });

  it('surfaces request failures as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCurrentUser(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('boom');
  });
});

// ---------------------------------------------------------------------------
// useUpdateUser
// ---------------------------------------------------------------------------

describe('useUpdateUser', () => {
  it('PUTs /users/me with a camelCase displayName body, writes the cache, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(userFixture);
    const { Wrapper, qc } = makeWrapper();
    const { result } = renderHook(() => useUpdateUser(), { wrapper: Wrapper });

    const updated = await result.current.mutateAsync({ displayName: 'Nikola' });
    expect(updated).toEqual(userFixture);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/users/me');
    expect(opts.method).toBe('PUT');
    // Body key MUST stay camelCase to match the Go `json:"displayName"` tag.
    expect(JSON.parse(opts.body as string)).toEqual({ displayName: 'Nikola' });

    // onSuccess primes the /users/me cache so consumers don't flash stale data.
    expect(qc.getQueryData(userKeys.me)).toEqual(userFixture);
    expect(successToast).toHaveBeenCalledWith('toast.user.update.success', 'Profile updated');
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('toasts the error and rejects when the update fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('nope'));
    const { Wrapper, qc } = makeWrapper();
    const { result } = renderHook(() => useUpdateUser(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync({ displayName: 'x' })).rejects.toThrow('nope');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.user.update.error',
      'Failed to update profile',
    );
    expect(successToast).not.toHaveBeenCalled();
    // Failed update must NOT overwrite the identity cache.
    expect(qc.getQueryData(userKeys.me)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// useMyRecentActivity
// ---------------------------------------------------------------------------

describe('useMyRecentActivity', () => {
  it('GETs /users/me/activity with no query string when called with no params', async () => {
    mockedRequest.mockResolvedValueOnce([activityFixture]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMyRecentActivity(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/users/me/activity');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].action).toBe('vehicle.wake');
  });

  it('builds a snake_case query string, including limit=0, and URL-encodes values', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const { Wrapper } = makeWrapper();
    renderHook(
      () =>
        useMyRecentActivity({
          start: '2025-01-01T00:00:00Z',
          end: '2025-02-01T00:00:00Z',
          limit: 0,
          offset: 20,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/users/me/activity?start=2025-01-01T00%3A00%3A00Z&end=2025-02-01T00%3A00%3A00Z&limit=0&offset=20',
    );
  });

  it('omits an unset bound while still emitting the one that is provided', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const { Wrapper } = makeWrapper();
    renderHook(() => useMyRecentActivity({ end: '2025-02-01', limit: 5 }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    const url = mockedRequest.mock.calls[0][0] as string;
    expect(url).toContain('end=2025-02-01');
    expect(url).toContain('limit=5');
    expect(url).not.toContain('start=');
    expect(url).not.toContain('offset=');
  });

  it('coerces a null payload to an empty array via safeArray (never undefined)', async () => {
    mockedRequest.mockResolvedValueOnce(null as unknown as UserActivityEntry[]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMyRecentActivity(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('surfaces the backend 503 (no ForwardAuth) as an ApiError with its status', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError('per-user activity requires a ForwardAuth identity provider', 503),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMyRecentActivity(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Tesla envelope queries
// ---------------------------------------------------------------------------

describe('Tesla envelope queries', () => {
  it('useTeslaFeatureConfig GETs /tesla/user/feature-config and passes the envelope through', async () => {
    const envelope = { data: { location_streaming: true }, fetched_at: '2025-06-01T00:00:00Z' };
    mockedRequest.mockResolvedValueOnce(envelope);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTeslaFeatureConfig(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/tesla/user/feature-config');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data).toEqual(envelope);
  });

  it('useTeslaUserRegion GETs /tesla/user/region and exposes the typed region payload', async () => {
    const envelope = {
      data: { region: 'na', fleet_api_base_url: 'https://fleet-api.prd.na.vn.cloud.tesla.com' },
      fetched_at: null,
    };
    mockedRequest.mockResolvedValueOnce(envelope);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTeslaUserRegion(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/tesla/user/region');
    expect(result.current.data?.data.region).toBe('na');
  });

  it('useTeslaUserOrders GETs /tesla/user/orders and surfaces the orders envelope', async () => {
    const envelope = { orders: [orderFixture], fetched_at: '2025-06-01T00:00:00Z' };
    mockedRequest.mockResolvedValueOnce(envelope);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTeslaUserOrders(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/tesla/user/orders');
    expect(result.current.data?.orders).toHaveLength(1);
    expect(result.current.data?.orders[0].order_id).toBe('RN123');
  });

  it('useTeslaUserProfile GETs /tesla/user/profile and tolerates a null profile', async () => {
    const envelope = { profile: null, fetched_at: null };
    mockedRequest.mockResolvedValueOnce(envelope);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTeslaUserProfile(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/tesla/user/profile');
    expect(result.current.data?.profile).toBeNull();
  });

  it('useTeslaUserProfile surfaces a populated profile when present', async () => {
    mockedRequest.mockResolvedValueOnce({ profile: profileFixture, fetched_at: '2025-06-01T00:00:00Z' });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTeslaUserProfile(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.profile?.full_name).toBe('Grace Hopper');
  });
});

// ---------------------------------------------------------------------------
// Tesla refresh mutations
// ---------------------------------------------------------------------------

describe('useRefreshTeslaFeatureConfig', () => {
  it('POSTs the refresh route, invalidates the feature-config cache, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce({ data: {}, fetched_at: null });
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRefreshTeslaFeatureConfig(), { wrapper: Wrapper });

    await result.current.mutateAsync(undefined);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/tesla/user/feature-config/refresh');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.teslaFeatureConfig });
    expect(successToast).toHaveBeenCalledWith(
      'toast.featureConfigRefreshed',
      'Feature config refreshed',
    );
  });

  it('toasts the error on failure and does not invalidate', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('rate limit'));
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRefreshTeslaFeatureConfig(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(undefined)).rejects.toThrow('rate limit');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.featureConfigFailed',
      'Failed to refresh feature config',
    );
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useRefreshTeslaRegion', () => {
  it('POSTs /tesla/user/region/refresh, invalidates the region cache, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce({ data: { region: 'eu', fleet_api_base_url: 'x' }, fetched_at: null });
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRefreshTeslaRegion(), { wrapper: Wrapper });

    await result.current.mutateAsync(undefined);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/tesla/user/region/refresh');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.teslaRegion });
    expect(successToast).toHaveBeenCalledWith('toast.regionRefreshed', 'Region info refreshed');
  });

  it('toasts the error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('down'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRefreshTeslaRegion(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(undefined)).rejects.toThrow('down');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.regionFailed',
      'Failed to refresh region',
    );
  });
});

describe('useRefreshTeslaOrders', () => {
  it('POSTs /tesla/user/orders/refresh, invalidates the orders cache, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce({ orders: [], fetched_at: null });
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRefreshTeslaOrders(), { wrapper: Wrapper });

    await result.current.mutateAsync(undefined);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/tesla/user/orders/refresh');
    expect(opts.method).toBe('POST');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.teslaOrders });
    expect(successToast).toHaveBeenCalledWith('toast.user.orders.success', 'Orders refreshed');
  });

  it('toasts the error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRefreshTeslaOrders(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(undefined)).rejects.toThrow('boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.user.orders.error',
      'Failed to refresh orders',
    );
  });
});

describe('useRefreshTeslaProfile', () => {
  it('POSTs /tesla/user/profile/refresh, invalidates the profile cache, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce({ profile: profileFixture, fetched_at: null });
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRefreshTeslaProfile(), { wrapper: Wrapper });

    await result.current.mutateAsync(undefined);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/tesla/user/profile/refresh');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.teslaProfile });
    expect(successToast).toHaveBeenCalledWith(
      'toast.user.teslaProfile.success',
      'Tesla profile refreshed',
    );
  });

  it('toasts the error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('unauthorized'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRefreshTeslaProfile(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(undefined)).rejects.toThrow('unauthorized');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.user.teslaProfile.error',
      'Failed to refresh Tesla profile',
    );
  });
});

describe('useRefreshTeslaProfile guarded transport', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const clients: QueryClient[] = [];
  const originalUrl = window.location.href;

  function setMode(online: boolean, asOf: string | null = null) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    window.history.replaceState({}, '', asOf
      ? `/tesla-account?as_of=${encodeURIComponent(asOf)}`
      : '/tesla-account');
  }

  function setupMutation() {
    const qc = createQueryClient();
    clients.push(qc);
    const { Wrapper } = makeWrapper(qc);
    const retained = { profile: profileFixture, fetched_at: profileFixture.fetched_at };
    qc.setQueryData(userKeys.teslaProfile, retained);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const writeCache = vi.spyOn(qc, 'setQueryData');
    const hook = renderHook(() => useRefreshTeslaProfile(), { wrapper: Wrapper });
    return { ...hook, qc, retained, invalidate, writeCache };
  }

  function expectRejected(fixture: ReturnType<typeof setupMutation>, error: unknown) {
    expect(fixture.result.current.isSuccess).toBe(false);
    expect(fixture.result.current.isPending).toBe(false);
    expect(fixture.result.current.data).toBeUndefined();
    expect(fixture.result.current.error).toBe(error);
    expect(fixture.invalidate).not.toHaveBeenCalled();
    expect(fixture.writeCache).not.toHaveBeenCalled();
    expect(fixture.qc.getQueryData(userKeys.teslaProfile)).toBe(fixture.retained);
    expect(fixture.qc.getQueryState(userKeys.teslaProfile)?.isInvalidated).toBe(false);
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledExactlyOnceWith(
      error,
      'toast.user.teslaProfile.error',
      'Failed to refresh Tesla profile',
    );
  }

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
    vi.mocked(request).mockImplementation(actual.request);
    __resetSudoStateForTests();
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('Unexpected mocked transport call'));
    vi.stubGlobal('fetch', fetchMock);
    setMode(true);
  });

  afterEach(() => {
    cleanup();
    for (const client of clients.splice(0)) client.clear();
    __resetSudoStateForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', originalUrl);
  });

  it('live refresh crosses only mocked fetch and preserves success-only invalidation and toast', async () => {
    const response = { profile: profileFixture, fetched_at: profileFixture.fetched_at };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const fixture = setupMutation();
    expect(readOperationalModeFromEnvironment()).toMatchObject({ mode: 'live', isReadOnly: false });

    await act(async () => {
      expect(await fixture.result.current.mutateAsync(undefined)).toMatchObject(response);
    });
    await waitFor(() => expect(fixture.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/tesla/user/profile/refresh');
    expect(options).toMatchObject({ method: 'POST' });
    expect(options).not.toHaveProperty('requiresLiveMode');
    expect(fixture.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: userKeys.teslaProfile });
    expect(fixture.qc.getQueryState(userKeys.teslaProfile)?.isInvalidated).toBe(true);
    expect(fixture.writeCache).not.toHaveBeenCalled();
    expect(fixture.qc.getQueryData(userKeys.teslaProfile)).toBe(fixture.retained);
    expect(successToast).toHaveBeenCalledExactlyOnceWith(
      'toast.user.teslaProfile.success', 'Tesla profile refreshed',
    );
    expect(errorToast).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'historical snapshot', online: true, asOf: '2025-06-01T00:00:00Z', mode: 'as_of' },
    { label: 'historical replay instant', online: true, asOf: '2025-06-01T00:00:01Z', mode: 'as_of' },
    { label: 'offline cached view', online: false, asOf: null, mode: 'cached' },
    { label: 'offline historical replay', online: false, asOf: '2025-06-01T00:00:01Z', mode: 'as_of' },
  ] as const)('$label rejects before transport without success, cache changes or false toast', async ({ online, asOf, mode }) => {
    setMode(online, asOf);
    const fixture = setupMutation();
    expect(readOperationalModeFromEnvironment()).toMatchObject({ mode, online, isReadOnly: true });
    let error: unknown;

    await act(async () => {
      try {
        await fixture.result.current.mutateAsync(undefined);
      } catch (caught) {
        error = caught;
      }
    });
    await waitFor(() => expect(fixture.result.current.isError).toBe(true));

    expect(error).toBeInstanceOf(OperationalModeWriteError);
    expect(error).toMatchObject({ code: OPERATIONAL_MODE_READ_ONLY_CODE, mode });
    expect(fetchMock).not.toHaveBeenCalled();
    expectRejected(fixture, error);
  });

  it('reads mode at dispatch rather than trusting the live mode at hook render', async () => {
    const fixture = setupMutation();
    setMode(true, '2025-06-01T00:00:00Z');

    await act(async () => {
      await expect(fixture.result.current.mutateAsync(undefined)).rejects.toBeInstanceOf(OperationalModeWriteError);
    });
    await waitFor(() => expect(fixture.result.current.isError).toBe(true));

    expect(fetchMock).not.toHaveBeenCalled();
    expectRejected(fixture, fixture.result.current.error);
  });

  it('offline rejection never queues a POST on reconnect; explicit live retry alone succeeds', async () => {
    setMode(false);
    const fixture = setupMutation();
    await act(async () => {
      await expect(fixture.result.current.mutateAsync(undefined)).rejects.toBeInstanceOf(OperationalModeWriteError);
    });
    await waitFor(() => expect(fixture.result.current.isError).toBe(true));
    const error = fixture.result.current.error;
    expectRejected(fixture, error);

    setMode(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expectRejected(fixture, error);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ profile: profileFixture, fetched_at: null }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    await act(async () => { await fixture.result.current.mutateAsync(undefined); });
    await waitFor(() => expect(fixture.result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fixture.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: userKeys.teslaProfile });
    expect(successToast).toHaveBeenCalledExactlyOnceWith(
      'toast.user.teslaProfile.success', 'Tesla profile refreshed',
    );
    expect(errorToast).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'historical snapshot', online: true, asOf: '2025-06-01T00:00:00Z' },
    { label: 'offline cached view', online: false, asOf: null },
    { label: 'offline historical replay', online: false, asOf: '2025-06-01T00:00:01Z' },
  ] as const)('$label still permits the profile GET and forwards its cancellation signal', async ({ online, asOf }) => {
    setMode(online, asOf);
    const envelope = { profile: null, fetched_at: null };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(envelope), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const qc = createQueryClient();
    clients.push(qc);
    const { Wrapper } = makeWrapper(qc);
    const { result } = renderHook(() => useTeslaUserProfile(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ ...envelope, fetchedAt: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/tesla/user/profile');
    expect(options?.method ?? 'GET').toBe('GET');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options).not.toHaveProperty('requiresLiveMode');
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
  });
});

describe.each([
  {
    label: 'feature config',
    useRefresh: useRefreshTeslaFeatureConfig,
    useRead: useTeslaFeatureConfig,
    key: userKeys.teslaFeatureConfig,
    path: '/tesla/user/feature-config',
    retained: { data: { location_streaming: true }, fetched_at: null },
    successKey: 'toast.featureConfigRefreshed',
    successMessage: 'Feature config refreshed',
    errorKey: 'toast.featureConfigFailed',
    errorMessage: 'Failed to refresh feature config',
  },
  {
    label: 'region',
    useRefresh: useRefreshTeslaRegion,
    useRead: useTeslaUserRegion,
    key: userKeys.teslaRegion,
    path: '/tesla/user/region',
    retained: { data: { region: 'eu', fleet_api_base_url: 'https://example.test' }, fetched_at: null },
    successKey: 'toast.regionRefreshed',
    successMessage: 'Region info refreshed',
    errorKey: 'toast.regionFailed',
    errorMessage: 'Failed to refresh region',
  },
])('$label guarded transport', (scenario) => {
  const fetchMock = vi.fn<typeof fetch>();
  const clients: QueryClient[] = [];
  const originalUrl = window.location.href;

  function setMode(online: boolean, asOf: string | null = null) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    window.history.replaceState({}, '', asOf
      ? `/tesla-account?as_of=${encodeURIComponent(asOf)}`
      : '/tesla-account');
  }

  function setupMutation() {
    const qc = createQueryClient();
    clients.push(qc);
    const { Wrapper } = makeWrapper(qc);
    qc.setQueryData(scenario.key, scenario.retained);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const writeCache = vi.spyOn(qc, 'setQueryData');
    const hook = renderHook(() => scenario.useRefresh(), { wrapper: Wrapper });
    return { ...hook, qc, invalidate, writeCache };
  }

  function expectRejected(fixture: ReturnType<typeof setupMutation>) {
    expect(fixture.result.current.isSuccess).toBe(false);
    expect(fixture.result.current.isPending).toBe(false);
    expect(fixture.result.current.data).toBeUndefined();
    expect(fixture.invalidate).not.toHaveBeenCalled();
    expect(fixture.writeCache).not.toHaveBeenCalled();
    expect(fixture.qc.getQueryData(scenario.key)).toBe(scenario.retained);
    expect(fixture.qc.getQueryState(scenario.key)?.isInvalidated).toBe(false);
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledExactlyOnceWith(
      fixture.result.current.error, scenario.errorKey, scenario.errorMessage,
    );
  }

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
    vi.mocked(request).mockImplementation(actual.request);
    __resetSudoStateForTests();
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('Unexpected mocked transport call'));
    vi.stubGlobal('fetch', fetchMock);
    setMode(true);
  });

  afterEach(() => {
    cleanup();
    for (const client of clients.splice(0)) client.clear();
    __resetSudoStateForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', originalUrl);
  });

  it('live refresh uses POST and success-only invalidation with the accepted toast', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(scenario.retained), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const fixture = setupMutation();

    await act(async () => {
      expect(await fixture.result.current.mutateAsync(undefined)).toMatchObject(scenario.retained);
    });
    await waitFor(() => expect(fixture.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/v1${scenario.path}/refresh`);
    expect(options).toMatchObject({ method: 'POST' });
    expect(options).not.toHaveProperty('requiresLiveMode');
    expect(fixture.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: scenario.key });
    expect(fixture.qc.getQueryState(scenario.key)?.isInvalidated).toBe(true);
    expect(fixture.writeCache).not.toHaveBeenCalled();
    expect(fixture.qc.getQueryData(scenario.key)).toBe(scenario.retained);
    expect(successToast).toHaveBeenCalledExactlyOnceWith(scenario.successKey, scenario.successMessage);
    expect(errorToast).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'historical snapshot', online: true, asOf: '2025-06-01T00:00:00Z', mode: 'as_of' },
    { label: 'historical replay instant', online: true, asOf: '2025-06-01T00:00:01Z', mode: 'as_of' },
    { label: 'offline cached view', online: false, asOf: null, mode: 'cached' },
    { label: 'offline historical replay', online: false, asOf: '2025-06-01T00:00:01Z', mode: 'as_of' },
  ] as const)('$label rejects before transport and retains cache without false success', async ({ online, asOf, mode }) => {
    setMode(online, asOf);
    const fixture = setupMutation();
    expect(readOperationalModeFromEnvironment()).toMatchObject({ mode, online, isReadOnly: true });

    await act(async () => {
      await expect(fixture.result.current.mutateAsync(undefined)).rejects.toBeInstanceOf(OperationalModeWriteError);
    });
    await waitFor(() => expect(fixture.result.current.isError).toBe(true));

    expect(fixture.result.current.error).toMatchObject({ code: OPERATIONAL_MODE_READ_ONLY_CODE, mode });
    expect(fetchMock).not.toHaveBeenCalled();
    expectRejected(fixture);
  });

  it('checks mode at dispatch even when the hook rendered live', async () => {
    const fixture = setupMutation();
    setMode(true, '2025-06-01T00:00:00Z');

    await act(async () => {
      await expect(fixture.result.current.mutateAsync(undefined)).rejects.toBeInstanceOf(OperationalModeWriteError);
    });
    await waitFor(() => expect(fixture.result.current.isError).toBe(true));

    expect(fetchMock).not.toHaveBeenCalled();
    expectRejected(fixture);
  });

  it('does not queue rejected offline refreshes; only an explicit live retry succeeds', async () => {
    setMode(false);
    const fixture = setupMutation();
    await act(async () => {
      await expect(fixture.result.current.mutateAsync(undefined)).rejects.toBeInstanceOf(OperationalModeWriteError);
    });
    await waitFor(() => expect(fixture.result.current.isError).toBe(true));
    expectRejected(fixture);

    setMode(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expectRejected(fixture);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(scenario.retained), {
      headers: { 'Content-Type': 'application/json' },
    }));
    await act(async () => { await fixture.result.current.mutateAsync(undefined); });
    await waitFor(() => expect(fixture.result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fixture.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: scenario.key });
    expect(successToast).toHaveBeenCalledExactlyOnceWith(scenario.successKey, scenario.successMessage);
    expect(errorToast).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'historical snapshot', online: true, asOf: '2025-06-01T00:00:00Z' },
    { label: 'offline cached view', online: false, asOf: null },
    { label: 'offline historical replay', online: false, asOf: '2025-06-01T00:00:01Z' },
  ] as const)('$label still permits GET and forwards cancellation', async ({ online, asOf }) => {
    setMode(online, asOf);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(scenario.retained), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const qc = createQueryClient();
    clients.push(qc);
    const { Wrapper } = makeWrapper(qc);
    const { result } = renderHook(() => scenario.useRead(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject(scenario.retained);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/v1${scenario.path}`);
    expect(options?.method ?? 'GET').toBe('GET');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options).not.toHaveProperty('requiresLiveMode');
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
  });
});
