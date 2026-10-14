import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { STALE_TIMES } from '@/lib/constants';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';
import { operatorConfidenceKeys, useGDPRExport } from './useOperatorConfidence';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('@/api/client', () => ({ request: requestMock }));

// Synthetic values only; the keys are the actual Go Artifact JSON tags.
const manifest = {
  id: 'artifact-a',
  export_job_id: 'job-a',
  vehicle_id: 7,
  storage_kind: 'local_fs',
  storage_path: '/synthetic/artifact-a.tar.gz',
  sha256: 'a'.repeat(64),
  byte_count: 0,
  created_at: '2026-10-01T00:00:00Z',
  expires_at: '2026-10-15T00:00:00Z',
  download_count: 0,
} satisfies GDPRExportArtifact;

interface ActualManifest {
  id: string;
  export_job_id: string;
  vehicle_id: number;
  storage_kind: string;
  storage_path: string;
  sha256: string;
  byte_count: number;
  created_at: string;
  expires_at: string;
  downloaded_at?: string | null;
  download_count: number;
}

const clients: QueryClient[] = [];

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  clients.push(client);
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}

beforeEach(() => requestMock.mockReset());
afterEach(() => {
  cleanup();
  clients.forEach(client => client.clear());
  clients.length = 0;
});

describe('GDPR manifest contract', () => {
  it('pins the exact manifest DTO and single argument hook API', () => {
    expectTypeOf<GDPRExportArtifact>().toEqualTypeOf<ActualManifest>();
    expectTypeOf(useGDPRExport).parameters.toEqualTypeOf<[id: string | null]>();
    expectTypeOf<ReturnType<typeof useGDPRExport>['data']>()
      .toEqualTypeOf<GDPRExportArtifact | undefined>();
    expect(Object.keys(manifest).sort()).toEqual([
      'byte_count', 'created_at', 'download_count', 'expires_at', 'export_job_id',
      'id', 'sha256', 'storage_kind', 'storage_path', 'vehicle_id',
    ]);
  });

  it('unwraps canonical wire fields without fabricating lifecycle values', async () => {
    requestMock.mockResolvedValue({ data: manifest });
    const { result } = renderHook(() => useGDPRExport(manifest.id), setup());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(manifest);
    expect(result.current.data?.byte_count).toBe(0);
    expect(result.current.data?.export_job_id).toBe('job-a');
    expect(result.current.data?.vehicle_id).toBe(7);
    expect(result.current.data?.storage_kind).toBe('local_fs');
    expect(result.current.data?.sha256).toBe('a'.repeat(64));
    for (const key of ['status', 'bytes', 'storage', 'user_id', 'format', 'completed_at', 'error']) {
      expect(result.current.data).not.toHaveProperty(key);
    }
    expect(requestMock).toHaveBeenCalledWith('/admin/gdpr/exports/artifact-a', {
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    { label: 'omitted', payload: manifest },
    { label: 'null', payload: { ...manifest, downloaded_at: null } },
    { label: 'timestamp', payload: { ...manifest, downloaded_at: '2026-10-02T00:00:00Z' } },
  ])('preserves $label download timestamps', async ({ payload }) => {
    const typed: GDPRExportArtifact = payload;
    requestMock.mockResolvedValue({ data: typed });
    const { result } = renderHook(() => useGDPRExport(manifest.id), setup());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(Object.prototype.hasOwnProperty.call(result.current.data ?? {}, 'downloaded_at'))
      .toBe(Object.prototype.hasOwnProperty.call(payload, 'downloaded_at'));
    expect(result.current.data?.download_count).toBe(0);
  });

  it.each([
    { label: 's3', kind: 's3' },
    { label: 'unknown', kind: 'future_archive' },
  ])('retains $label storage kind and producer extension fields', async ({ kind }) => {
    const payload = {
      ...manifest, storage_kind: kind, byte_count: 987654,
      producer_extension: { nullable: null, raw: 0 },
    } satisfies GDPRExportArtifact & { producer_extension: unknown };
    requestMock.mockResolvedValue({ data: payload });
    const { result } = renderHook(() => useGDPRExport(manifest.id), setup());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(result.current.data?.storage_kind).toBe(kind);
    expect(result.current.data?.byte_count).toBe(987654);
    expect(result.current.data).toHaveProperty('producer_extension', { nullable: null, raw: 0 });
    expect(result.current.data).not.toHaveProperty('download_url');
  });

  it('preserves the existing flat response fallback without a legacy field adapter', async () => {
    requestMock.mockResolvedValue(manifest);
    const { result } = renderHook(() => useGDPRExport(manifest.id), setup());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(manifest);
    expect(result.current.data?.byte_count).toBe(0);
    expect(result.current.data).not.toHaveProperty('bytes');
  });

  it.each([
    { label: 'reserved', id: 'qa?marker=1#suffix/part&more', encoded: 'qa%3Fmarker%3D1%23suffix%2Fpart%26more' },
    { label: 'space-percent', id: ' qa 100% ', encoded: '%20qa%20100%25%20' },
    { label: 'unicode', id: 'qa-车', encoded: 'qa-%E8%BD%A6' },
  ])('encodes the $label editable id as exactly one path segment', async ({ id, encoded }) => {
    requestMock.mockResolvedValue({ data: { ...manifest, id } });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useGDPRExport(id), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock.mock.calls[0][0]).toBe(`/admin/gdpr/exports/${encoded}`);
    expect(client.getQueryCache().getAll().map(query => query.queryKey))
      .toEqual([['admin', 'gdpr', 'exports', id]]);
    expect(result.current.data?.id).toBe(id);
  });

  it.each([
    { label: 'null', id: null },
    { label: 'empty', id: '' },
    { label: 'blank', id: ' \t ' },
  ])('keeps $label no-id queries idle and blocks manual refetch', async ({ id }) => {
    const { result } = renderHook(() => useGDPRExport(id), setup());
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestMock).not.toHaveBeenCalled();
    await act(async () => { await result.current.refetch(); });
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.isError).toBe(true);
    expect(result.current.error?.message).toBe('GDPR export artifact id is required');
  });

  it('keeps the no-id sentinel and raw id keys compatible', () => {
    const { client, wrapper } = setup();
    renderHook(() => useGDPRExport(null), { wrapper });
    expect(client.getQueryCache().getAll().map(query => query.queryKey))
      .toEqual([['admin', 'gdpr', 'exports', '__none__']]);
    expect(operatorConfidenceKeys.gdprExport('a/b?c'))
      .toEqual(['admin', 'gdpr', 'exports', 'a/b?c']);
    expect(operatorConfidenceKeys.schemaDrift).toEqual(['admin', 'observability', 'schema-drift']);
    expect(operatorConfidenceKeys.auditVerify(null, 1000))
      .toEqual(['admin', 'audit-log', 'verify', null, 1000]);
  });

  it('isolates cache entries when the selected id changes', async () => {
    const other = { ...manifest, id: 'artifact-b', export_job_id: 'job-b', byte_count: 42 };
    requestMock.mockResolvedValueOnce({ data: manifest }).mockResolvedValueOnce({ data: other });
    const { client, wrapper } = setup();
    const { result, rerender } = renderHook(({ id }) => useGDPRExport(id), {
      initialProps: { id: manifest.id }, wrapper,
    });
    await waitFor(() => expect(result.current.data?.id).toBe('artifact-a'));
    rerender({ id: 'artifact-b' });
    await waitFor(() => expect(result.current.data?.byte_count).toBe(42));
    expect(result.current.data?.export_job_id).toBe('job-b');
    expect(requestMock.mock.calls.map(call => call[0]))
      .toEqual(['/admin/gdpr/exports/artifact-a', '/admin/gdpr/exports/artifact-b']);
    expect(client.getQueryData(operatorConfidenceKeys.gdprExport('artifact-a'))).toEqual(manifest);
    expect(client.getQueryData(operatorConfidenceKeys.gdprExport('artifact-b'))).toEqual(other);
  });

  it('cancels the previous id request without replacing the new scope', async () => {
    let previousSignal: AbortSignal | undefined;
    requestMock.mockImplementationOnce((_path: string, options: { signal: AbortSignal }) => {
      previousSignal = options.signal;
      return new Promise<never>(() => {});
    }).mockResolvedValueOnce({ data: { ...manifest, id: 'artifact-b', byte_count: 23 } });
    const { result, rerender } = renderHook(({ id }) => useGDPRExport(id), {
      initialProps: { id: manifest.id }, ...setup(),
    });
    expect(previousSignal?.aborted).toBe(false);
    rerender({ id: 'artifact-b' });
    await waitFor(() => expect(result.current.data?.byte_count).toBe(23));
    expect(previousSignal?.aborted).toBe(true);
    expect(result.current.data?.id).toBe('artifact-b');
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('disables automatic manifest polling without changing retry or stale policy', async () => {
    requestMock.mockResolvedValue({ data: manifest });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useGDPRExport(manifest.id), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const options = client.getQueryCache().find({
      queryKey: operatorConfidenceKeys.gdprExport(manifest.id),
    })?.options;
    expect(options).toMatchObject({
      enabled: true, staleTime: STALE_TIMES.QUICK, retry: 1,
      refetchInterval: false, refetchIntervalInBackground: false,
    });
    expect(result.current.data?.byte_count).toBe(0);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('keeps explicit refresh available for completed manifests', async () => {
    const downloaded = {
      ...manifest, downloaded_at: '2026-10-02T00:00:00Z', download_count: 1,
    };
    requestMock.mockResolvedValueOnce({ data: manifest }).mockResolvedValueOnce({ data: downloaded });
    const { result } = renderHook(() => useGDPRExport(manifest.id), setup());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => { await result.current.refetch(); });
    expect(result.current.data).toEqual(downloaded);
    expect(result.current.data?.byte_count).toBe(0);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: 'not-found', status: 404, code: 'NOT_FOUND' },
    { label: 'not-configured', status: 503, code: 'GDPR_NOT_CONFIGURED' },
  ])('preserves actual $label capability errors and one retry', async ({ status, code }) => {
    const error = Object.assign(new Error(code), { status, code });
    requestMock.mockRejectedValue(error);
    const { result } = renderHook(() => useGDPRExport(manifest.id), setup());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
    expect(result.current.data).toBeUndefined();
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('retains metadata after refresh failure and recovers on explicit refetch', async () => {
    const error = Object.assign(new Error('temporary read failure'), { status: 500 });
    requestMock.mockResolvedValueOnce({ data: manifest });
    const { result } = renderHook(() => useGDPRExport(manifest.id), setup());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    requestMock.mockRejectedValue(error);
    await act(async () => { await result.current.refetch(); });
    expect(result.current.isRefetchError).toBe(true);
    expect(result.current.error).toBe(error);
    expect(result.current.data?.byte_count).toBe(0);
    expect(result.current.data?.sha256).toBe('a'.repeat(64));
    requestMock.mockResolvedValue({ data: { ...manifest, download_count: 2 } });
    await act(async () => { await result.current.refetch(); });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.download_count).toBe(2);
    expect(result.current.data?.storage_kind).toBe('local_fs');
    expect(requestMock).toHaveBeenCalledTimes(4);
  });
});
