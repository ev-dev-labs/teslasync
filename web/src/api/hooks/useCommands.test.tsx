// useCommands hook tests.
//
// Covers every export of `./useCommands`:
//   - CommandLogEntry            — the command-log row shape.
//   - commandKeys.{history,latest} — stable, number/string-agnostic query
//     keys so an invalidation issued with a numeric `vehicle.id` still hits
//     a query that was primed with the string route param (and vice versa).
//   - useCommandHistory          — GET /vehicles/{id}/commands/history?limit=200
//   - useCommandLatest           — GET /vehicles/{id}/commands/latest
//
// The hooks are pure query wrappers, so the contract under test is: the
// exact request path (URL-encoded id + threaded AbortSignal), the enabled
// guard (no request when the id is missing/empty), and the `select`
// null-coalesce that guarantees callers always receive an array.
//
// Network is mocked at the `@/api/client` boundary — the same convention the
// sibling useExports / useNotificationChannels tests use — so nothing here
// touches a real endpoint.

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
import {
  useCommandHistory,
  useCommandLatest,
  commandKeys,
  type CommandLogEntry,
} from './useCommands';

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

const sampleEntry: CommandLogEntry = {
  id: 11,
  vehicle_id: 3,
  command: 'honk_horn',
  params: '{}',
  status: 'success',
  error: '',
  created_at: '2025-06-01T12:00:00Z',
};

const latestEntries: CommandLogEntry[] = [
  { ...sampleEntry, id: 21, command: 'flash_lights', status: 'success' },
  { ...sampleEntry, id: 22, command: 'set_temps', status: 'failed', error: 'vehicle asleep' },
];

beforeEach(() => {
  mockedRequest.mockReset();
});

// ---------------------------------------------------------------------------
// CommandLogEntry — exported row shape
// ---------------------------------------------------------------------------

describe('CommandLogEntry', () => {
  it('describes a full command-log row', () => {
    // Constructing a value of the exported type both type-checks the
    // interface (via tsc in the gate) and asserts its runtime shape.
    expect(sampleEntry.command).toBe('honk_horn');
    expect(sampleEntry.vehicle_id).toBe(3);
    expect(sampleEntry.status).toBe('success');
    expect(sampleEntry.error).toBe('');
  });
});

// ---------------------------------------------------------------------------
// commandKeys — query-key factory
// ---------------------------------------------------------------------------

describe('commandKeys', () => {
  it('produces distinct, prefixed tuples per domain', () => {
    expect(commandKeys.history('7')).toEqual(['command-history', '7']);
    expect(commandKeys.latest('7')).toEqual(['command-latest', '7']);
    // The two domains must never collide for the same vehicle.
    expect(commandKeys.history('7')).not.toEqual(commandKeys.latest('7'));
  });

  it('normalises a numeric id to the same key as its string form', () => {
    // A component holding `vehicle.id` (number) must be able to invalidate a
    // query that was primed with the string route param — they have to hash
    // to the same cache entry.
    expect(commandKeys.history(7)).toEqual(commandKeys.history('7'));
    expect(commandKeys.latest(7)).toEqual(commandKeys.latest('7'));
    expect(commandKeys.history(7)).toEqual(['command-history', '7']);
  });

  it('preserves undefined so a disabled query keeps a distinct key', () => {
    expect(commandKeys.history(undefined)).toEqual(['command-history', undefined]);
    expect(commandKeys.latest(undefined)).toEqual(['command-latest', undefined]);
    // undefined must NOT collapse onto the literal string 'undefined'.
    expect(commandKeys.history(undefined)).not.toEqual(commandKeys.history('undefined'));
  });
});

// ---------------------------------------------------------------------------
// useCommandHistory
// ---------------------------------------------------------------------------

describe('useCommandHistory', () => {
  it('GETs the history endpoint with limit and threads the AbortSignal', async () => {
    mockedRequest.mockResolvedValueOnce([sampleEntry]);
    const { result } = renderHook(() => useCommandHistory('42'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].command).toBe('honk_horn');

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/vehicles/42/commands/history?limit=200');
    // Cancellation support: TanStack Query's signal must reach the client so
    // navigating away aborts the in-flight fetch.
    expect(opts).toHaveProperty('signal');
  });

  it('accepts a numeric vehicle id and builds the same URL', async () => {
    mockedRequest.mockResolvedValueOnce([sampleEntry]);
    renderHook(() => useCommandHistory(42), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe('/vehicles/42/commands/history?limit=200');
  });

  it('URL-encodes an id containing path-breaking characters', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    renderHook(() => useCommandHistory('a/b'), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    // Without encoding, `a/b` would inject an extra path segment.
    expect(mockedRequest.mock.calls[0][0]).toBe('/vehicles/a%2Fb/commands/history?limit=200');
  });

  it('coerces a null body to an empty array at the fetch boundary', async () => {
    mockedRequest.mockResolvedValueOnce(null as unknown as CommandLogEntry[]);
    const { result } = renderHook(() => useCommandHistory('42'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('coerces an undefined (204/no-content) body to an empty array', async () => {
    // The client returns `undefined` for a 204; returning that straight from
    // a queryFn is a hard TanStack error, so the hook must coerce it to [].
    mockedRequest.mockResolvedValueOnce(undefined as unknown as CommandLogEntry[]);
    const { result } = renderHook(() => useCommandHistory('42'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it('is disabled when the vehicle id is undefined', async () => {
    const { result } = renderHook(() => useCommandHistory(undefined), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isPending).toBe(true);
  });

  it('is disabled when the vehicle id is the empty string', async () => {
    renderHook(() => useCommandHistory(''), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('surfaces request failures as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useCommandHistory('42'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// useCommandLatest
// ---------------------------------------------------------------------------

describe('useCommandLatest', () => {
  it('GETs the latest endpoint and passes the array through', async () => {
    mockedRequest.mockResolvedValueOnce(latestEntries);
    const { result } = renderHook(() => useCommandLatest('42'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.map((c) => c.command)).toEqual(['flash_lights', 'set_temps']);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/vehicles/42/commands/latest');
    expect(opts).toHaveProperty('signal');
  });

  it('accepts a numeric vehicle id and encodes the path segment', async () => {
    mockedRequest.mockResolvedValueOnce(latestEntries);
    renderHook(() => useCommandLatest(42), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe('/vehicles/42/commands/latest');
  });

  it('coerces a missing (undefined) payload to an empty array', async () => {
    mockedRequest.mockResolvedValueOnce(undefined as unknown as CommandLogEntry[]);
    const { result } = renderHook(() => useCommandLatest('42'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it('is disabled when the vehicle id is undefined', async () => {
    const { result } = renderHook(() => useCommandLatest(undefined), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});
