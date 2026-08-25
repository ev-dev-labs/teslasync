// useSavedViews hook-family tests.
//
// Covers EVERY export of ./useSavedViews:
//   - savedViewsKeys                 (stable, per-route query keys)
//   - useSavedViews                  (GET, snake_case route param, URL-encoding,
//                                     AbortSignal threading, the always-an-array
//                                     contract enforced by select: safeArray,
//                                     and the error path)
//   - useAllSavedViews               (GET all routes for global discovery)
//   - useCreateSavedView             (POST body, global saved-view invalidation,
//                                     success + error toasts)
//   - useUpdateSavedView             (PUT body + global saved-view invalidation)
//   - useDeleteSavedView             (DELETE, optimistic removal before the server
//                                     answers, rollback on failure)
//   - useSetDefaultSavedView         (PUT {is_default} with the correct toggle
//                                     branch + toast key)
//
// Network is mocked at @/api/client; the cross-tab invalidation, toast, and
// i18n layers are stubbed so assertions stay deterministic and never touch a
// real BroadcastChannel / provider tree.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('@/lib/queryBroadcast', () => ({
  invalidateAndBroadcast: vi.fn(),
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/components/feedback/Toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
  useOptionalToast: () => ({ success: toastSuccess, error: toastError }),
}));

// Deterministic i18n: t(key) -> key, so we can assert the exact toast keys the
// hooks pick (e.g. the set-default vs unset-default branch).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { request } from '@/api/client';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import type { SavedView } from '../types';
import {
  savedViewsKeys,
  useSavedViews,
  useAllSavedViews,
  useCreateSavedView,
  useUpdateSavedView,
  useDeleteSavedView,
  useSetDefaultSavedView,
  type UpdateSavedViewArgs,
  type DeleteSavedViewArgs,
  type SetDefaultSavedViewArgs,
} from './useSavedViews';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;
const mockedInvalidate = invalidateAndBroadcast as unknown as ReturnType<typeof vi.fn>;

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function mkView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    id: 1,
    user_id: 7,
    name: 'Last week',
    route: '/drives',
    query: 'from=2025-04-24&sort=distance',
    is_default: false,
    is_pinned: false,
    sort_order: 0,
    created_at: '2025-06-15T12:00:00Z',
    updated_at: '2025-06-15T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockedRequest.mockReset();
  mockedInvalidate.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

// ---------------------------------------------------------------------------
// savedViewsKeys
// ---------------------------------------------------------------------------

describe('savedViewsKeys', () => {
  it('exposes a stable base key', () => {
    expect(savedViewsKeys.all).toEqual(['saved-views']);
    expect(savedViewsKeys.allList).toEqual(['saved-views', 'all']);
  });

  it('scopes the list key per route and keeps distinct routes distinct', () => {
    expect(savedViewsKeys.list('/drives')).toEqual(['saved-views', '/drives']);
    expect(savedViewsKeys.list('/charging')).toEqual(['saved-views', '/charging']);
    expect(savedViewsKeys.list('/drives')).not.toEqual(savedViewsKeys.list('/charging'));
  });
});

// ---------------------------------------------------------------------------
// useSavedViews (query)
// ---------------------------------------------------------------------------

describe('useSavedViews', () => {
  it('GETs /saved-views with a snake_case, URL-encoded route param and threads the AbortSignal', async () => {
    const rows = [mkView({ id: 1 }), mkView({ id: 2, name: 'Long trips' })];
    mockedRequest.mockResolvedValueOnce(rows);

    const { result } = renderHook(() => useSavedViews('/drives'), {
      wrapper: makeWrapper(newClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[1].name).toBe('Long trips');

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = mockedRequest.mock.calls[0];
    // snake_case param name + form-urlencoded value ('/' -> %2F).
    expect(url).toBe('/saved-views?route=%2Fdrives');
    expect(opts).toHaveProperty('signal');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('percent-encodes routes that contain reserved characters', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    renderHook(() => useSavedViews('/vehicles/:id'), {
      wrapper: makeWrapper(newClient()),
    });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe('/saved-views?route=%2Fvehicles%2F%3Aid');
  });

  it('coerces a null payload to [] so the always-an-array contract holds', async () => {
    mockedRequest.mockResolvedValueOnce(null as unknown as SavedView[]);
    const { result } = renderHook(() => useSavedViews('/drives'), {
      wrapper: makeWrapper(newClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(Array.isArray(result.current.data)).toBe(true);
  });

  it('coerces a non-array object payload to []', async () => {
    mockedRequest.mockResolvedValueOnce({ oops: true } as unknown as SavedView[]);
    const { result } = renderHook(() => useSavedViews('/drives'), {
      wrapper: makeWrapper(newClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('surfaces request failures as isError without throwing', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useSavedViews('/drives'), {
      wrapper: makeWrapper(newClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeUndefined();
  });
});

describe('useAllSavedViews', () => {
  it('GETs the unfiltered collection and normalizes its payload', async () => {
    mockedRequest.mockResolvedValueOnce([
      mkView(),
      mkView({ id: 2, route: '/charging', name: 'Superchargers' }),
    ]);

    const { result } = renderHook(() => useAllSavedViews(), {
      wrapper: makeWrapper(newClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(mockedRequest).toHaveBeenCalledWith(
      '/saved-views',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('coerces a malformed payload to an empty collection', async () => {
    mockedRequest.mockResolvedValueOnce({ bad: true } as unknown as SavedView[]);
    const { result } = renderHook(() => useAllSavedViews(), {
      wrapper: makeWrapper(newClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// useCreateSavedView
// ---------------------------------------------------------------------------

describe('useCreateSavedView', () => {
  it('POSTs /saved-views with the JSON body and returns the created row', async () => {
    const created = mkView({ id: 42, route: '/drives', name: 'Fresh' });
    mockedRequest.mockResolvedValueOnce(created);

    const { result } = renderHook(() => useCreateSavedView(), {
      wrapper: makeWrapper(newClient()),
    });

    const input = { name: 'Fresh', route: '/drives', query: 'sort=distance' };
    const row = await result.current.mutateAsync(input);
    expect(row.id).toBe(42);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/saved-views');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual(input);
  });

  it('invalidates the list for the CREATED row\'s route and toasts success', async () => {
    const created = mkView({ id: 42, route: '/charging' });
    mockedRequest.mockResolvedValueOnce(created);

    const { result } = renderHook(() => useCreateSavedView(), {
      wrapper: makeWrapper(newClient()),
    });

    await result.current.mutateAsync({ name: 'x', route: '/charging', query: '' });

    expect(mockedInvalidate).toHaveBeenCalledWith(
      expect.anything(),
      { queryKey: ['saved-views'] },
    );
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('toast.savedViews.create.success');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('routes a failure to the error toast (with the underlying message) and skips invalidation', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('duplicate name'));

    const { result } = renderHook(() => useCreateSavedView(), {
      wrapper: makeWrapper(newClient()),
    });

    await expect(
      result.current.mutateAsync({ name: 'dup', route: '/drives', query: '' }),
    ).rejects.toThrow('duplicate name');

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith('toast.savedViews.create.error', 'duplicate name');
    expect(mockedInvalidate).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useUpdateSavedView
// ---------------------------------------------------------------------------

describe('useUpdateSavedView', () => {
  it('PUTs /saved-views/{id} with the patch and invalidates the vars.route key (not the row route)', async () => {
    // Server echoes a row whose route differs from vars.route to prove the
    // hook keys invalidation off the caller-supplied route, never the payload.
    mockedRequest.mockResolvedValueOnce(mkView({ id: 5, route: '/drives' }));

    const { result } = renderHook(() => useUpdateSavedView(), {
      wrapper: makeWrapper(newClient()),
    });

    const args: UpdateSavedViewArgs = {
      id: 5,
      route: '/charging',
      patch: { name: 'renamed', is_pinned: true },
    };
    await result.current.mutateAsync(args);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/saved-views/5');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body as string)).toEqual({ name: 'renamed', is_pinned: true });

    expect(mockedInvalidate).toHaveBeenCalledWith(
      expect.anything(),
      { queryKey: ['saved-views'] },
    );
    expect(toastSuccess).toHaveBeenCalledWith('toast.savedViews.update.success');
  });

  it('surfaces update failures via the error toast', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useUpdateSavedView(), {
      wrapper: makeWrapper(newClient()),
    });

    await expect(
      result.current.mutateAsync({ id: 1, route: '/drives', patch: { name: 'x' } }),
    ).rejects.toThrow('nope');
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('toast.savedViews.update.error', 'nope'));
  });
});

// ---------------------------------------------------------------------------
// useDeleteSavedView (optimistic)
// ---------------------------------------------------------------------------

describe('useDeleteSavedView', () => {
  it('DELETEs /saved-views/{id} and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useDeleteSavedView(), {
      wrapper: makeWrapper(newClient()),
    });

    const args: DeleteSavedViewArgs = { id: 7, route: '/drives' };
    await result.current.mutateAsync(args);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/saved-views/7');
    expect(opts.method).toBe('DELETE');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('toast.savedViews.delete.success'));
  });

  it('optimistically removes the row from the cached list before the server responds', async () => {
    const client = newClient();
    const viewA = mkView({ id: 1, name: 'A' });
    const viewB = mkView({ id: 2, name: 'B' });
    client.setQueryData(savedViewsKeys.list('/drives'), [viewA, viewB]);

    let resolveReq: (() => void) | null = null;
    mockedRequest.mockImplementationOnce(
      () => new Promise<void>((res) => { resolveReq = () => res(); }),
    );

    const { result } = renderHook(() => useDeleteSavedView(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      result.current.mutate({ id: 1, route: '/drives' });
    });

    // The row is gone from the menu the instant the user confirms — before the
    // DELETE settles.
    await waitFor(() => {
      const cur = client.getQueryData<SavedView[]>(savedViewsKeys.list('/drives'));
      expect(cur).toEqual([viewB]);
    });

    act(() => resolveReq?.());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls the optimistic removal back when the DELETE fails', async () => {
    const client = newClient();
    const viewA = mkView({ id: 1, name: 'A' });
    const viewB = mkView({ id: 2, name: 'B' });
    client.setQueryData(savedViewsKeys.list('/drives'), [viewA, viewB]);

    mockedRequest.mockRejectedValueOnce(new Error('server down'));

    const { result } = renderHook(() => useDeleteSavedView(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 1, route: '/drives' });
      } catch {
        /* expected */
      }
    });

    expect(client.getQueryData<SavedView[]>(savedViewsKeys.list('/drives'))).toEqual([viewA, viewB]);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('toast.savedViews.delete.error', 'server down'));
  });
});

// ---------------------------------------------------------------------------
// useSetDefaultSavedView
// ---------------------------------------------------------------------------

describe('useSetDefaultSavedView', () => {
  it('PUTs {is_default:true} and picks the set-default toast when enabling', async () => {
    mockedRequest.mockResolvedValueOnce(mkView({ id: 9, is_default: true }));

    const { result } = renderHook(() => useSetDefaultSavedView(), {
      wrapper: makeWrapper(newClient()),
    });

    const args: SetDefaultSavedViewArgs = { id: 9, route: '/drives', isDefault: true };
    await result.current.mutateAsync(args);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/saved-views/9');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body as string)).toEqual({ is_default: true });

    expect(mockedInvalidate).toHaveBeenCalledWith(
      expect.anything(),
      { queryKey: ['saved-views'] },
    );
    expect(toastSuccess).toHaveBeenCalledWith('toast.savedViews.setDefault.success');
  });

  it('PUTs {is_default:false} and picks the unset-default toast when clearing', async () => {
    mockedRequest.mockResolvedValueOnce(mkView({ id: 9, is_default: false }));

    const { result } = renderHook(() => useSetDefaultSavedView(), {
      wrapper: makeWrapper(newClient()),
    });

    await result.current.mutateAsync({ id: 9, route: '/drives', isDefault: false });

    expect(JSON.parse(mockedRequest.mock.calls[0][1].body as string)).toEqual({ is_default: false });
    expect(toastSuccess).toHaveBeenCalledWith('toast.savedViews.unsetDefault.success');
  });

  it('surfaces set-default failures via the error toast', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('conflict'));
    const { result } = renderHook(() => useSetDefaultSavedView(), {
      wrapper: makeWrapper(newClient()),
    });

    await expect(
      result.current.mutateAsync({ id: 1, route: '/drives', isDefault: true }),
    ).rejects.toThrow('conflict');
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('toast.savedViews.setDefault.error', 'conflict'),
    );
  });
});
