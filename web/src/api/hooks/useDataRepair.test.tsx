// useDataRepair hook-suite tests.
//
// Covers EVERY export of useDataRepair.ts:
//   - dataRepairKeys                       — stable, distinct query-key tuple.
//   - useStaleSessions                     — GET /data-repair/stale-sessions,
//     AbortSignal threading, payload passthrough, and an error path.
//   - useUpdateCharging / useCloseCharging / useDiscardCharging
//                                          — HTTP method + URL + JSON body,
//     cache invalidation (dataRepairKeys.stale), and success/error toast wiring.
//   - useUpdateDrive / useCloseDrive / useDiscardDrive
//                                          — same, PLUS a regression guard that
//     the drive routes are SINGULAR (`/drive/`, not the pre-refactor `/drives/`
//     that 404'd every drive mutation — see the hook's file header).
//
// Network is stubbed at the request() boundary; the mutation-toast bridge is
// replaced with spies so each handler's exact i18n key + English fallback is
// asserted without mounting a ToastProvider / i18n instance. The real
// invalidateAndBroadcast runs against the test QueryClient (spied) and its
// coalesced cross-tab timer is drained in afterEach.
//
// Keep this test next to the hook — the gate's path-scoped checks match
// `api/hooks/useDataRepair` as a contiguous substring.

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

// Replace the toast bridge with spies so onSuccess/onError assertions are exact
// and no ToastProvider / i18n instance is required.
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: successToast, error: errorToast }),
}));

import { request } from '@/api/client';
import { __flushQueryBroadcastForTests } from '@/lib/queryBroadcast';
import {
  dataRepairKeys,
  useStaleSessions,
  useUpdateCharging,
  useCloseCharging,
  useDiscardCharging,
  useUpdateDrive,
  useCloseDrive,
  useDiscardDrive,
  type RepairPatch,
  type StaleSessionsResponse,
} from './useDataRepair';

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
// Key factory
// ---------------------------------------------------------------------------

describe('dataRepairKeys', () => {
  it('exposes the stable stale-sessions query-key tuple', () => {
    expect(dataRepairKeys.stale).toEqual(['data-repair', 'stale-sessions']);
    // Read-only const object — the tuple identity is the query cache anchor
    // every mutation invalidates, so its shape must not drift.
    expect(dataRepairKeys.stale).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// useStaleSessions (query)
// ---------------------------------------------------------------------------

describe('useStaleSessions', () => {
  it('GETs /data-repair/stale-sessions, threads the abort signal, and returns the payload', async () => {
    const payload: StaleSessionsResponse = {
      stale_charging: [
        {
          id: 1,
          vehicle_id: 7,
          started_at: '2026-01-01T00:00:00Z',
          total_energy_added_wh: 42_000,
          peak_power_w: 11_000,
        },
      ],
      stale_drives: [
        { id: 2, vehicle_id: 7, start_ts: '2026-01-01T00:00:00Z', distance_m: 1_000 },
      ],
    };
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStaleSessions(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(payload);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/stale-sessions');
    // TanStack Query hands the queryFn an AbortSignal so route changes cancel
    // the in-flight poll; the hook must forward it to request().
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a request rejection as isError without leaking stale data', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('stale-sessions 500'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStaleSessions(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Charging mutations
// ---------------------------------------------------------------------------

describe('useUpdateCharging', () => {
  it('PUTs the SI patch to /data-repair/charging/{id}, invalidates the worklist, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateCharging(), { wrapper: Wrapper });

    const patch: RepairPatch = { end_soc_pct: 90, total_energy_added_wh: 42_000 };
    await result.current.mutateAsync({ id: 42, patch });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/charging/42');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body as string)).toEqual(patch);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith(
      'toast.dataRepair.charging.update.success',
      'Charging session updated',
    );
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('toasts the error and rejects (no invalidation) when the PUT fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('charging update boom'));
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateCharging(), { wrapper: Wrapper });

    await expect(
      result.current.mutateAsync({ id: 1, patch: { end_soc_pct: 80 } }),
    ).rejects.toThrow('charging update boom');

    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.charging.update.error',
      'Failed to update charging session',
    );
    expect(successToast).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useCloseCharging', () => {
  it('POSTs to /data-repair/charging/{id}/close (no body), invalidates, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCloseCharging(), { wrapper: Wrapper });

    await result.current.mutateAsync(5);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/charging/5/close');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith(
      'toast.dataRepair.charging.close.success',
      'Charging session closed',
    );
  });

  it('toasts the close error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('close boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCloseCharging(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(9)).rejects.toThrow('close boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.charging.close.error',
      'Failed to close charging session',
    );
    expect(successToast).not.toHaveBeenCalled();
  });
});

describe('useDiscardCharging', () => {
  it('DELETEs /data-repair/charging/{id}, invalidates, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDiscardCharging(), { wrapper: Wrapper });

    await result.current.mutateAsync(55);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/charging/55');
    expect(opts.method).toBe('DELETE');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith(
      'toast.dataRepair.charging.discard.success',
      'Charging session discarded',
    );
  });

  it('toasts the discard error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('discard boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDiscardCharging(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(9)).rejects.toThrow('discard boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.charging.discard.error',
      'Failed to discard charging session',
    );
  });
});

// ---------------------------------------------------------------------------
// Drive mutations — the routes are SINGULAR (`/drive/`). Guard the regression.
// ---------------------------------------------------------------------------

describe('useUpdateDrive', () => {
  it('PUTs the patch to the SINGULAR /data-repair/drive/{id} route, invalidates, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateDrive(), { wrapper: Wrapper });

    const patch: RepairPatch = { distance_m: 12_500, duration_s: 900, max_speed_mps: 30 };
    await result.current.mutateAsync({ id: 8, patch });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/drive/8');
    // Regression guard: the pre-refactor page used the plural `/drives/` which
    // 404'd every drive mutation. It MUST stay singular.
    expect(url).not.toContain('/drives/');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body as string)).toEqual(patch);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith('toast.dataRepair.drive.update.success', 'Drive updated');
  });

  it('toasts the drive update error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('drive update boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateDrive(), { wrapper: Wrapper });

    await expect(
      result.current.mutateAsync({ id: 3, patch: { distance_m: 1 } }),
    ).rejects.toThrow('drive update boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.drive.update.error',
      'Failed to update drive',
    );
    expect(successToast).not.toHaveBeenCalled();
  });
});

describe('useCloseDrive', () => {
  it('POSTs to the singular /data-repair/drive/{id}/close route and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCloseDrive(), { wrapper: Wrapper });

    await result.current.mutateAsync(17);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/drive/17/close');
    expect(url).not.toContain('/drives/');
    expect(opts.method).toBe('POST');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith('toast.dataRepair.drive.close.success', 'Drive closed');
  });

  it('toasts the drive close error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('drive close boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCloseDrive(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(1)).rejects.toThrow('drive close boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.drive.close.error',
      'Failed to close drive',
    );
  });
});

describe('useDiscardDrive', () => {
  it('DELETEs the singular /data-repair/drive/{id} route, invalidates, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDiscardDrive(), { wrapper: Wrapper });

    await result.current.mutateAsync(71);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/drive/71');
    expect(url).not.toContain('/drives/');
    expect(opts.method).toBe('DELETE');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith('toast.dataRepair.drive.discard.success', 'Drive discarded');
  });

  it('toasts the drive discard error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('drive discard boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDiscardDrive(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(9)).rejects.toThrow('drive discard boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.drive.discard.error',
      'Failed to discard drive',
    );
  });
});
