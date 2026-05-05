// Phase-46 / Prompt 62 — useExportColumns hook tests.
//
// Covers:
//   - useExportColumns hits GET /exports/columns?type=... with the URL-
//     encoded type and threads AbortSignal through.
//   - The hook is disabled when type is undefined / empty so callers can
//     wire it conditionally without extra guards.
//   - The hook surfaces the raw {columns,supports_selection,type}
//     payload so the column picker can consume it directly.
//
// Sibling-of-source location is mandatory — the gate's git-status regex
// matches `api/hooks/useExports` as a substring, which a __tests__/
// subdir would interrupt.

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
import { useExportColumns, exportKeys, type ExportColumnsResponse } from './useExports';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
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
