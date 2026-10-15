import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClientProvider, type QueryClient } from '@tanstack/react-query';

const { successToast, warningToast, errorToast, broadcast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  warningToast: vi.fn(),
  errorToast: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('@/lib/broadcast', () => ({ broadcast }));

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

import { apiUrl, request } from '@/api/client';
import { createQueryClient } from '@/api/queryClient';
import {
  __flushQueryBroadcastForTests,
  __resetQueryBroadcastForTests,
} from '@/lib/queryBroadcast';
import { OperationalModeWriteError } from '@/lib/operationalMode';
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
  const client = createQueryClient();
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
  broadcast.mockReset();
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
  __flushQueryBroadcastForTests();
  if (invalidated) {
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      type: 'queryInvalidate',
      keys: [exportKeys.jobs, exportKeys.all],
    });
  } else {
    expect(broadcast).not.toHaveBeenCalled();
  }
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
      requiresLiveMode: true,
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

describe('useBulkExportsDelete live-only request policy', () => {
  let originalUrl: string;
  let originalOnline: boolean;

  beforeEach(async () => {
    originalUrl = window.location.href;
    originalOnline = onlineManager.isOnline();
    const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
    vi.mocked(request).mockImplementation(actual.request);
    window.history.replaceState(null, '', '/exports');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    window.history.replaceState(null, '', originalUrl);
    onlineManager.setOnline(originalOnline);
    vi.restoreAllMocks();
  });

  it.each([
    { label: 'historical data', online: true, asOf: '2026-10-12T10:00:00Z', mode: 'as_of' },
    { label: 'offline data', online: false, asOf: null, mode: 'cached' },
    { label: 'historical data while offline', online: false, asOf: '2026-10-12T10:00:00Z', mode: 'as_of' },
  ] as const)('rejects $label before transport without retrying or queueing', async ({ online, asOf, mode }) => {
    window.history.replaceState(
      null, '', asOf ? `/exports?as_of=${encodeURIComponent(asOf)}` : '/exports',
    );
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    onlineManager.setOnline(online);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result, client } = setup();

    expect(client.getDefaultOptions().mutations).toMatchObject({
      retry: 0,
      networkMode: 'always',
    });
    await act(async () => {
      await expect(result.current.mutateAsync(ids)).rejects.toMatchObject({
        name: 'OperationalModeWriteError',
        code: 'OPERATIONAL_MODE_READ_ONLY',
        mode,
      });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(OperationalModeWriteError);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPaused).toBe(false);
    expect(result.current.failureCount).toBe(1);
    expect(request).toHaveBeenCalledExactlyOnceWith('/export/jobs/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, op: 'delete' }),
      requiresLiveMode: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledExactlyOnceWith(
      result.current.error, 'toast.export.bulkDelete.error', 'Failed to delete exports',
    );
    expect(successToast).not.toHaveBeenCalled();
    expect(warningToast).not.toHaveBeenCalled();
    expectRetainedCache(client, false);

    await act(async () => {
      window.history.replaceState(null, '', '/exports');
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
    });
    expect(result.current.isError).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expectRetainedCache(client, false);
  });

  it('preserves the live POST body, failed IDs, invalidation and broadcast', async () => {
    const response: ExportBulkResult = {
      deleted: 1,
      failed: [{ id: ids[1], reason: 'not_found' }],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const { result, client } = setup();

    await act(async () => {
      expect(await result.current.mutateAsync(ids)).toEqual(response);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
      apiUrl('/export/jobs/bulk'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids, op: 'delete' }),
      }),
    );
    const options = fetchSpy.mock.calls[0][1];
    expect(options).not.toHaveProperty('requiresLiveMode');
    expect(new Headers(options?.headers).get('Content-Type')).toBe('application/json');
    expect(result.current.data).toEqual(response);
    expect(warningToast).toHaveBeenCalledExactlyOnceWith(
      'toast.export.bulkDelete.error', 'Failed to delete exports',
    );
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
    expectRetainedCache(client, true);
  });
});
