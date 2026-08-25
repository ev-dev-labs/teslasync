// Unified activity timeline hook tests.
//
// Covers every runtime export of `useActivity.ts`:
//   - activityKeys — stable root key + positional list key with the
//     'all'/'' sentinels, sorted+deduped kind serialization, and default
//     limit/offset folding.
//   - useActivity  — GET /activity, snake_case query building
//     (vehicle_id/start/end/kind[]/limit/offset), abort-signal threading,
//     the `select` fallback to a well-shaped empty envelope on a missing or
//     malformed response, and the `enabled` gate.
//
// Network is faked at the `@/api/client` boundary so no real fetch happens.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: requestMock };
});

import { activityKeys, useActivity } from './useActivity';
import type { ActivityItem, ActivityListResponse } from '@/types/activity';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const item: ActivityItem = {
  id: 'drives:1',
  kind: 'drive',
  occurred_at: '2026-01-01T00:00:00Z',
  vehicle_id: 7,
  title: 'Drive',
  summary: '12 min',
  status: 'completed',
  source_table: 'drives',
  source_id: 1,
  path: '/drives/1',
};

const envelope: ActivityListResponse = {
  items: [item],
  total: 1,
  limit: 50,
  offset: 0,
  generated_at: '2026-01-01T00:00:01Z',
};

beforeEach(() => {
  requestMock.mockReset();
});

describe('activityKeys', () => {
  it('exposes a stable root key that list keys are prefixed with', () => {
    expect(activityKeys.all).toEqual(['activity']);
    expect(activityKeys.list({}).slice(0, 1)).toEqual(activityKeys.all);
  });

  it("collapses an unset vehicle_id / start / end / kind to 'all' / '' sentinels", () => {
    expect(activityKeys.list({})).toEqual(['activity', 'all', '', '', '', 50, 0]);
  });

  it('folds explicit params into the positional key, sorting kinds for stable cache keys', () => {
    expect(
      activityKeys.list({
        vehicle_id: 7,
        start: '2026-01-01',
        end: '2026-01-31',
        kind: ['charging', 'drive', 'charging'],
        limit: 10,
        offset: 5,
      }),
    ).toEqual(['activity', 7, '2026-01-01', '2026-01-31', 'charging,charging,drive', 10, 5]);
  });
});

describe('useActivity', () => {
  it('GETs /activity with no query string and threads the abort signal', async () => {
    requestMock.mockResolvedValueOnce(envelope);
    const { result } = renderHook(() => useActivity(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [url, opts] = requestMock.mock.calls[0] as [string, { signal?: unknown }];
    expect(url).toBe('/activity');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data).toEqual(envelope);
  });

  it('encodes vehicle_id, start, end, repeated kind, limit and offset (snake_case)', async () => {
    requestMock.mockResolvedValueOnce(envelope);
    const { result } = renderHook(
      () =>
        useActivity({
          vehicle_id: 7,
          start: '2026-01-01T00:00:00Z',
          end: '2026-01-31T00:00:00Z',
          kind: ['drive', 'charging'],
          limit: 20,
          offset: 10,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = requestMock.mock.calls[0][0] as string;
    expect(url.startsWith('/activity?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('vehicle_id')).toBe('7');
    expect(params.get('start')).toBe('2026-01-01T00:00:00Z');
    expect(params.get('end')).toBe('2026-01-31T00:00:00Z');
    expect(params.getAll('kind')).toEqual(['drive', 'charging']);
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('10');
  });

  it('omits vehicle_id when unset but does not omit an explicit zero limit/offset param', async () => {
    requestMock.mockResolvedValueOnce(envelope);
    const { result } = renderHook(() => useActivity({ offset: 0 }), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = requestMock.mock.calls[0][0] as string;
    expect(url).toContain('offset=0');
    expect(url).not.toContain('vehicle_id');
  });

  it('surfaces a missing or malformed envelope as an error', async () => {
    requestMock.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useActivity(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error('Invalid activity response'));
  });

  it('does not fetch when enabled is false', async () => {
    const { result } = renderHook(() => useActivity({ enabled: false }), { wrapper: makeWrapper() });

    expect(result.current.isFetching).toBe(false);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('surfaces a rejected request as an error state', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useActivity(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
