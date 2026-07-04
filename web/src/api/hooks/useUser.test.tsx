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
// Network is stubbed at the request() boundary; the mutation-toast bridge is
// replaced with spies so onSuccess/onError assertions are exact and no
// ToastProvider / i18n instance is required.
//
// Keep this test next to the hook — the gate's path-scoped checks match
// `api/hooks/useUser` as a contiguous substring.

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

import { request, ApiError } from '@/api/client';
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
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.teslaFeatureConfig });
    expect(successToast).toHaveBeenCalledWith(
      'toast.user.featureConfig.success',
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
      'toast.user.featureConfig.error',
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
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.teslaRegion });
    expect(successToast).toHaveBeenCalledWith('toast.user.region.success', 'Region refreshed');
  });

  it('toasts the error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('down'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRefreshTeslaRegion(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(undefined)).rejects.toThrow('down');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.user.region.error',
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
