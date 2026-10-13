import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { successToast, warningToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  warningToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({
    success: successToast,
    warning: warningToast,
    error: errorToast,
  }),
}));

import { request } from '@/api/client';
import { __resetQueryBroadcastForTests } from '@/lib/queryBroadcast';
import {
  exportKeys,
  useBulkExportsDelete,
  type ExportBulkResult,
  type ExportJobSummary,
} from './useExports';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const retainedJobs: ExportJobSummary[] = ids.map((id) => ({
  id,
  type: 'drives',
  format: 'csv',
  status: 'ready',
  created_at: '2026-10-12T10:00:00Z',
}));
const clients: QueryClient[] = [];

function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  client.setQueryData(exportKeys.jobs, retainedJobs);
  client.setQueryData(exportKeys.all, retainedJobs);
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return { ...renderHook(() => useBulkExportsDelete(), { wrapper }), client };
}

beforeEach(() => {
  vi.mocked(request).mockReset();
  successToast.mockReset();
  warningToast.mockReset();
  errorToast.mockReset();
});

afterEach(() => {
  __resetQueryBroadcastForTests();
  clients.splice(0).forEach((client) => client.clear());
});

function expectRetainedCache(client: QueryClient, invalidated: boolean) {
  expect(client.getQueryData(exportKeys.jobs)).toEqual(retainedJobs);
  expect(client.getQueryData(exportKeys.all)).toEqual(retainedJobs);
  expect(client.getQueryState(exportKeys.jobs)?.isInvalidated).toBe(invalidated);
  expect(client.getQueryState(exportKeys.all)?.isInvalidated).toBe(invalidated);
}

describe('useBulkExportsDelete outcome notifications', () => {
  it('warns on partial deletion and returns exact failed IDs and deleted count', async () => {
    const response: ExportBulkResult = {
      deleted: 1,
      failed: [{ id: ids[1], reason: 'not_found' }],
    };
    vi.mocked(request).mockResolvedValueOnce(response);
    const { result, client } = setup();
    await act(async () => {
      expect(await result.current.mutateAsync(ids)).toBe(response);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      deleted: 1,
      failed: [{ id: ids[1], reason: 'not_found' }],
    });
    expect(request).toHaveBeenCalledExactlyOnceWith('/export/jobs/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, op: 'delete' }),
    });
    expect(warningToast).toHaveBeenCalledExactlyOnceWith(
      'toast.export.bulkDelete.error', 'Failed to delete exports',
    );
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
    expectRetainedCache(client, true);
  });

  it('announces complete success only when the server reports no failed IDs', async () => {
    const response: ExportBulkResult = { deleted: 2, failed: [] };
    vi.mocked(request).mockResolvedValueOnce(response);
    const { result, client } = setup();
    await act(async () => {
      expect(await result.current.mutateAsync(ids)).toBe(response);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ deleted: 2, failed: [] });
    expect(successToast).toHaveBeenCalledExactlyOnceWith(
      'toast.export.bulkDelete.success', 'Exports deleted',
    );
    expect(warningToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
    expectRetainedCache(client, true);
  });

  it('does not invent successes when every requested deletion fails', async () => {
    const response: ExportBulkResult = {
      deleted: 0,
      failed: ids.map((id) => ({ id, reason: 'not_found' })),
    };
    vi.mocked(request).mockResolvedValueOnce(response);
    const { result, client } = setup();
    await act(async () => {
      expect(await result.current.mutateAsync(ids)).toBe(response);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      deleted: 0,
      failed: [
        { id: ids[0], reason: 'not_found' },
        { id: ids[1], reason: 'not_found' },
      ],
    });
    expect(warningToast).toHaveBeenCalledExactlyOnceWith(
      'toast.export.bulkDelete.error', 'Failed to delete exports',
    );
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
    expectRetainedCache(client, true);
  });

  it('preserves request rejection and retained jobs without success invalidation', async () => {
    const failure = new Error('Failed to bulk delete exports');
    vi.mocked(request).mockRejectedValueOnce(failure);
    const { result, client } = setup();
    await act(async () => {
      await expect(result.current.mutateAsync(ids)).rejects.toBe(failure);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
    expect(errorToast).toHaveBeenCalledExactlyOnceWith(
      failure, 'toast.export.bulkDelete.error', 'Failed to delete exports',
    );
    expect(successToast).not.toHaveBeenCalled();
    expect(warningToast).not.toHaveBeenCalled();
    expectRetainedCache(client, false);
  });

  it('retains cached jobs and emits no completion feedback while deletion is pending', async () => {
    let resolve!: (response: ExportBulkResult) => void;
    vi.mocked(request).mockReturnValueOnce(new Promise<ExportBulkResult>((done) => {
      resolve = done;
    }));
    const { result, client } = setup();
    let pending!: Promise<ExportBulkResult>;
    await act(async () => {
      pending = result.current.mutateAsync(ids);
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));

    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(successToast).not.toHaveBeenCalled();
    expect(warningToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
    expectRetainedCache(client, false);

    const response: ExportBulkResult = { deleted: 2, failed: [] };
    await act(async () => {
      resolve(response);
      expect(await pending).toBe(response);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isSuccess).toBe(true);
    expect(successToast).toHaveBeenCalledExactlyOnceWith(
      'toast.export.bulkDelete.success', 'Exports deleted',
    );
    expectRetainedCache(client, true);
  });
});
