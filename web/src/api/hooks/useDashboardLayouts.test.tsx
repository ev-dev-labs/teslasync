// Behavioural coverage for the named dashboard-layout library hooks in
// useDashboardLayouts.ts (the client half of the per-row "save as preset"
// feature backed by internal/api/dashboardlayout/handler.go).
//
// Every export is exercised through its real call site:
//   - dashboardLayoutLibraryKeys — key-factory identity + scope uniqueness
//   - useNamedDashboardLayouts   — list read: URL, vehicle scoping, signal
//     threading, safeArray null/non-array coercion, and the error path
//   - useCreateDashboardLayout   — POST body/method + invalidation + toast
//   - useUpdateDashboardLayout   — PUT with id in the URL, id stripped from body
//   - useDeleteDashboardLayout   — DELETE method, no body
//   - useApplyDashboardLayout    — POST /{id}/apply, invalidation + toast
//
// Network is mocked at the `request` boundary and the toast helper is stubbed
// so we can assert i18n keys + invalidation targets without a live Toast bus —
// the repo convention (see useAutomations.test.tsx / useExports.test.tsx).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mocks ─────────────────────────────────────────────────────────────────
// Hoisted so the (also-hoisted) mock factories close over the same spy
// instances the assertions read.
const { requestMock, toastSuccess, toastError } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toastSuccess, error: toastError }),
}));

import {
  dashboardLayoutLibraryKeys,
  useNamedDashboardLayouts,
  useCreateDashboardLayout,
  useUpdateDashboardLayout,
  useDeleteDashboardLayout,
  useApplyDashboardLayout,
  type NamedDashboardLayout,
  type CreateDashboardLayoutInput,
  type UpdateDashboardLayoutInput,
} from './useDashboardLayouts';

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** URL string the mocked `request` was called with on invocation `i`. */
function calledUrl(i = 0): string {
  return requestMock.mock.calls[i]?.[0] as string;
}
/** RequestInit the mocked `request` was called with on invocation `i`. */
function calledOpts(i = 0): RequestInit {
  return requestMock.mock.calls[i]?.[1] as RequestInit;
}

function makeLayout(overrides: Partial<NamedDashboardLayout> = {}): NamedDashboardLayout {
  return {
    id: 1,
    user_id: 10,
    vehicle_id: null,
    name: 'Morning Quick-Glance',
    is_default: false,
    layout: { widgets: [], layouts: {} },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

// ── dashboardLayoutLibraryKeys ──────────────────────────────────────────────
describe('dashboardLayoutLibraryKeys', () => {
  it('exposes a stable root key that mutations invalidate', () => {
    expect(dashboardLayoutLibraryKeys.all).toEqual(['dashboard-layouts-library']);
  });

  it('maps a nullish vehicle scope to the shared "global" bucket', () => {
    expect(dashboardLayoutLibraryKeys.list(undefined)).toEqual([
      'dashboard-layouts-library',
      'global',
    ]);
    expect(dashboardLayoutLibraryKeys.list(null)).toEqual([
      'dashboard-layouts-library',
      'global',
    ]);
  });

  it('keys per-vehicle scopes distinctly so caches never collide', () => {
    expect(dashboardLayoutLibraryKeys.list(42)).toEqual([
      'dashboard-layouts-library',
      42,
    ]);
    // The global bucket and a per-vehicle bucket must be different tuples,
    // otherwise switching the switcher's vehicle would show stale rows.
    expect(dashboardLayoutLibraryKeys.list(42)).not.toEqual(
      dashboardLayoutLibraryKeys.list(7),
    );
    expect(dashboardLayoutLibraryKeys.list(42)).not.toEqual(
      dashboardLayoutLibraryKeys.list(undefined),
    );
  });

  it('nests every scope under the root key so `all` invalidation is a prefix match', () => {
    expect(dashboardLayoutLibraryKeys.list(42)[0]).toBe(
      dashboardLayoutLibraryKeys.all[0],
    );
    expect(dashboardLayoutLibraryKeys.list(undefined)[0]).toBe(
      dashboardLayoutLibraryKeys.all[0],
    );
  });
});

// ── useNamedDashboardLayouts ────────────────────────────────────────────────
describe('useNamedDashboardLayouts', () => {
  it('GETs /dashboard/layouts with no query string and threads the AbortSignal', async () => {
    const rows = [makeLayout({ id: 1 }), makeLayout({ id: 2, name: 'Trip mode' })];
    requestMock.mockResolvedValueOnce(rows);

    const { result } = renderHook(() => useNamedDashboardLayouts(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(calledUrl()).toBe('/dashboard/layouts');
    // React Query cancels the in-flight fetch on unmount/navigation via signal.
    expect(calledOpts()).toHaveProperty('signal');
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[1].name).toBe('Trip mode');
  });

  it('scopes the request to a vehicle via ?vehicle_id when an id is supplied', async () => {
    requestMock.mockResolvedValueOnce([makeLayout({ id: 5, vehicle_id: 42 })]);

    const { result } = renderHook(() => useNamedDashboardLayouts(42), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/dashboard/layouts?vehicle_id=42');
    expect(result.current.data?.[0].vehicle_id).toBe(42);
  });

  it('omits the query string when the vehicle id is explicitly null', async () => {
    requestMock.mockResolvedValueOnce([]);

    renderHook(() => useNamedDashboardLayouts(null), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(calledUrl()).toBe('/dashboard/layouts');
  });

  it('coerces a null payload to an empty array so consumers can map without a guard', async () => {
    requestMock.mockResolvedValueOnce(null as unknown as NamedDashboardLayout[]);

    const { result } = renderHook(() => useNamedDashboardLayouts(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('coerces a non-array payload to an empty array (defensive safeArray)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    requestMock.mockResolvedValueOnce({ oops: true } as unknown as NamedDashboardLayout[]);

    const { result } = renderHook(() => useNamedDashboardLayouts(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('surfaces request failures as an error state', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useNamedDashboardLayouts(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeUndefined();
  });
});

// ── useCreateDashboardLayout ────────────────────────────────────────────────
describe('useCreateDashboardLayout', () => {
  const input: CreateDashboardLayoutInput = {
    name: 'Morning Quick-Glance',
    vehicle_id: 42,
    is_default: true,
    layout: { widgets: [], layouts: {} },
  };

  it('POSTs the JSON payload and returns the created row', async () => {
    const created = makeLayout({ id: 99, name: input.name, vehicle_id: 42, is_default: true });
    requestMock.mockResolvedValueOnce(created);

    const { result } = renderHook(() => useCreateDashboardLayout(), {
      wrapper: wrapperFor(makeClient()),
    });

    const row = await result.current.mutateAsync(input);
    expect(row.id).toBe(99);
    expect(calledUrl()).toBe('/dashboard/layouts');
    const opts = calledOpts();
    expect(opts.method).toBe('POST');
    expect(new Headers(opts.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(opts.body as string)).toEqual(input);
  });

  it('invalidates the library root and raises a success toast on completion', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    requestMock.mockResolvedValueOnce(makeLayout({ id: 99 }));

    const { result } = renderHook(() => useCreateDashboardLayout(), {
      wrapper: wrapperFor(client),
    });

    await result.current.mutateAsync(input);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardLayoutLibraryKeys.all,
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'toast.dashboard.layoutSaved.success',
      'Layout saved to library',
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('raises an error toast and does not invalidate when the POST fails', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    requestMock.mockRejectedValueOnce(new Error('server exploded'));

    const { result } = renderHook(() => useCreateDashboardLayout(), {
      wrapper: wrapperFor(client),
    });

    await expect(result.current.mutateAsync(input)).rejects.toThrow('server exploded');
    expect(toastError).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dashboard.layoutSaved.error',
      'Failed to save layout',
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

// ── useUpdateDashboardLayout ────────────────────────────────────────────────
describe('useUpdateDashboardLayout', () => {
  it('PUTs to /dashboard/layouts/{id} and strips id from the request body', async () => {
    const patch: UpdateDashboardLayoutInput = {
      id: 7,
      name: 'Renamed',
      is_default: true,
      layout: { widgets: [] },
    };
    requestMock.mockResolvedValueOnce(makeLayout({ id: 7, name: 'Renamed', is_default: true }));

    const { result } = renderHook(() => useUpdateDashboardLayout(), {
      wrapper: wrapperFor(makeClient()),
    });

    const row = await result.current.mutateAsync(patch);
    expect(row.name).toBe('Renamed');
    expect(calledUrl()).toBe('/dashboard/layouts/7');
    const opts = calledOpts();
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body as string);
    // id belongs in the path, never the payload — the backend treats scope as
    // immutable and only reads name/is_default/layout.
    expect(body).not.toHaveProperty('id');
    expect(body).toEqual({ name: 'Renamed', is_default: true, layout: { widgets: [] } });
  });

  it('invalidates the library and toasts on a successful update', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    requestMock.mockResolvedValueOnce(makeLayout({ id: 7 }));

    const { result } = renderHook(() => useUpdateDashboardLayout(), {
      wrapper: wrapperFor(client),
    });

    await result.current.mutateAsync({ id: 7, name: 'x' });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardLayoutLibraryKeys.all,
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'toast.dashboard.layoutUpdated.success',
      'Layout updated',
    );
  });

  it('toasts the update error when the PUT rejects', async () => {
    requestMock.mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useUpdateDashboardLayout(), {
      wrapper: wrapperFor(makeClient()),
    });

    await expect(result.current.mutateAsync({ id: 7, name: 'x' })).rejects.toThrow('nope');
    expect(toastError).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dashboard.layoutUpdated.error',
      'Failed to update layout',
    );
  });
});

// ── useDeleteDashboardLayout ────────────────────────────────────────────────
describe('useDeleteDashboardLayout', () => {
  it('DELETEs /dashboard/layouts/{id} with no request body', async () => {
    requestMock.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDeleteDashboardLayout(), {
      wrapper: wrapperFor(makeClient()),
    });

    await result.current.mutateAsync(13);
    expect(calledUrl()).toBe('/dashboard/layouts/13');
    const opts = calledOpts();
    expect(opts.method).toBe('DELETE');
    expect(opts.body).toBeUndefined();
  });

  it('invalidates the library and toasts on a successful delete', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    requestMock.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDeleteDashboardLayout(), {
      wrapper: wrapperFor(client),
    });

    await result.current.mutateAsync(13);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardLayoutLibraryKeys.all,
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'toast.dashboard.layoutDeleted.success',
      'Layout deleted',
    );
  });

  it('toasts the delete error when the request rejects', async () => {
    requestMock.mockRejectedValueOnce(new Error('locked'));

    const { result } = renderHook(() => useDeleteDashboardLayout(), {
      wrapper: wrapperFor(makeClient()),
    });

    await expect(result.current.mutateAsync(13)).rejects.toThrow('locked');
    expect(toastError).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dashboard.layoutDeleted.error',
      'Failed to delete layout',
    );
  });
});

// ── useApplyDashboardLayout ─────────────────────────────────────────────────
describe('useApplyDashboardLayout', () => {
  it('POSTs to /dashboard/layouts/{id}/apply and returns the promoted row', async () => {
    const applied = makeLayout({ id: 4, is_default: true });
    requestMock.mockResolvedValueOnce(applied);

    const { result } = renderHook(() => useApplyDashboardLayout(), {
      wrapper: wrapperFor(makeClient()),
    });

    const row = await result.current.mutateAsync(4);
    expect(row.is_default).toBe(true);
    expect(calledUrl()).toBe('/dashboard/layouts/4/apply');
    expect(calledOpts().method).toBe('POST');
  });

  it('invalidates the library and toasts on a successful apply', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    requestMock.mockResolvedValueOnce(makeLayout({ id: 4, is_default: true }));

    const { result } = renderHook(() => useApplyDashboardLayout(), {
      wrapper: wrapperFor(client),
    });

    await result.current.mutateAsync(4);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardLayoutLibraryKeys.all,
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'toast.dashboard.layoutApplied.success',
      'Layout applied',
    );
  });

  it('toasts the apply error when the request rejects', async () => {
    requestMock.mockRejectedValueOnce(new Error('gone'));

    const { result } = renderHook(() => useApplyDashboardLayout(), {
      wrapper: wrapperFor(makeClient()),
    });

    await expect(result.current.mutateAsync(4)).rejects.toThrow('gone');
    expect(toastError).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dashboard.layoutApplied.error',
      'Failed to apply layout',
    );
  });
});
