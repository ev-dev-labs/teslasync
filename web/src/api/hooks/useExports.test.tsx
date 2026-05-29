// useExportColumns hook tests.
//
// Covers:
//   - useExportColumns hits GET /exports/columns?type=... with the URL-
//     encoded type and threads AbortSignal through.
//   - The hook is disabled when type is undefined / empty so callers can
//     wire it conditionally without extra guards.
//   - The hook surfaces the raw {columns,supports_selection,type}
//     payload so the column picker can consume it directly.
//
// Keep this test next to the hook because path-scoped checks match
// `api/hooks/useExports` as a contiguous substring.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import {
  useExportColumns,
  exportKeys,
  type ExportColumnsResponse,
  useScheduledExports,
  useCreateScheduledExport,
  useUpdateScheduledExport,
  useDeleteScheduledExport,
  useRunScheduledExportNow,
  type ScheduledExport,
  type ScheduledExportInput,
} from './useExports';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const drivesPayload: ExportColumnsResponse = {
  type: 'drives',
  supports_selection: true,
  columns: [
    { name: 'id', label: 'ID', always_included: true },
    { name: 'vehicle_id', label: 'Vehicle ID', always_included: true },
    { name: 'start_date', label: 'Start date', always_included: false },
    { name: 'end_date', label: 'End date', always_included: false },
  ],
};

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('exportKeys.columns', () => {
  it('produces a stable per-type key tuple', () => {
    expect(exportKeys.columns('drives')).toEqual(['export-columns', 'drives']);
    expect(exportKeys.columns('charging')).toEqual(['export-columns', 'charging']);
  });
});

describe('useExportColumns', () => {
  it('fetches the catalog for the given type', async () => {
    mockedRequest.mockResolvedValueOnce(drivesPayload);
    const { result } = renderHook(() => useExportColumns('drives'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.type).toBe('drives');
    expect(result.current.data?.supports_selection).toBe(true);
    expect(result.current.data?.columns).toHaveLength(4);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/exports/columns?type=drives');
    // resilience.ts pattern: AbortSignal threaded through so React Query
    // can cancel an in-flight catalog fetch when the user navigates away.
    expect(opts).toHaveProperty('signal');
  });

  it('URL-encodes the type parameter', async () => {
    mockedRequest.mockResolvedValueOnce({
      type: 'weird type',
      supports_selection: false,
      columns: [],
    });
    renderHook(() => useExportColumns('weird type'), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe('/exports/columns?type=weird%20type');
  });

  it('is disabled when type is undefined', async () => {
    const { result } = renderHook(() => useExportColumns(undefined), { wrapper });
    // Wait a tick — the hook should not fire when disabled.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when type is the empty string', async () => {
    renderHook(() => useExportColumns(''), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('surfaces request errors as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useExportColumns('drives'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Scheduled exports hook coverage
// ---------------------------------------------------------------------------

const sampleSchedule: ScheduledExport = {
  id: 7,
  owner_subject: 'alice',
  name: 'Drives weekly',
  export_type: 'drives',
  format: 'csv',
  vehicle_id: null,
  columns: null,
  schedule_cron: '0 9 * * 0',
  delivery: { kind: 'download' },
  range_window: '7d',
  enabled: true,
  last_run_at: null,
  last_status: null,
  last_error: null,
  next_run_at: '2025-06-22T09:00:00Z',
  created_at: '2025-06-15T12:00:00Z',
  updated_at: '2025-06-15T12:00:00Z',
};

const validInput: ScheduledExportInput = {
  name: 'Drives weekly',
  export_type: 'drives',
  format: 'csv',
  schedule_cron: '0 9 * * 0',
  delivery: { kind: 'download' },
  range_window: '7d',
};

describe('exportKeys.scheduled', () => {
  it('produces a stable identity-free key tuple', () => {
    expect(exportKeys.scheduled).toEqual(['scheduled-exports']);
  });
});

describe('useScheduledExports', () => {
  it('GETs /scheduled-exports and surfaces the array', async () => {
    mockedRequest.mockResolvedValueOnce([sampleSchedule]);
    const { result } = renderHook(() => useScheduledExports(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/scheduled-exports');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe(7);
  });

  it('coerces a missing payload to an empty array via safeArray', async () => {
    mockedRequest.mockResolvedValueOnce(null as unknown as ScheduledExport[]);
    const { result } = renderHook(() => useScheduledExports(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useCreateScheduledExport', () => {
  it('POSTs the payload and surfaces the created row', async () => {
    mockedRequest.mockResolvedValueOnce(sampleSchedule);
    const { result } = renderHook(() => useCreateScheduledExport(), { wrapper });
    const created = await result.current.mutateAsync(validInput);
    expect(created.id).toBe(7);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/scheduled-exports');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual(validInput);
  });

  it('does NOT include owner_subject in the request body', async () => {
    mockedRequest.mockResolvedValueOnce(sampleSchedule);
    const { result } = renderHook(() => useCreateScheduledExport(), { wrapper });
    // Even if a caller sneaks owner_subject into the input, the
    // ScheduledExportInput type does not declare it. Behavioural check:
    // pass a plain payload and confirm the serialised body has no
    // owner_subject key.
    await result.current.mutateAsync(validInput);
    const body = JSON.parse(
      (mockedRequest.mock.calls[0][1] as { body: string }).body,
    );
    expect(body).not.toHaveProperty('owner_subject');
  });
});

describe('useUpdateScheduledExport', () => {
  it('PUTs to /scheduled-exports/{id}', async () => {
    mockedRequest.mockResolvedValueOnce({ ...sampleSchedule, name: 'renamed' });
    const { result } = renderHook(() => useUpdateScheduledExport(), { wrapper });
    const updated = await result.current.mutateAsync({
      id: 7,
      payload: { ...validInput, name: 'renamed' },
    });
    expect(updated.name).toBe('renamed');
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/scheduled-exports/7');
    expect(opts.method).toBe('PUT');
  });
});

describe('useDeleteScheduledExport', () => {
  it('DELETEs /scheduled-exports/{id}', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useDeleteScheduledExport(), { wrapper });
    await result.current.mutateAsync(7);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/scheduled-exports/7');
    expect(opts.method).toBe('DELETE');
  });
});

describe('useRunScheduledExportNow', () => {
  it('POSTs /scheduled-exports/{id}/run and returns the updated row', async () => {
    mockedRequest.mockResolvedValueOnce({
      ...sampleSchedule,
      next_run_at: '2025-06-15T12:00:00Z',
    });
    const { result } = renderHook(() => useRunScheduledExportNow(), { wrapper });
    const row = await result.current.mutateAsync(7);
    expect(row.next_run_at).toBe('2025-06-15T12:00:00Z');
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/scheduled-exports/7/run');
    expect(opts.method).toBe('POST');
  });
});
