// useFSM hook-layer tests.
//
// useFSM.ts is the FSM (finite-state-machine) diagnostics TanStack Query
// surface consumed by the State Machine Debugger page and the dashboard
// FSM-distribution widget: the shadow-mode stats snapshot and the paged,
// optionally date-windowed transition log.
//
// These tests exercise the contract each export exposes without standing
// up either consumer page:
//   • the query-key factory produces stable, distinct tuples (and coalesces
//     the optional instants so an undefined bound never poisons the cache
//     key);
//   • isValidEntityId gates both hooks so a `'0'` / non-numeric / padded /
//     fractional id never fires the doomed request the backend answers with
//     HTTP 400 ("vehicle_id required");
//   • the pure path builders emit prefix-free (`/api/v1` is auto-added by
//     request()), snake_case-query URLs with the correct fsm_name / date
//     branching and RFC-3339 percent-encoding;
//   • the hooks thread TanStack Query's AbortSignal through to request(),
//     surface success + error, and stay idle when disabled.
//
// Sibling-of-source location is mandatory: the elevation gate matches
// `api/hooks/useFSM` as a contiguous path substring, which a __tests__/
// subdir would interrupt.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { ApiError, request } from '@/api/client';
import {
  fsmKeys,
  isValidEntityId,
  buildStatsPath,
  buildTransitionsPath,
  useFSMStats,
  useFSMTransitions,
} from './useFSM';
import type { FSMStats, FSMTransitionResponse } from '@/types/fsm';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

/** Fresh QueryClient + provider per test (retry off, gcTime 0). */
function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
    },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, wrapper };
}

/** Reads back the [path, options] pair from the Nth request() call. */
function callArgs(n = 0): [string, { signal?: unknown }] {
  return mockedRequest.mock.calls[n] as [string, { signal?: unknown }];
}

const statsPayload: FSMStats = {
  enabled: true,
  stats: { parked: 3, driving: 1 },
  active_subs: [
    { type: 'drive', state: 'moving', start_time: '2026-05-12T07:00:00.000Z', drive_id: 9 },
  ],
};

const transitionsPayload: FSMTransitionResponse = {
  data: [
    {
      id: 1,
      vehicle_id: 3,
      ts: '2026-05-12T07:00:00.000Z',
      fsm_name: 'vehicle',
      from_state: 'parked',
      to_state: 'driving',
      trigger: 'shift_to_drive',
      details: null,
    },
  ],
  total: 1,
  page: 1,
  per_page: 50,
};

beforeEach(() => {
  mockedRequest.mockReset();
});

// ---------------------------------------------------------------------------
// fsmKeys — query-key factory
// ---------------------------------------------------------------------------

describe('fsmKeys', () => {
  it('builds the stats key from the entity id', () => {
    expect(fsmKeys.stats('3')).toEqual(['fsm-stats', '3']);
  });

  it('builds the full transitions tuple and coalesces omitted instants to empty strings', () => {
    expect(fsmKeys.transitions('3', 'vehicle', 24, 1, 5)).toEqual([
      'fsm-transitions',
      '3',
      'vehicle',
      24,
      1,
      5,
      '',
      '',
    ]);
  });

  it('threads explicit instants through so distinct windows key distinctly', () => {
    const a = fsmKeys.transitions('3', 'all', 0, 2, 50, '2026-05-01T00:00:00Z', '2026-05-02T00:00:00Z');
    const b = fsmKeys.transitions('3', 'all', 0, 2, 50, '2026-05-02T00:00:00Z', '2026-05-03T00:00:00Z');
    expect(a[6]).toBe('2026-05-01T00:00:00Z');
    expect(a).not.toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// isValidEntityId — the enabled gate both hooks share
// ---------------------------------------------------------------------------

describe('isValidEntityId', () => {
  it('accepts positive-integer strings (including leading zeros)', () => {
    expect(isValidEntityId('1')).toBe(true);
    expect(isValidEntityId('42')).toBe(true);
    expect(isValidEntityId('007')).toBe(true);
  });

  it('rejects the empty string and the zero sentinel', () => {
    expect(isValidEntityId('')).toBe(false);
    expect(isValidEntityId('0')).toBe(false);
    expect(isValidEntityId('00')).toBe(false);
  });

  it('rejects non-numeric, padded, fractional, and negative ids', () => {
    expect(isValidEntityId('abc')).toBe(false);
    expect(isValidEntityId(' 3')).toBe(false);
    expect(isValidEntityId('3 ')).toBe(false);
    expect(isValidEntityId('2.5')).toBe(false);
    expect(isValidEntityId('-3')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildStatsPath
// ---------------------------------------------------------------------------

describe('buildStatsPath', () => {
  it('emits a prefix-free snake_case URL (request() adds /api/v1)', () => {
    const url = buildStatsPath('3');
    expect(url).toBe('/fsm/stats?vehicle_id=3');
    expect(url).not.toContain('/api/v1');
    expect(url).not.toContain('vehicleId');
  });
});

// ---------------------------------------------------------------------------
// buildTransitionsPath — the branchy URL logic
// ---------------------------------------------------------------------------

describe('buildTransitionsPath', () => {
  it('omits fsm_name for the "all" pseudo-type', () => {
    const url = buildTransitionsPath('3', 'all', 24, 1, 5);
    expect(url).toBe('/fsm/transitions?vehicle_id=3&hours=24&page=1&per_page=5');
    expect(url).not.toContain('fsm_name');
  });

  it('includes fsm_name for a concrete FSM type', () => {
    const url = buildTransitionsPath('3', 'vehicle', 24, 2, 50);
    expect(url).toBe(
      '/fsm/transitions?vehicle_id=3&hours=24&page=2&per_page=50&fsm_name=vehicle',
    );
  });

  it('appends and percent-encodes the half-open window when BOTH instants are present', () => {
    const url = buildTransitionsPath(
      '3',
      'telemetry_connection',
      0,
      1,
      50,
      '2026-05-12T07:00:00.000Z',
      '2026-05-13T07:00:00.000+02:00',
    );
    expect(url).toContain('&fsm_name=telemetry_connection');
    expect(url).toContain('&start=2026-05-12T07%3A00%3A00.000Z');
    // The `+` offset must be encoded so it is not decoded as a space server-side.
    expect(url).toContain('&end=2026-05-13T07%3A00%3A00.000%2B02%3A00');
  });

  it('drops a lone bound — the window is meaningless without both edges', () => {
    const startOnly = buildTransitionsPath('3', 'all', 24, 1, 5, '2026-05-12T07:00:00Z');
    const endOnly = buildTransitionsPath('3', 'all', 24, 1, 5, undefined, '2026-05-13T07:00:00Z');
    expect(startOnly).not.toContain('start=');
    expect(endOnly).not.toContain('end=');
  });
});

// ---------------------------------------------------------------------------
// useFSMStats
// ---------------------------------------------------------------------------

describe('useFSMStats', () => {
  it('GETs /fsm/stats for a valid id, threads the abort signal, and surfaces the payload', async () => {
    mockedRequest.mockResolvedValueOnce(statsPayload);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useFSMStats('3'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = callArgs();
    expect(url).toBe('/fsm/stats?vehicle_id=3');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(result.current.data?.stats.parked).toBe(3);
    expect(result.current.data?.active_subs?.[0]?.drive_id).toBe(9);
  });

  it('stays idle (no request) for the empty-string "no vehicle" state', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useFSMStats(''), { wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays idle for the "0" sentinel instead of firing a doomed request', async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useFSMStats('0'), { wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('surfaces a request failure as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('boom', 500));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useFSMStats('3'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});

// ---------------------------------------------------------------------------
// useFSMTransitions
// ---------------------------------------------------------------------------

describe('useFSMTransitions', () => {
  it('GETs /fsm/transitions with all params, threads the signal, and surfaces the rows', async () => {
    mockedRequest.mockResolvedValueOnce(transitionsPayload);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useFSMTransitions('3', 'vehicle', 24, 1, 5),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = callArgs();
    expect(url).toBe(
      '/fsm/transitions?vehicle_id=3&hours=24&page=1&per_page=5&fsm_name=vehicle',
    );
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0]?.to_state).toBe('driving');
  });

  it('sends the encoded [start, end) window when both instants are supplied', async () => {
    mockedRequest.mockResolvedValueOnce(transitionsPayload);
    const { wrapper } = makeWrapper();
    renderHook(
      () =>
        useFSMTransitions(
          '3',
          'all',
          0,
          1,
          50,
          '2026-05-12T07:00:00.000Z',
          '2026-05-13T07:00:00.000Z',
        ),
      { wrapper },
    );

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    const url = callArgs()[0];
    expect(url).toContain('&start=2026-05-12T07%3A00%3A00.000Z');
    expect(url).toContain('&end=2026-05-13T07%3A00%3A00.000Z');
    expect(url).not.toContain('fsm_name');
  });

  it('stays idle for the "0" sentinel — never fires the backend 400 path', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useFSMTransitions('0', 'vehicle', 24, 1, 5),
      { wrapper },
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces a request failure as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('query failed', 500));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useFSMTransitions('3', 'vehicle', 24, 1, 5),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});
