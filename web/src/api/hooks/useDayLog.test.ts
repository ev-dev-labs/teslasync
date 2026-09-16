// useDayLog hook tests.
//
// Covers the all-pages fetch contract:
//   - single page resolves merged when total fits one page;
//   - multi-page days loop with offset until total_events is reached;
//   - a non-advancing server cannot spin forever;
//   - snake_case query building (vehicle_id/date/timezone/limit),
//     omitted layers upstream, and the `enabled` gate.
//
// Network is faked at the `@/api/client` boundary so no real fetch happens.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: requestMock };
});

import { dayLogKeys, useDayLog, DAY_LOG_PAGE_LIMIT } from './useDayLog';
import type { DayLogEvent, DayLogResponse } from '../types';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

function event(id: string): DayLogEvent {
  return { id, ts: '2026-09-14T12:00:00Z', type: 'locked', layer: 'default', source: 'security_events', vehicle_id: 1, payload: {} };
}

function page(events: DayLogEvent[], total: number, offset: number): DayLogResponse {
  return {
    vehicle_id: 1,
    date: '2026-09-14',
    timezone: 'UTC',
    day_start: '2026-09-14T00:00:00Z',
    day_end: '2026-09-15T00:00:00Z',
    truncated: false,
    total_events: total,
    limit: DAY_LOG_PAGE_LIMIT,
    offset,
    layers: [],
    summary: { drive_count: 0, charge_count: 0, drive_duration_s: null, drive_distance_m: null, energy_added_wh: null, energy_used_wh: null },
    sources: [],
    events,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDayLog', () => {
  it('resolves a single page with snake_case params and no layers upstream', async () => {
    requestMock.mockResolvedValueOnce(page([event('a')], 1, 0));
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.events).toHaveLength(1);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const url = String(requestMock.mock.calls[0][0]);
    expect(url).toContain('vehicle_id=1');
    expect(url).toContain('date=2026-09-14');
    expect(url).toContain('timezone=UTC');
    expect(url).toContain(`limit=${DAY_LOG_PAGE_LIMIT}`);
    expect(url).not.toContain('layers=');
  });

  it('pages with offset until total_events is reached', async () => {
    requestMock
      .mockResolvedValueOnce(page([event('a')], 3, 0))
      .mockResolvedValueOnce(page([event('b'), event('c')], 3, 1));
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.events.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(String(requestMock.mock.calls[1][0])).toContain('offset=1');
  });

  it('stops when a page adds nothing', async () => {
    requestMock
      .mockResolvedValueOnce(page([event('a')], 5, 0))
      .mockResolvedValueOnce(page([], 5, 1));
    const { result } = renderHook(
      () => useDayLog({ vehicleId: 1, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.events).toHaveLength(1);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('stays disabled without a positive vehicle id', () => {
    const { result } = renderHook(
      () => useDayLog({ vehicleId: null, date: '2026-09-14', timezone: 'UTC' }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isPending).toBe(true);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('builds stable keys with sorted layers', () => {
    expect(dayLogKeys.day(1, 'd', 'tz', ['gear', 'lights'])).toEqual(
      dayLogKeys.day(1, 'd', 'tz', ['lights', 'gear']),
    );
  });
});
