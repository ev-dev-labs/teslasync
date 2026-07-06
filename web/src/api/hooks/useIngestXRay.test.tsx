// Behavioural coverage for the per-vehicle ingest X-Ray binding
// (`GET /api/v1/system/ingest-xray/{vehicleID}`). The module owns real
// logic — a query-key factory, an `enabled` gate that hardens the URL-bound
// vehicle id, snake_case query-param shaping, an abort-signal thread-through,
// and a `value_kind` → label map that mirrors `protomodel.ValueKind`. Each
// export is exercised through its public surface rather than smoke rendered.
//
// Network is mocked at the `request` boundary (the repo convention — see
// useFeatureFlags.test.tsx / useAlerts.test.tsx). `importActual` keeps every
// other client export intact so only the HTTP entry point is a spy.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return { ...actual, request: vi.fn() };
});

import { request } from '../client';
import * as xrayModule from './useIngestXRay';
import { ingestXRayKeys, useIngestXRay, formatValueKind } from './useIngestXRay';
import type { IngestXRayResponse } from '@/types/admin-diagnostics';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // The hook sets `retry: 1`; force retry off + gcTime 0 so error paths
      // resolve instantly and don't leak cache across cases.
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** URL string the mocked `request` was called with on invocation `i`. */
function calledUrl(i = 0): string {
  return mockedRequest.mock.calls[i]?.[0] as string;
}
/** RequestInit the mocked `request` was called with on invocation `i`. */
function calledOpts(i = 0): RequestInit {
  return (mockedRequest.mock.calls[i]?.[1] ?? {}) as RequestInit;
}

function makeResponse(overrides: Partial<IngestXRayResponse> = {}): IngestXRayResponse {
  return {
    vehicle_id: 42,
    window: '1h',
    bucket: '1m',
    generated_at: '2026-07-04T10:00:00Z',
    total_samples: 3,
    unique_fields: 2,
    fields: [
      { field: 'VehicleSpeed', sample_count: 2, last_seen_at: '2026-07-04T09:59:00Z', value_kind: 6 },
      { field: 'Locked', sample_count: 1, last_seen_at: '2026-07-04T09:58:00Z', value_kind: 2 },
    ],
    buckets: [{ bucket_start: '2026-07-04T09:00:00Z', count: 3 }],
    ...overrides,
  };
}

beforeEach(() => {
  mockedRequest.mockReset();
});

// ── Module surface ───────────────────────────────────────────────────────────
describe('useIngestXRay module surface', () => {
  it('exports the hook + formatter as functions and the key factory as an object', () => {
    expect(typeof useIngestXRay).toBe('function');
    expect(typeof formatValueKind).toBe('function');
    expect(typeof ingestXRayKeys).toBe('object');
    expect(xrayModule.ingestXRayKeys).toBe(ingestXRayKeys);
  });
});

// ── Query-key factory ────────────────────────────────────────────────────────
describe('ingestXRayKeys', () => {
  it('exposes a stable root key', () => {
    expect(ingestXRayKeys.root).toEqual(['system', 'ingest-xray']);
  });

  it('builds a detail key from all four cache-affecting inputs', () => {
    expect(ingestXRayKeys.detail(7, '6h', '5m', 100)).toEqual([
      'system',
      'ingest-xray',
      7,
      '6h',
      '5m',
      100,
    ]);
  });

  it('produces distinct keys when any single input changes', () => {
    const base = ingestXRayKeys.detail(7, '1h', '1m', 50);
    expect(ingestXRayKeys.detail(8, '1h', '1m', 50)).not.toEqual(base);
    expect(ingestXRayKeys.detail(7, '24h', '1m', 50)).not.toEqual(base);
    expect(ingestXRayKeys.detail(7, '1h', '30s', 50)).not.toEqual(base);
    expect(ingestXRayKeys.detail(7, '1h', '1m', 25)).not.toEqual(base);
  });
});

// ── useIngestXRay — happy path ───────────────────────────────────────────────
describe('useIngestXRay (fetching)', () => {
  it('GETs the default window/bucket/limit, threads an abort signal, and returns data', async () => {
    const payload = makeResponse();
    mockedRequest.mockResolvedValueOnce(payload);

    const { result } = renderHook(() => useIngestXRay({ vehicleId: 42 }), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/system/ingest-xray/42?window=1h&bucket=1m&limit=50');
    expect(calledOpts()).toEqual(expect.objectContaining({ signal: expect.anything() }));
    expect(result.current.data).toEqual(payload);
    expect(result.current.data?.fields).toHaveLength(2);
  });

  it('reflects custom window, bucket, and limit in the URL (snake_case params)', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse({ window: '6h', bucket: '5m' }));

    const { result } = renderHook(
      () => useIngestXRay({ vehicleId: 7, window: '6h', bucket: '5m', limit: 10 }),
      { wrapper: wrapperFor(makeClient()) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/system/ingest-xray/7?window=6h&bucket=5m&limit=10');
  });

  it('does not double-prefix the URL with /api/v1', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse());
    const { result } = renderHook(() => useIngestXRay({ vehicleId: 1 }), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl().startsWith('/system/')).toBe(true);
    expect(calledUrl()).not.toContain('/api/v1');
  });
});

// ── useIngestXRay — the enabled gate + vehicleId hardening ────────────────────
describe('useIngestXRay (enabled gate)', () => {
  async function expectNeverFires(params: Parameters<typeof useIngestXRay>[0]) {
    const { result } = renderHook(() => useIngestXRay(params), {
      wrapper: wrapperFor(makeClient()),
    });
    // Give a disabled query a tick — it must never dispatch.
    await new Promise((r) => setTimeout(r, 15));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isPending).toBe(true);
  }

  it('stays idle for a null vehicleId', async () => {
    await expectNeverFires({ vehicleId: null });
  });

  it('stays idle for an undefined vehicleId', async () => {
    await expectNeverFires({ vehicleId: undefined });
  });

  it('stays idle for a zero vehicleId', async () => {
    await expectNeverFires({ vehicleId: 0 });
  });

  it('stays idle for a negative vehicleId', async () => {
    await expectNeverFires({ vehicleId: -3 });
  });

  it('stays idle for a NaN vehicleId', async () => {
    await expectNeverFires({ vehicleId: Number.NaN });
  });

  it('hardening: stays idle for a non-integer vehicleId (would build a malformed URL)', async () => {
    await expectNeverFires({ vehicleId: 5.5 });
  });

  it('hardening: stays idle for a non-finite (Infinity) vehicleId', async () => {
    await expectNeverFires({ vehicleId: Number.POSITIVE_INFINITY });
  });

  it('respects an explicit enabled:false even for a valid id', async () => {
    await expectNeverFires({ vehicleId: 42, enabled: false });
  });
});

// ── useIngestXRay — failure path ─────────────────────────────────────────────
describe('useIngestXRay (errors)', () => {
  it('surfaces a request rejection as isError', async () => {
    mockedRequest.mockRejectedValue(new Error('ingest x-ray down'));
    const { result } = renderHook(() => useIngestXRay({ vehicleId: 9 }), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('ingest x-ray down');
  });
});

// ── formatValueKind — canonical protomodel.ValueKind mapping ──────────────────
describe('formatValueKind', () => {
  // Source of truth: protomodel.ValueKind (iota) + migration 000186.
  const cases: Array<[number, string]> = [
    [0, 'unknown'],
    [1, 'string'],
    [2, 'bool'],
    [3, 'int32'],
    [4, 'int64'],
    [5, 'float32'],
    [6, 'float64'],
    [7, 'enum'],
    [8, 'compound'],
    [9, 'time'],
    [10, 'invalid'],
  ];

  it.each(cases)('maps kind %i to "%s"', (kind, label) => {
    expect(formatValueKind(kind)).toBe(label);
  });

  it('regression: kind 8 is "compound" (never the old "invalid")', () => {
    // Pre-fix bug: 8 mislabelled as "invalid", shadowing kind 10.
    expect(formatValueKind(8)).toBe('compound');
    expect(formatValueKind(8)).not.toBe('invalid');
  });

  it('regression: kind 10 is "invalid" (never the phantom "location")', () => {
    // "location" is a CompoundKind, not a ValueKind — it must never appear.
    expect(formatValueKind(10)).toBe('invalid');
    const labels = cases.map(([k]) => formatValueKind(k));
    expect(labels).not.toContain('location');
  });

  it('falls back to `kind {n}` for values outside the map', () => {
    expect(formatValueKind(11)).toBe('kind 11');
    expect(formatValueKind(99)).toBe('kind 99');
    expect(formatValueKind(-1)).toBe('kind -1');
  });
});
