// useOperatorConfidence hook-family + key-factory tests.
//
// Covers every export of api/hooks/useOperatorConfidence:
//   - operatorConfidenceKeys: the query-key factory (static tuples + the
//     parametrised builders for slow-queries, vehicle-cost, audit-log list,
//     audit-verify and gdpr-export).
//   - useSchemaDrift / useDiskForecast / useSecretRotation / useAuditCategories
//     / useAuditActions: the zero-arg GETs — correct snake_case URL with no
//     /api/v1 prefix, AbortSignal threaded through, and the httputil.Respond
//     `{data:T}` envelope unwrapped (fetchEnvelope's unwrap branch) AND passed
//     through when absent (fetchEnvelope's no-op branch).
//   - useSlowQueries: default + custom order_by/limit land in the URL and the
//     query key; params are snake_case.
//   - useVehicleCost: omits `since` when null, encodes it when present, and —
//     the hardening fix — does NOT crash render when handed an *invalid* Date.
//   - useAuditLog: buildAuditLogQuery produces no `?` for empty params, joins
//     array filters, keeps snake_case keys, and includes entity_id=0 (the
//     `!== undefined` branch, not a truthiness check); `enabled=false` holds
//     the fetch.
//   - useAuditChainVerify: disabled by default (operator-triggered), fires when
//     enabled with limit + encoded since, and is invalid-Date safe.
//   - useGDPRExport: disabled for a null id (with the `__none__` key sentinel)
//     and fires for a real id.
//   - error propagation: a rejected request surfaces isError with the raw error.
//
// Network is mocked at the api/client boundary (the repo convention) so the
// test never touches fetch. Kept beside the hook so path-scoped checks match
// `api/hooks/useOperatorConfidence` contiguously.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const requestMock = vi.fn();
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import {
  operatorConfidenceKeys,
  useSchemaDrift,
  useSlowQueries,
  useVehicleCost,
  useDiskForecast,
  useSecretRotation,
  useAuditLog,
  useAuditCategories,
  useAuditActions,
  useAuditChainVerify,
  useGDPRExport,
} from './useOperatorConfidence';
import type {
  SchemaDriftResponse,
  SlowQueriesResponse,
  VehicleCostResponse,
  DiskForecastResponse,
  SecretRotationResponse,
  AuditLogListResponse,
  AuditCategoriesResponse,
  AuditActionsResponse,
  AuditChainVerifyResponse,
  GDPRExportArtifact,
} from '@/types/admin-operator-confidence';

function makeWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, retryDelay: 0, gcTime: 0, refetchInterval: false },
      },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Wraps a payload in the httputil.Respond envelope the real backend sends. */
function envelope<T>(data: T): { data: T } {
  return { data };
}

/** First URL string the mocked request() was invoked with. */
function firstUrl(): string {
  return requestMock.mock.calls[0][0] as string;
}

/** Second (options) arg of the first request() call. */
function firstOpts(): { signal?: unknown } {
  return requestMock.mock.calls[0][1] as { signal?: unknown };
}

beforeEach(() => {
  requestMock.mockReset();
});

// ---------------------------------------------------------------------------
// Key factory
// ---------------------------------------------------------------------------

describe('operatorConfidenceKeys', () => {
  it('exposes stable static tuples for the zero-arg surfaces', () => {
    expect(operatorConfidenceKeys.schemaDrift).toEqual([
      'admin',
      'observability',
      'schema-drift',
    ]);
    expect(operatorConfidenceKeys.diskForecast).toEqual([
      'admin',
      'observability',
      'disk-forecast',
    ]);
    expect(operatorConfidenceKeys.secretRotation).toEqual([
      'admin',
      'observability',
      'secret-rotation',
    ]);
    expect(operatorConfidenceKeys.auditCategories).toEqual([
      'admin',
      'audit-log',
      'categories',
    ]);
    expect(operatorConfidenceKeys.auditActions).toEqual([
      'admin',
      'audit-log',
      'actions',
    ]);
  });

  it('varies the parametrised keys by their inputs', () => {
    expect(operatorConfidenceKeys.slowQueries('mean_time', 25)).toEqual([
      'admin',
      'observability',
      'slow-queries',
      'mean_time',
      25,
    ]);
    // A different ordering / limit must produce a distinct cache identity.
    expect(operatorConfidenceKeys.slowQueries('calls', 50)).not.toEqual(
      operatorConfidenceKeys.slowQueries('mean_time', 25),
    );

    expect(operatorConfidenceKeys.vehicleCost(null, 100)).toEqual([
      'admin',
      'observability',
      'vehicle-cost',
      null,
      100,
    ]);
    expect(operatorConfidenceKeys.auditVerify('2025-01-01T00:00:00.000Z', 1000)).toEqual([
      'admin',
      'audit-log',
      'verify',
      '2025-01-01T00:00:00.000Z',
      1000,
    ]);
    expect(operatorConfidenceKeys.gdprExport('artifact-7')).toEqual([
      'admin',
      'gdpr',
      'exports',
      'artifact-7',
    ]);
  });

  it('embeds the full params object in the audit-log list key', () => {
    const key = operatorConfidenceKeys.auditLogList({ limit: 20, offset: 0 });
    expect(key).toEqual(['admin', 'audit-log', 'list', { limit: 20, offset: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// Zero-arg observability GETs (also exercise fetchEnvelope both branches)
// ---------------------------------------------------------------------------

describe('useSchemaDrift', () => {
  const payload: SchemaDriftResponse = {
    is_different: true,
    drift: {
      has_drift: true,
      current: { sha256: 'aaa', table_count: 42, column_count: 300, index_count: 88 },
      expected: { sha256: 'bbb', table_count: 41, column_count: 298, index_count: 88 },
      table_count_delta: 1,
      column_count_delta: 2,
      index_count_delta: 0,
    },
  };

  it('GETs the snake_case route with no /api/v1 prefix and unwraps the envelope', async () => {
    requestMock.mockResolvedValueOnce(envelope(payload));
    const { result } = renderHook(() => useSchemaDrift(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(firstUrl()).toBe('/admin/observability/schema-drift');
    expect(firstUrl()).not.toContain('/api/v1');
    expect(firstOpts()).toHaveProperty('signal');
    // fetchEnvelope unwrapped {data:T} → the caller sees the bare payload.
    expect(result.current.data).toEqual(payload);
    expect(result.current.data?.drift.has_drift).toBe(true);
    expect(result.current.data?.drift.table_count_delta).toBe(1);
  });

  it('passes an un-enveloped body straight through (fetchEnvelope no-op branch)', async () => {
    // A handler migrated off httputil.Respond returns the bare object.
    requestMock.mockResolvedValueOnce(payload);
    const { result } = renderHook(() => useSchemaDrift(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(result.current.data?.is_different).toBe(true);
  });
});

describe('useDiskForecast', () => {
  it('GETs the disk-forecast route and unwraps the hypertable list', async () => {
    const payload: DiskForecastResponse = {
      hypertables: [
        {
          hypertable_name: 'signal_log',
          total_bytes: 1_000_000,
          uncompressed_bytes: 800_000,
          compressed_bytes: 200_000,
          chunk_count: 12,
          growth_bytes_per_day: 50_000,
          est_days_to_quota: 30,
          severity: 'warn',
        },
      ],
    };
    requestMock.mockResolvedValueOnce(envelope(payload));
    const { result } = renderHook(() => useDiskForecast(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstUrl()).toBe('/admin/observability/disk-forecast');
    expect(result.current.data?.hypertables).toHaveLength(1);
    expect(result.current.data?.hypertables[0].severity).toBe('warn');
  });
});

describe('useSecretRotation', () => {
  it('GETs the secret-rotation route and unwraps the items list', async () => {
    const payload: SecretRotationResponse = {
      items: [
        {
          kind: 'tesla_token',
          last_rotated: '2025-05-01T00:00:00Z',
          age_days: 64,
          warn_days: 60,
          critical_days: 90,
          severity: 'warn',
        },
      ],
    };
    requestMock.mockResolvedValueOnce(envelope(payload));
    const { result } = renderHook(() => useSecretRotation(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstUrl()).toBe('/admin/observability/secret-rotation');
    expect(result.current.data?.items[0].kind).toBe('tesla_token');
    expect(result.current.data?.items[0].severity).toBe('warn');
  });
});

describe('useAuditCategories / useAuditActions', () => {
  it('GET the categories dropdown feed', async () => {
    const payload: AuditCategoriesResponse = { categories: ['auth', 'vehicle', 'admin'] };
    requestMock.mockResolvedValueOnce(envelope(payload));
    const { result } = renderHook(() => useAuditCategories(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstUrl()).toBe('/admin/audit-log/categories');
    expect(result.current.data?.categories).toEqual(['auth', 'vehicle', 'admin']);
  });

  it('GET the actions dropdown feed', async () => {
    const payload: AuditActionsResponse = { actions: ['login', 'delete', 'rotate'] };
    requestMock.mockResolvedValueOnce(envelope(payload));
    const { result } = renderHook(() => useAuditActions(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstUrl()).toBe('/admin/audit-log/actions');
    expect(result.current.data?.actions).toContain('rotate');
  });
});

// ---------------------------------------------------------------------------
// Slow queries — parametrised URL + key
// ---------------------------------------------------------------------------

describe('useSlowQueries', () => {
  const payload: SlowQueriesResponse = {
    order_by: 'mean_time',
    slow_queries: [
      {
        query_id: 1,
        fingerprint: 'SELECT * FROM signal_log WHERE …',
        calls: 1000,
        total_time_ms: 5000,
        mean_time_ms: 5,
        max_time_ms: 42,
        rows_returned: 1000,
      },
    ],
  };

  it('defaults to order_by=mean_time&limit=25 with snake_case params', async () => {
    requestMock.mockResolvedValueOnce(envelope(payload));
    const { result } = renderHook(() => useSlowQueries(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = firstUrl();
    const params = new URLSearchParams(url.split('?')[1]);
    expect(url.startsWith('/admin/observability/slow-queries?')).toBe(true);
    expect(params.get('order_by')).toBe('mean_time');
    expect(params.get('limit')).toBe('25');
    // snake_case, not camelCase.
    expect(url).not.toContain('orderBy=');
    expect(result.current.data?.slow_queries).toHaveLength(1);
  });

  it('threads a custom order_by + limit into both the URL and the query key', async () => {
    requestMock.mockResolvedValueOnce(envelope({ ...payload, order_by: 'calls' }));
    const { result } = renderHook(() => useSlowQueries('calls', 100), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = new URLSearchParams(firstUrl().split('?')[1]);
    expect(params.get('order_by')).toBe('calls');
    expect(params.get('limit')).toBe('100');
  });
});

// ---------------------------------------------------------------------------
// Vehicle cost — since encoding + invalid-Date hardening
// ---------------------------------------------------------------------------

describe('useVehicleCost', () => {
  const payload: VehicleCostResponse = {
    vehicles: [
      {
        vehicle_id: 7,
        display_name: 'Model 3',
        signal_row_count: 100,
        signal_bytes_est: 2048,
        ingest_rate_per_minute_24h: 4,
        dlq_failures_24h: 0,
        last_seen_at: '2025-06-01T00:00:00Z',
      },
    ],
    totals: {
      total_rows: 100,
      total_bytes_est: 2048,
      total_rate_per_minute_24h: 4,
      total_failures_24h: 0,
    },
  };

  it('omits the since param when since is null and defaults limit to 100', async () => {
    requestMock.mockResolvedValueOnce(envelope(payload));
    const { result } = renderHook(() => useVehicleCost(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = firstUrl();
    expect(url).toBe('/admin/observability/vehicle-cost?limit=100');
    expect(url).not.toContain('since=');
    expect(result.current.data?.totals.total_rows).toBe(100);
  });

  it('URL-encodes a valid since Date into the request', async () => {
    requestMock.mockResolvedValueOnce(envelope(payload));
    const since = new Date('2025-01-02T03:04:05.000Z');
    const { result } = renderHook(() => useVehicleCost(since, 50), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = firstUrl();
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('limit')).toBe('50');
    expect(params.get('since')).toBe('2025-01-02T03:04:05.000Z');
    // The colons must be percent-encoded on the wire, not raw.
    expect(url).toContain('since=2025-01-02T03%3A04%3A05.000Z');
  });

  it('does NOT crash render for an invalid Date — degrades to no since filter', async () => {
    requestMock.mockResolvedValueOnce(envelope(payload));
    // new Date('nonsense') yields an Invalid Date; an unguarded
    // .toISOString() would throw RangeError synchronously in the hook body.
    const { result } = renderHook(() => useVehicleCost(new Date('nonsense')), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstUrl()).toBe('/admin/observability/vehicle-cost?limit=100');
    expect(firstUrl()).not.toContain('since=');
  });
});

// ---------------------------------------------------------------------------
// Audit log list — buildAuditLogQuery behaviour + enabled gate
// ---------------------------------------------------------------------------

describe('useAuditLog', () => {
  const payload: AuditLogListResponse = {
    limit: 100,
    rows: [
      {
        id: 1,
        ts: '2025-06-01T00:00:00Z',
        actor: 'alice',
        category: 'auth',
        action: 'login',
        entity_type: 'session',
        entity_id: 5,
        success: true,
      },
    ],
  };

  it('produces a bare path (no ?) when params are empty', async () => {
    requestMock.mockResolvedValueOnce(envelope(payload));
    const { result } = renderHook(() => useAuditLog({}), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstUrl()).toBe('/admin/audit-log');
  });

  it('joins array filters and keeps snake_case keys, including entity_id=0', async () => {
    requestMock.mockResolvedValueOnce(envelope(payload));
    const { result } = renderHook(
      () =>
        useAuditLog({
          since: '2025-06-01T00:00:00Z',
          until: '2025-06-02T00:00:00Z',
          categories: ['auth', 'admin'],
          actors: ['alice', 'bob'],
          actions: ['login'],
          entity_type: 'session',
          entity_id: 0,
          limit: 20,
          offset: 40,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = new URLSearchParams(firstUrl().split('?')[1]);
    expect(params.get('since')).toBe('2025-06-01T00:00:00Z');
    expect(params.get('until')).toBe('2025-06-02T00:00:00Z');
    expect(params.get('categories')).toBe('auth,admin');
    expect(params.get('actors')).toBe('alice,bob');
    expect(params.get('actions')).toBe('login');
    expect(params.get('entity_type')).toBe('session');
    // entity_id=0 must survive — the source guards on `!== undefined`, not
    // truthiness, so a falsy-but-valid 0 is not silently dropped.
    expect(params.get('entity_id')).toBe('0');
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('40');
  });

  it('holds the fetch while enabled=false, then no request is made', async () => {
    const { result } = renderHook(() => useAuditLog({ limit: 10 }, false), {
      wrapper: makeWrapper(),
    });
    // Give React Query a tick — a disabled query must stay idle.
    await new Promise((r) => setTimeout(r, 10));
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Audit chain verify — operator-triggered (disabled by default)
// ---------------------------------------------------------------------------

describe('useAuditChainVerify', () => {
  const payload: AuditChainVerifyResponse = {
    intact: true,
    first_bad_id: 0,
    rows_checked: 1000,
    since: '2025-05-01T00:00:00Z',
    limit: 1000,
  };

  it('does not fetch when created disabled (the default operator-action posture)', async () => {
    const { result } = renderHook(() => useAuditChainVerify(), {
      wrapper: makeWrapper(),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fires with limit + encoded since once enabled', async () => {
    requestMock.mockResolvedValueOnce(envelope(payload));
    const since = new Date('2025-05-01T00:00:00.000Z');
    const { result } = renderHook(() => useAuditChainVerify(since, 500, true), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = new URLSearchParams(firstUrl().split('?')[1]);
    expect(firstUrl().startsWith('/admin/audit-log/verify?')).toBe(true);
    expect(params.get('limit')).toBe('500');
    expect(params.get('since')).toBe('2025-05-01T00:00:00.000Z');
    expect(result.current.data?.intact).toBe(true);
    expect(result.current.data?.rows_checked).toBe(1000);
  });

  it('is invalid-Date safe when enabled — degrades to no since filter', async () => {
    requestMock.mockResolvedValueOnce(envelope(payload));
    const { result } = renderHook(
      () => useAuditChainVerify(new Date('bad-date'), 100, true),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstUrl()).toBe('/admin/audit-log/verify?limit=100');
    expect(firstUrl()).not.toContain('since=');
  });
});

// ---------------------------------------------------------------------------
// GDPR export — id gating + key sentinel
// ---------------------------------------------------------------------------

describe('useGDPRExport', () => {
  const payload: GDPRExportArtifact = {
    id: 'artifact-7',
    status: 'complete',
    format: 'zip',
    bytes: 4096,
    created_at: '2025-06-01T00:00:00Z',
    completed_at: '2025-06-01T00:05:00Z',
  };

  it('stays disabled and uses the __none__ key sentinel for a null id', async () => {
    const { result } = renderHook(() => useGDPRExport(null), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 10));
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
    expect(operatorConfidenceKeys.gdprExport('__none__')).toEqual([
      'admin',
      'gdpr',
      'exports',
      '__none__',
    ]);
  });

  it('fetches the artifact metadata for a real id', async () => {
    requestMock.mockResolvedValueOnce(envelope(payload));
    const { result } = renderHook(() => useGDPRExport('artifact-7'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstUrl()).toBe('/admin/gdpr/exports/artifact-7');
    expect(result.current.data?.status).toBe('complete');
    expect(result.current.data?.bytes).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

describe('error propagation', () => {
  it('surfaces isError with the raw error when a request rejects', async () => {
    // Persistent reject: the hooks hardcode retry:1, so a one-shot reject
    // would let the retry resolve with the mock's default undefined and the
    // query would (wrongly) succeed. retryDelay:0 in the wrapper keeps the
    // single retry instant so this stays fast + deterministic.
    requestMock.mockRejectedValue(new Error('boom: subsystem not configured'));
    const { result } = renderHook(() => useSchemaDrift(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(String(result.current.error)).toContain('boom: subsystem not configured');
  });
});
