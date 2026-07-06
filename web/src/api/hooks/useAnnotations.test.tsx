// Durable chart-annotation hook tests.
//
// Covers every export of `useAnnotations.ts`:
//   - annotationKeys        — stable root key + positional list key with the
//     'all'/'' sentinels and the vehicleId-0 vs fleet-wide distinction.
//   - useChartAnnotations   — GET /annotations, snake_case query building
//     (vehicle_id/scope/from/to), null-vs-zero vehicle handling, abort
//     signal threading, and error surfacing.
//   - useChartAnnotationsAsData — projection onto the DataAnnotation shape,
//     null-safe empty coercion, empty-scope/null-description mapping, the
//     new loading/error passthrough, and useMemo reference stability.
//   - useCreateAnnotation / useUpdateAnnotation / useDeleteAnnotation —
//     verb + URL + body contract, cache invalidation on success, and the
//     success/error toast wiring on both the happy and failure paths.
//
// Network is faked at the `request` boundary; the toast bridge and the
// cross-tab invalidation helper are mocked so the mutation side effects
// can be asserted precisely without a real Toast/BroadcastChannel.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { requestMock, toastSuccess, toastError, invalidateAndBroadcastMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidateAndBroadcastMock: vi.fn(),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: requestMock };
});

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock('@/lib/queryBroadcast', () => ({
  invalidateAndBroadcast: invalidateAndBroadcastMock,
}));

import {
  annotationKeys,
  useChartAnnotations,
  useChartAnnotationsAsData,
  useCreateAnnotation,
  useUpdateAnnotation,
  useDeleteAnnotation,
  type CreateAnnotationInput,
  type UpdateAnnotationInput,
} from './useAnnotations';
import type { ChartAnnotationRow } from '@/types/annotations';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const row: ChartAnnotationRow = {
  id: 42,
  user_id: 3,
  vehicle_id: 7,
  occurred_at: '2025-03-01T12:00:00Z',
  category: 'maintenance',
  title: 'Tire rotation',
  description: 'Rotated all four',
  scope: ['tire', 'efficiency'],
  color: '#f59e0b',
  created_at: '2025-03-01T12:05:00Z',
  updated_at: '2025-03-01T12:05:00Z',
};

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  invalidateAndBroadcastMock.mockReset();
});

describe('annotationKeys', () => {
  it('exposes a stable root key that list keys are prefixed with', () => {
    expect(annotationKeys.all).toEqual(['annotations']);
    expect(annotationKeys.list({}).slice(0, 1)).toEqual(annotationKeys.all);
  });

  it('builds a positional list key from every param', () => {
    expect(
      annotationKeys.list({ vehicleId: 7, scope: 'cost', from: '2025-01-01', to: '2025-02-01' }),
    ).toEqual(['annotations', 7, 'cost', '2025-01-01', '2025-02-01']);
  });

  it("collapses null/undefined vehicleId + scope to 'all' and blanks the time window", () => {
    expect(annotationKeys.list({})).toEqual(['annotations', 'all', 'all', '', '']);
    expect(annotationKeys.list({ vehicleId: null })).toEqual(['annotations', 'all', 'all', '', '']);
  });

  it('keeps vehicleId 0 distinct from the fleet-wide sentinel', () => {
    expect(annotationKeys.list({ vehicleId: 0 })).toEqual(['annotations', 0, 'all', '', '']);
  });
});

describe('useChartAnnotations', () => {
  it('GETs /annotations with no query string and threads the abort signal', async () => {
    requestMock.mockResolvedValueOnce([row]);
    const { result } = renderHook(() => useChartAnnotations(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [url, opts] = requestMock.mock.calls[0] as [string, { signal?: unknown }];
    expect(url).toBe('/annotations');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data).toEqual([row]);
  });

  it('encodes vehicle_id (snake_case), scope, from and to into the query string', async () => {
    requestMock.mockResolvedValueOnce([]);
    const { result } = renderHook(
      () =>
        useChartAnnotations({
          vehicleId: 7,
          scope: 'cost',
          from: '2025-01-01T00:00:00Z',
          to: '2025-02-01T00:00:00Z',
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = requestMock.mock.calls[0][0] as string;
    expect(url.startsWith('/annotations?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('vehicle_id')).toBe('7');
    expect(params.get('scope')).toBe('cost');
    expect(params.get('from')).toBe('2025-01-01T00:00:00Z');
    expect(params.get('to')).toBe('2025-02-01T00:00:00Z');
  });

  it('omits vehicle_id when null but keeps an explicit zero id', async () => {
    requestMock.mockResolvedValue([]);

    const { result: nullResult } = renderHook(() => useChartAnnotations({ vehicleId: null }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(nullResult.current.isSuccess).toBe(true));
    expect(requestMock.mock.calls[0][0]).toBe('/annotations');

    requestMock.mockClear();

    const { result: zeroResult } = renderHook(() => useChartAnnotations({ vehicleId: 0 }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(zeroResult.current.isSuccess).toBe(true));
    expect(requestMock.mock.calls[0][0]).toBe('/annotations?vehicle_id=0');
  });

  it('surfaces request failures as isError', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useChartAnnotations(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeUndefined();
  });
});

describe('useChartAnnotationsAsData', () => {
  it('projects backend rows onto the DataAnnotation chart shape', async () => {
    requestMock.mockResolvedValueOnce([row]);
    const { result } = renderHook(() => useChartAnnotationsAsData(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.annotations).toHaveLength(1));
    expect(result.current.annotations[0]).toEqual({
      id: '42',
      timestamp: '2025-03-01T12:00:00Z',
      label: 'Tire rotation',
      description: 'Rotated all four',
      category: 'maintenance',
      context: 'tire',
      vehicleId: 7,
      createdAt: '2025-03-01T12:05:00Z',
    });
    expect(result.current.isError).toBe(false);
  });

  it('coerces a missing payload to an empty list instead of crashing', async () => {
    requestMock.mockResolvedValueOnce(null as unknown as ChartAnnotationRow[]);
    const { result } = renderHook(() => useChartAnnotationsAsData(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.annotations).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('maps an empty scope to a blank context and a null description to undefined', async () => {
    const bare: ChartAnnotationRow = { ...row, id: 5, scope: [], description: null };
    requestMock.mockResolvedValueOnce([bare]);
    const { result } = renderHook(() => useChartAnnotationsAsData(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.annotations).toHaveLength(1));
    expect(result.current.annotations[0].context).toBe('');
    expect(result.current.annotations[0].description).toBeUndefined();
    expect(result.current.annotations[0].id).toBe('5');
  });

  it('passes through the error state while keeping the list null-safe', async () => {
    requestMock.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useChartAnnotationsAsData(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.annotations).toEqual([]);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('memoises the projected array across re-renders while data is unchanged', async () => {
    requestMock.mockResolvedValueOnce([row]);
    const { result, rerender } = renderHook(() => useChartAnnotationsAsData(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.annotations).toHaveLength(1));
    const first = result.current.annotations;
    rerender();
    expect(result.current.annotations).toBe(first);
  });
});

const createInput: CreateAnnotationInput = {
  vehicle_id: 7,
  occurred_at: '2025-03-01T12:00:00Z',
  category: 'maintenance',
  title: 'Tire rotation',
  description: 'Rotated all four',
  scope: ['tire'],
  color: '#f59e0b',
};

describe('useCreateAnnotation', () => {
  it('POSTs the input to /annotations and returns the created row', async () => {
    requestMock.mockResolvedValueOnce(row);
    const { result } = renderHook(() => useCreateAnnotation(), { wrapper: makeWrapper() });

    let created: ChartAnnotationRow | undefined;
    await act(async () => {
      created = await result.current.mutateAsync(createInput);
    });

    expect(created?.id).toBe(42);
    const [url, opts] = requestMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('/annotations');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual(createInput);
  });

  it('invalidates the annotation cache and fires a success toast', async () => {
    requestMock.mockResolvedValueOnce(row);
    const { result } = renderHook(() => useCreateAnnotation(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync(createInput);
    });

    expect(invalidateAndBroadcastMock).toHaveBeenCalledWith(expect.anything(), {
      queryKey: annotationKeys.all,
    });
    expect(toastSuccess).toHaveBeenCalledWith('toast.annotation.created.success', 'Annotation added');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('fires an error toast and skips invalidation when the create fails', async () => {
    const err = new Error('server down');
    requestMock.mockRejectedValueOnce(err);
    const { result } = renderHook(() => useCreateAnnotation(), { wrapper: makeWrapper() });

    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync(createInput).catch((e) => e);
    });

    expect(caught).toBe(err);
    expect(toastError).toHaveBeenCalledWith(
      err,
      'toast.annotation.created.error',
      'Failed to add annotation',
    );
    expect(invalidateAndBroadcastMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

const updateInput: UpdateAnnotationInput = {
  id: 42,
  title: 'Tire rotation (front)',
  scope: ['tire'],
  clear_color: true,
};

describe('useUpdateAnnotation', () => {
  it('PATCHes /annotations/{id} with a body that excludes the id', async () => {
    requestMock.mockResolvedValueOnce({ ...row, title: 'Tire rotation (front)' });
    const { result } = renderHook(() => useUpdateAnnotation(), { wrapper: makeWrapper() });

    let updated: ChartAnnotationRow | undefined;
    await act(async () => {
      updated = await result.current.mutateAsync(updateInput);
    });

    expect(updated?.title).toBe('Tire rotation (front)');
    const [url, opts] = requestMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('/annotations/42');
    expect(opts.method).toBe('PATCH');
    const body = JSON.parse(opts.body);
    expect(body).not.toHaveProperty('id');
    expect(body).toEqual({ title: 'Tire rotation (front)', scope: ['tire'], clear_color: true });
  });

  it('invalidates and toasts success on update', async () => {
    requestMock.mockResolvedValueOnce(row);
    const { result } = renderHook(() => useUpdateAnnotation(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync(updateInput);
    });

    expect(invalidateAndBroadcastMock).toHaveBeenCalledWith(expect.anything(), {
      queryKey: annotationKeys.all,
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'toast.annotation.updated.success',
      'Annotation updated',
    );
  });

  it('toasts an error when the update fails', async () => {
    const err = new Error('conflict');
    requestMock.mockRejectedValueOnce(err);
    const { result } = renderHook(() => useUpdateAnnotation(), { wrapper: makeWrapper() });

    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync(updateInput).catch((e) => e);
    });

    expect(caught).toBe(err);
    expect(toastError).toHaveBeenCalledWith(
      err,
      'toast.annotation.updated.error',
      'Failed to update annotation',
    );
  });
});

describe('useDeleteAnnotation', () => {
  it('DELETEs /annotations/{id}', async () => {
    requestMock.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useDeleteAnnotation(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync(42);
    });

    const [url, opts] = requestMock.mock.calls[0] as [string, { method: string }];
    expect(url).toBe('/annotations/42');
    expect(opts.method).toBe('DELETE');
  });

  it('invalidates and toasts success on delete', async () => {
    requestMock.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useDeleteAnnotation(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync(42);
    });

    expect(invalidateAndBroadcastMock).toHaveBeenCalledWith(expect.anything(), {
      queryKey: annotationKeys.all,
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'toast.annotation.deleted.success',
      'Annotation removed',
    );
  });

  it('toasts an error when the delete fails', async () => {
    const err = new Error('not found');
    requestMock.mockRejectedValueOnce(err);
    const { result } = renderHook(() => useDeleteAnnotation(), { wrapper: makeWrapper() });

    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync(42).catch((e) => e);
    });

    expect(caught).toBe(err);
    expect(toastError).toHaveBeenCalledWith(
      err,
      'toast.annotation.deleted.error',
      'Failed to remove annotation',
    );
  });
});
