// useVehicleAccess hook-layer tests.
//
// useVehicleAccess.ts is the Tesla "vehicle access" TanStack Query surface
// backing <VehicleAccessPage> and <VehicleAccessWidget>: two list queries
// (shared drivers + share invitations, each guarded by a vehicleId and coerced
// through safeArray) plus five mutations that refresh, remove, create, or
// revoke access and then invalidate the matching list cache.
//
// These tests exercise the contract each export exposes — the exact request
// path (no /api/v1 prefix, snake_case body keys), the AbortSignal
// thread-through, the enabled/id guard, the safeArray null-coercion applied in
// `select`, and every mutation's cache-invalidation + i18n-keyed success/error
// toast — without standing up the whole Vehicle Access page.
//
// Sibling-of-source location is mandatory: the elevation gate resolves the
// co-located test next to the source and runs `vitest run` against
// `src/api/hooks/useVehicleAccess.test.tsx`.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The source toasts through useMutationToast; swap it for hoisted spies so we
// can assert the exact i18n key + fallback each mutation emits without standing
// up ToastProvider + an initialised react-i18next instance.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toast.success, error: toast.error }),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request } from '@/api/client';
import {
  vehicleAccessKeys,
  useVehicleDrivers,
  useVehicleInvitations,
  useRefreshVehicleDrivers,
  useRefreshVehicleInvitations,
  useRemoveVehicleDriver,
  useCreateVehicleInvitation,
  useRevokeVehicleInvitation,
} from './useVehicleAccess';
import type { VehicleDriver, VehicleInvitation } from '@/api/types';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const VEHICLE_ID = '123';

const driver: VehicleDriver = {
  id: 1,
  vehicle_id: 123,
  share_user_id: 42,
  driver_email: 'ada@example.com',
  driver_name: 'Ada',
  role: 'driver',
  fetched_at: '2024-01-01T00:00:00Z',
};

const invitation: VehicleInvitation = {
  id: 7,
  vehicle_id: 123,
  invitation_id: 'inv-9',
  invite_url: 'https://www.tesla.com/_ak/xyz',
  status: 'pending',
  expires_at: '2024-02-01T00:00:00Z',
  created_by: 'owner@example.com',
  fetched_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
};

/**
 * Fresh QueryClient + provider wrapper per test. `invalidateQueries` is spied so
 * a test can assert precisely which list cache a mutation's onSuccess touched.
 */
function setup() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, wrapper, invalidateSpy };
}

beforeEach(() => {
  mockedRequest.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('vehicleAccessKeys', () => {
  it('builds namespaced, id-scoped query-key tuples', () => {
    expect(vehicleAccessKeys.drivers('123')).toEqual(['vehicle-drivers', '123']);
    expect(vehicleAccessKeys.invitations('123')).toEqual(['vehicle-invitations', '123']);
  });

  it('keeps driver and invitation keys distinct and id-scoped', () => {
    expect(vehicleAccessKeys.drivers('123')).not.toEqual(vehicleAccessKeys.invitations('123'));
    expect(vehicleAccessKeys.drivers('123')).not.toEqual(vehicleAccessKeys.drivers('456'));
    // The empty-id fallback the queries use when vehicleId is undefined.
    expect(vehicleAccessKeys.drivers('')).toEqual(['vehicle-drivers', '']);
  });
});

describe('useVehicleDrivers', () => {
  it('is disabled and fires no request when vehicleId is undefined', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useVehicleDrivers(undefined), { wrapper });

    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
  });

  it('GETs /vehicles/{id}/drivers with the abort signal and returns the list', async () => {
    const { wrapper } = setup();
    mockedRequest.mockResolvedValueOnce([driver]);

    const { result } = renderHook(() => useVehicleDrivers(VEHICLE_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([driver]);
    expect(mockedRequest).toHaveBeenCalledWith(
      '/vehicles/123/drivers',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('coerces a null payload to [] via the safeArray select', async () => {
    const { wrapper } = setup();
    mockedRequest.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useVehicleDrivers(VEHICLE_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it('coerces a non-array payload to [] and warns instead of crashing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { wrapper } = setup();
    mockedRequest.mockResolvedValueOnce({ not: 'an array' });

    const { result } = renderHook(() => useVehicleDrivers(VEHICLE_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('surfaces the error state when the request rejects', async () => {
    const { wrapper } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('drivers down'));

    const { result } = renderHook(() => useVehicleDrivers(VEHICLE_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toEqual(new Error('drivers down'));
  });
});

describe('useVehicleInvitations', () => {
  it('is disabled and fires no request when vehicleId is undefined', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useVehicleInvitations(undefined), { wrapper });

    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('GETs /vehicles/{id}/invitations with the abort signal and returns the list', async () => {
    const { wrapper } = setup();
    mockedRequest.mockResolvedValueOnce([invitation]);

    const { result } = renderHook(() => useVehicleInvitations(VEHICLE_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([invitation]);
    expect(mockedRequest).toHaveBeenCalledWith(
      '/vehicles/123/invitations',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('coerces a null payload to [] via the safeArray select', async () => {
    const { wrapper } = setup();
    mockedRequest.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useVehicleInvitations(VEHICLE_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });
});

describe('useRefreshVehicleDrivers', () => {
  it('POSTs the refresh endpoint, invalidates the drivers cache, and toasts success', async () => {
    const { wrapper, invalidateSpy } = setup();
    mockedRequest.mockResolvedValueOnce([driver]);

    const { result } = renderHook(() => useRefreshVehicleDrivers(), { wrapper });
    const returned = await result.current.mutateAsync(VEHICLE_ID);

    expect(returned).toEqual([driver]);
    expect(mockedRequest).toHaveBeenCalledWith('/vehicles/123/drivers/refresh', { method: 'POST' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: vehicleAccessKeys.drivers(VEHICLE_ID) });
    expect(toast.success).toHaveBeenCalledWith(
      'toast.vehicleAccess.drivers.refresh.success',
      'Drivers refreshed',
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('toasts a refresh-specific error, rejects, and skips invalidation on failure', async () => {
    const { wrapper, invalidateSpy } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useRefreshVehicleDrivers(), { wrapper });
    await expect(result.current.mutateAsync(VEHICLE_ID)).rejects.toThrow('boom');

    expect(toast.error).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.vehicleAccess.drivers.refresh.error',
      'Failed to refresh drivers',
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('useRefreshVehicleInvitations', () => {
  it('POSTs the refresh endpoint, invalidates the invitations cache, and toasts success', async () => {
    const { wrapper, invalidateSpy } = setup();
    mockedRequest.mockResolvedValueOnce([invitation]);

    const { result } = renderHook(() => useRefreshVehicleInvitations(), { wrapper });
    await result.current.mutateAsync(VEHICLE_ID);

    expect(mockedRequest).toHaveBeenCalledWith('/vehicles/123/invitations/refresh', { method: 'POST' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: vehicleAccessKeys.invitations(VEHICLE_ID) });
    expect(toast.success).toHaveBeenCalledWith(
      'toast.vehicleAccess.invitations.refresh.success',
      'Invitations refreshed',
    );
  });

  it('toasts an invitations-refresh error on failure', async () => {
    const { wrapper } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('bad gateway'));

    const { result } = renderHook(() => useRefreshVehicleInvitations(), { wrapper });
    await expect(result.current.mutateAsync(VEHICLE_ID)).rejects.toThrow('bad gateway');

    expect(toast.error).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.vehicleAccess.invitations.refresh.error',
      'Failed to refresh invitations',
    );
  });
});

describe('useRemoveVehicleDriver', () => {
  it('DELETEs with a snake_case share_user_id body and invalidates the drivers cache', async () => {
    const { wrapper, invalidateSpy } = setup();
    mockedRequest.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useRemoveVehicleDriver(), { wrapper });
    await result.current.mutateAsync({ vehicleId: VEHICLE_ID, shareUserId: 42 });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/vehicles/123/drivers');
    expect(opts.method).toBe('DELETE');
    expect(JSON.parse(opts.body as string)).toEqual({ share_user_id: 42 });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: vehicleAccessKeys.drivers(VEHICLE_ID) });
    expect(toast.success).toHaveBeenCalledWith(
      'toast.vehicleAccess.drivers.remove.success',
      'Driver removed',
    );
  });

  it('toasts a remove-specific error on failure', async () => {
    const { wrapper, invalidateSpy } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('forbidden'));

    const { result } = renderHook(() => useRemoveVehicleDriver(), { wrapper });
    await expect(
      result.current.mutateAsync({ vehicleId: VEHICLE_ID, shareUserId: 42 }),
    ).rejects.toThrow('forbidden');

    expect(toast.error).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.vehicleAccess.drivers.remove.error',
      'Failed to remove driver',
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useCreateVehicleInvitation', () => {
  it('POSTs /invitations, returns the created invitation, and invalidates the cache', async () => {
    const { wrapper, invalidateSpy } = setup();
    mockedRequest.mockResolvedValueOnce(invitation);

    const { result } = renderHook(() => useCreateVehicleInvitation(), { wrapper });
    const returned = await result.current.mutateAsync(VEHICLE_ID);

    expect(returned).toEqual(invitation);
    expect(mockedRequest).toHaveBeenCalledWith('/vehicles/123/invitations', { method: 'POST' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: vehicleAccessKeys.invitations(VEHICLE_ID) });
    expect(toast.success).toHaveBeenCalledWith(
      'toast.vehicleAccess.invitations.create.success',
      'Invitation created',
    );
  });

  it('toasts a create-specific error on failure', async () => {
    const { wrapper } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('rate limited'));

    const { result } = renderHook(() => useCreateVehicleInvitation(), { wrapper });
    await expect(result.current.mutateAsync(VEHICLE_ID)).rejects.toThrow('rate limited');

    expect(toast.error).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.vehicleAccess.invitations.create.error',
      'Failed to create invitation',
    );
  });
});

describe('useRevokeVehicleInvitation', () => {
  it('POSTs the id-scoped revoke endpoint and invalidates the invitations cache', async () => {
    const { wrapper, invalidateSpy } = setup();
    mockedRequest.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useRevokeVehicleInvitation(), { wrapper });
    await result.current.mutateAsync({ vehicleId: VEHICLE_ID, invitationId: 'inv-9' });

    expect(mockedRequest).toHaveBeenCalledWith(
      '/vehicles/123/invitations/inv-9/revoke',
      { method: 'POST' },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: vehicleAccessKeys.invitations(VEHICLE_ID) });
    expect(toast.success).toHaveBeenCalledWith(
      'toast.vehicleAccess.invitations.revoke.success',
      'Invitation revoked',
    );
  });

  it('toasts a revoke-specific error on failure', async () => {
    const { wrapper } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('conflict'));

    const { result } = renderHook(() => useRevokeVehicleInvitation(), { wrapper });
    await expect(
      result.current.mutateAsync({ vehicleId: VEHICLE_ID, invitationId: 'inv-9' }),
    ).rejects.toThrow('conflict');

    expect(toast.error).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.vehicleAccess.invitations.revoke.error',
      'Failed to revoke invitation',
    );
  });
});
