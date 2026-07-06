/**
 * admin-operator-confidence wire-type contract tests.
 *
 * `admin-operator-confidence.ts` is a pure declaration module: no runtime
 * code, only the TypeScript shapes for the seven operator-confidence admin
 * routes mounted under /api/v1/admin/*. Its single load-bearing promise (see
 * the module docstring) is that every field name mirrors the Go JSON tag 1:1
 * in snake_case, so the shared `request()` client's `camelCaseKeys()` transform
 * (api/client.ts → directRequest → camelCaseKeys) exposes BOTH the snake_case
 * key the type declares AND a camelCase mirror on the runtime object.
 *
 * A declaration file has nothing to exercise in the classic sense, so these
 * cases lock the contract instead. Realistic backend-shaped fixtures —
 * snake_case, exactly as the handlers in internal/handler/v1 emit — are run
 * through the REAL `camelCaseKeys` and asserted to:
 *   (a) preserve the declared snake_case keys + values the pages read,
 *   (b) grow the camelCase mirror the docstring promises (and, for digit-only
 *       keys like `sha256`, correctly NOT add a redundant one),
 *   (c) round-trip nested objects (SchemaDrift.current) and row arrays, and
 *   (d) carry null / omitted optional fields through untouched.
 * The four string-literal unions get their membership pinned by exhaustive
 * `Record<Union, …>` maps (a widened/narrowed enum fails to compile) plus
 * runtime coverage + real classifier semantics mirroring the pages that
 * branch on them, so an enum drift can't pass silently.
 */

import { describe, it, expect } from 'vitest';

import { camelCaseKeys } from '@/lib/resilience';
import type {
  AuditActionsResponse,
  AuditCategoriesResponse,
  AuditChainVerifyResponse,
  AuditLogListResponse,
  AuditLogQueryParams,
  AuditLogRow,
  DiskForecastResponse,
  DiskForecastSeverity,
  GDPRArtifactStatus,
  GDPRExportArtifact,
  HypertableSize,
  SchemaDrift,
  SchemaDriftResponse,
  SchemaFingerprint,
  SecretRotationResponse,
  SecretRotationSeverity,
  SecretRotationStatus,
  SlowQueriesResponse,
  SlowQueryOrderBy,
  SlowQueryRow,
  VehicleCostResponse,
  VehicleCostRow,
  VehicleCostTotals,
} from './admin-operator-confidence';

/** Run a fixture through the real client transform and read it as a bag. */
function wire(payload: unknown): Record<string, unknown> {
  return camelCaseKeys(payload) as Record<string, unknown>;
}

/** Narrow an unknown bag member to a record for nested-key assertions. */
function bag(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Assert the transform kept `snake` and, when the key has an underscore,
 * added a camelCase mirror pointing at the same value. Digit-only keys such
 * as `sha256` have no underscore, so `snakeToCamel` returns them unchanged
 * and no second key is added — `expectMirror` proves that too.
 */
function expectMirror(
  wired: Record<string, unknown>,
  snake: string,
  camel: string,
  value: unknown,
): void {
  expect(wired[snake]).toEqual(value);
  expect(wired[camel]).toEqual(value);
}

// ---------------------------------------------------------------------------
// Schema drift — SchemaFingerprint, SchemaDrift, SchemaDriftResponse
// (internal/schemacheck.Drift + adminobssvc.SchemaDriftResult)
// ---------------------------------------------------------------------------

describe('schema drift wire contract', () => {
  const current: SchemaFingerprint = {
    sha256: 'aa11',
    table_count: 42,
    column_count: 380,
    index_count: 91,
  };
  const expected: SchemaFingerprint = {
    sha256: 'bb22',
    table_count: 41,
    column_count: 379,
    index_count: 90,
  };
  const drift: SchemaDrift = {
    has_drift: true,
    current,
    expected,
    table_count_delta: current.table_count - expected.table_count,
    column_count_delta: current.column_count - expected.column_count,
    index_count_delta: current.index_count - expected.index_count,
    expected_generated_at: '2026-01-01T00:00:00Z',
  };
  const response: SchemaDriftResponse = { drift, is_different: true };

  it('deltas are internally consistent with current vs expected counts', () => {
    expect(drift.table_count_delta).toBe(1);
    expect(drift.column_count_delta).toBe(1);
    expect(drift.index_count_delta).toBe(1);
  });

  it('exposes both key forms and round-trips the nested fingerprint', () => {
    const wired = wire(response);
    expectMirror(wired, 'is_different', 'isDifferent', true);
    const wDrift = bag(wired.drift);
    expectMirror(wDrift, 'has_drift', 'hasDrift', true);
    expectMirror(wDrift, 'table_count_delta', 'tableCountDelta', 1);
    expectMirror(wDrift, 'expected_generated_at', 'expectedGeneratedAt', '2026-01-01T00:00:00Z');
    const wCurrent = bag(wDrift.current);
    expectMirror(wCurrent, 'table_count', 'tableCount', 42);
  });

  it('leaves the digit-only `sha256` key without a redundant mirror', () => {
    const wired = wire(current);
    expect(wired.sha256).toBe('aa11');
    // snakeToCamel('sha256') === 'sha256' (no underscore), so the transform
    // adds no second key: sha256 + {table,column,index}_count × (snake+camel).
    expect(Object.keys(wired).sort()).toEqual([
      'columnCount',
      'column_count',
      'indexCount',
      'index_count',
      'sha256',
      'tableCount',
      'table_count',
    ]);
  });

  it('omits the optional expected_generated_at when the seed is unstamped', () => {
    const noStamp: SchemaDrift = { ...drift };
    delete noStamp.expected_generated_at;
    const wired = wire(noStamp);
    expect(wired).not.toHaveProperty('expected_generated_at');
    expect(wired.has_drift).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Slow queries — SlowQueryRow, SlowQueriesResponse, SlowQueryOrderBy
// ---------------------------------------------------------------------------

describe('slow queries wire contract', () => {
  const row: SlowQueryRow = {
    query_id: 7,
    fingerprint: 'SELECT * FROM signal_log WHERE $1',
    calls: 1200,
    total_time_ms: 4800.5,
    mean_time_ms: 4.0,
    max_time_ms: 88.25,
    rows_returned: 1200,
    shared_blks_hit: 9000,
    shared_blks_read: 12,
  };

  it('mirrors every metric key and preserves numeric precision', () => {
    const wired = wire(row);
    expectMirror(wired, 'query_id', 'queryId', 7);
    expectMirror(wired, 'total_time_ms', 'totalTimeMs', 4800.5);
    expectMirror(wired, 'mean_time_ms', 'meanTimeMs', 4.0);
    expectMirror(wired, 'max_time_ms', 'maxTimeMs', 88.25);
    expectMirror(wired, 'rows_returned', 'rowsReturned', 1200);
    expectMirror(wired, 'shared_blks_hit', 'sharedBlksHit', 9000);
  });

  it('carries a null pg_stat block counter through both key forms', () => {
    const sparse: SlowQueryRow = { ...row, shared_blks_hit: null, shared_blks_read: null };
    const wired = wire(sparse);
    expect(wired.shared_blks_hit).toBeNull();
    expect(wired.sharedBlksHit).toBeNull();
  });

  it('wraps rows under order_by + slow_queries exactly like the handler', () => {
    const response: SlowQueriesResponse = { order_by: 'mean_time', slow_queries: [row] };
    const wired = wire(response);
    expectMirror(wired, 'order_by', 'orderBy', 'mean_time');
    const rows = wired.slow_queries as unknown[];
    expect(rows).toHaveLength(1);
    expect(bag(rows[0]).mean_time_ms).toBe(4.0);
    expect(bag(rows[0]).meanTimeMs).toBe(4.0);
  });

  it('pins the SlowQueryOrderBy union to the four handler-accepted values', () => {
    const orderBys: SlowQueryOrderBy[] = ['mean_time', 'total_time', 'calls', 'max_time'];
    // A typed exhaustiveness map: adding/removing a member fails to compile.
    const label: Record<SlowQueryOrderBy, string> = {
      mean_time: 'Mean time',
      total_time: 'Total time',
      calls: 'Call count',
      max_time: 'Max time',
    };
    expect(Object.keys(label).sort()).toEqual([...orderBys].sort());
  });
});

// ---------------------------------------------------------------------------
// Vehicle cost — VehicleCostRow, VehicleCostTotals, VehicleCostResponse
// ---------------------------------------------------------------------------

describe('vehicle cost wire contract', () => {
  const row: VehicleCostRow = {
    vehicle_id: 3,
    display_name: 'Model 3',
    signal_row_count: 1_000_000,
    signal_bytes_est: 96_000_000,
    ingest_rate_per_minute_24h: 42.5,
    dlq_failures_24h: 4,
    last_seen_at: '2026-01-01T12:00:00Z',
  };
  const totals: VehicleCostTotals = {
    total_rows: 1_000_000,
    total_bytes_est: 96_000_000,
    total_rate_per_minute_24h: 42.5,
    total_failures_24h: 4,
  };

  it('mirrors keys that embed digits (24h suffixes) correctly', () => {
    const wired = wire(row);
    expectMirror(wired, 'ingest_rate_per_minute_24h', 'ingestRatePerMinute24h', 42.5);
    expectMirror(wired, 'dlq_failures_24h', 'dlqFailures24h', 4);
    expectMirror(wired, 'signal_bytes_est', 'signalBytesEst', 96_000_000);
    expectMirror(wired, 'last_seen_at', 'lastSeenAt', '2026-01-01T12:00:00Z');
  });

  it('carries a null display_name (unnamed vehicle) through untouched', () => {
    const wired = wire({ ...row, display_name: null });
    expect(wired.display_name).toBeNull();
    expect(wired.displayName).toBeNull();
  });

  it('nests vehicles + totals and mirrors the totals counters', () => {
    const response: VehicleCostResponse = { vehicles: [row], totals };
    const wired = wire(response);
    const wRows = wired.vehicles as unknown[];
    expect(wRows).toHaveLength(1);
    expect(bag(wRows[0]).vehicle_id).toBe(3);
    const wTotals = bag(wired.totals);
    expectMirror(wTotals, 'total_rows', 'totalRows', 1_000_000);
    expectMirror(wTotals, 'total_failures_24h', 'totalFailures24h', 4);
  });
});

// ---------------------------------------------------------------------------
// Disk forecast — HypertableSize, DiskForecastResponse, DiskForecastSeverity
// ---------------------------------------------------------------------------

describe('disk forecast wire contract', () => {
  const hypertable: HypertableSize = {
    hypertable_name: 'signal_log',
    total_bytes: 5_000_000_000,
    uncompressed_bytes: 4_000_000_000,
    compressed_bytes: 1_000_000_000,
    chunk_count: 120,
    growth_bytes_per_day: 250_000_000,
    est_days_to_quota: 30,
    severity: 'warn',
  };

  it('mirrors size + growth keys and round-trips the row array', () => {
    const response: DiskForecastResponse = { hypertables: [hypertable] };
    const wired = wire(response);
    const rows = wired.hypertables as unknown[];
    expect(rows).toHaveLength(1);
    const wRow = bag(rows[0]);
    expectMirror(wRow, 'hypertable_name', 'hypertableName', 'signal_log');
    expectMirror(wRow, 'growth_bytes_per_day', 'growthBytesPerDay', 250_000_000);
    expectMirror(wRow, 'est_days_to_quota', 'estDaysToQuota', 30);
  });

  it('carries a null est_days_to_quota (never fills to quota) through', () => {
    const wired = wire({ ...hypertable, est_days_to_quota: null });
    expect(wired.est_days_to_quota).toBeNull();
    expect(wired.estDaysToQuota).toBeNull();
  });

  it('pins DiskForecastSeverity and classifies actionable tiers', () => {
    const rank: Record<DiskForecastSeverity, number> = { ok: 0, warn: 1, critical: 2, unknown: 3 };
    expect(Object.keys(rank).sort()).toEqual(['critical', 'ok', 'unknown', 'warn']);
    const actionable = (sev: DiskForecastSeverity): boolean => sev === 'warn' || sev === 'critical';
    expect(actionable('ok')).toBe(false);
    expect(actionable('unknown')).toBe(false);
    expect(actionable('warn')).toBe(true);
    expect(actionable('critical')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Secret rotation — SecretRotationStatus, SecretRotationResponse, severity
// ---------------------------------------------------------------------------

describe('secret rotation wire contract', () => {
  const status: SecretRotationStatus = {
    kind: 'tesla_refresh_token',
    target_id: 'vehicle-3',
    last_rotated: '2025-11-01T00:00:00Z',
    age_days: 66,
    expires_at: '2026-02-01T00:00:00Z',
    days_to_expiry: 26,
    warn_days: 60,
    critical_days: 90,
    severity: 'warn',
    message: 'rotate before Feb',
  };

  it('mirrors rotation keys and nests items like the handler', () => {
    const response: SecretRotationResponse = { items: [status] };
    const wired = wire(response);
    const items = wired.items as unknown[];
    expect(items).toHaveLength(1);
    const wStatus = bag(items[0]);
    expectMirror(wStatus, 'last_rotated', 'lastRotated', '2025-11-01T00:00:00Z');
    expectMirror(wStatus, 'days_to_expiry', 'daysToExpiry', 26);
    expectMirror(wStatus, 'critical_days', 'criticalDays', 90);
    expectMirror(wStatus, 'target_id', 'targetId', 'vehicle-3');
  });

  it('carries a null expiry (non-expiring secret) and omits optionals', () => {
    const minimal: SecretRotationStatus = {
      kind: 'mqtt_mtls_cert',
      last_rotated: '2025-01-01T00:00:00Z',
      age_days: 400,
      expires_at: null,
      days_to_expiry: null,
      warn_days: 60,
      critical_days: 90,
      severity: 'critical',
    };
    const wired = wire(minimal);
    expect(wired.expires_at).toBeNull();
    expect(wired.days_to_expiry).toBeNull();
    expect(wired).not.toHaveProperty('target_id');
    expect(wired).not.toHaveProperty('message');
  });

  it('pins SecretRotationSeverity to the four rotation tiers', () => {
    const order: Record<SecretRotationSeverity, number> = { ok: 0, warn: 1, critical: 2, unknown: 3 };
    expect(Object.keys(order).sort()).toEqual(['critical', 'ok', 'unknown', 'warn']);
  });
});

// ---------------------------------------------------------------------------
// Audit log — AuditLogRow, AuditLogListResponse, categories/actions, verify,
// AuditLogQueryParams
// ---------------------------------------------------------------------------

describe('audit log wire contract', () => {
  const row: AuditLogRow = {
    id: 501,
    ts: '2026-01-02T03:04:05Z',
    actor: 'admin@example.com',
    category: 'security',
    action: 'api_key.revoke',
    entity_type: 'api_key',
    entity_id: 88,
    detail: 'revoked stale key',
    ip: '10.0.0.1',
    user_agent: 'Mozilla/5.0',
    before: '{"active":true}',
    after: '{"active":false}',
    trace_id: 'trace-xyz',
    prev_row_hash: 'deadbeef',
    row_hash: 'cafebabe',
    success: true,
  };

  it('mirrors multi-word audit keys and nests rows + limit', () => {
    const response: AuditLogListResponse = { rows: [row], limit: 100 };
    const wired = wire(response);
    expect(wired.limit).toBe(100);
    const rows = wired.rows as unknown[];
    const wRow = bag(rows[0]);
    expectMirror(wRow, 'entity_type', 'entityType', 'api_key');
    expectMirror(wRow, 'entity_id', 'entityId', 88);
    expectMirror(wRow, 'user_agent', 'userAgent', 'Mozilla/5.0');
    expectMirror(wRow, 'prev_row_hash', 'prevRowHash', 'deadbeef');
    expectMirror(wRow, 'row_hash', 'rowHash', 'cafebabe');
    expectMirror(wRow, 'trace_id', 'traceId', 'trace-xyz');
  });

  it('carries null chain-hash + nullable columns through untouched', () => {
    const genesis: AuditLogRow = {
      id: 1,
      ts: '2026-01-01T00:00:00Z',
      actor: 'system',
      action: 'boot',
      entity_type: 'system',
      category: null,
      entity_id: null,
      detail: null,
      ip: null,
      user_agent: null,
      before: null,
      after: null,
      trace_id: null,
      prev_row_hash: null,
      row_hash: 'genesis',
      success: null,
    };
    const wired = wire(genesis);
    expect(wired.prev_row_hash).toBeNull();
    expect(wired.category).toBeNull();
    expect(wired.success).toBeNull();
    expect(wired.row_hash).toBe('genesis');
  });

  it('models categories + actions dropdown responses as string arrays', () => {
    const cats: AuditCategoriesResponse = { categories: ['security', 'data', 'auth'] };
    const acts: AuditActionsResponse = { actions: ['api_key.revoke', 'vehicle.delete'] };
    expect(wire(cats).categories).toEqual(['security', 'data', 'auth']);
    expect(wire(acts).actions).toContain('vehicle.delete');
  });

  it('mirrors the chain-verify result keys the page reads', () => {
    const verify: AuditChainVerifyResponse = {
      intact: false,
      first_bad_id: 42,
      rows_checked: 1000,
      since: '2025-12-03T00:00:00Z',
      limit: 1000,
    };
    const wired = wire(verify);
    expect(wired.intact).toBe(false);
    expectMirror(wired, 'first_bad_id', 'firstBadId', 42);
    expectMirror(wired, 'rows_checked', 'rowsChecked', 1000);
  });

  it('serializes AuditLogQueryParams filters as snake_case query keys', () => {
    // Mirrors the shape buildAuditLogQuery() consumes: snake_case scalars and
    // comma-joinable string-array filters (DRY anti-pattern guard #8).
    const params: AuditLogQueryParams = {
      since: '2026-01-01T00:00:00Z',
      categories: ['security', 'auth'],
      actors: ['admin@example.com'],
      actions: ['api_key.revoke'],
      entity_type: 'api_key',
      entity_id: 0,
      limit: 50,
      offset: 0,
    };
    const qs = new URLSearchParams();
    qs.set('entity_type', params.entity_type ?? '');
    qs.set('categories', (params.categories ?? []).join(','));
    expect(qs.get('entity_type')).toBe('api_key');
    expect(qs.get('categories')).toBe('security,auth');
    // entity_id=0 is a valid filter — a truthiness check would drop it.
    expect(params.entity_id).toBe(0);
    expect(params.actors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// GDPR export — GDPRExportArtifact, GDPRArtifactStatus
// ---------------------------------------------------------------------------

describe('GDPR export wire contract', () => {
  const artifact: GDPRExportArtifact = {
    id: 'exp-123',
    user_id: 'user-9',
    status: 'complete',
    format: 'zip',
    bytes: 2048,
    sha256: 'abcdef',
    storage: 'local-fs',
    download_url: '/admin/gdpr/exports/exp-123/download',
    created_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:05:00Z',
    expires_at: '2026-01-08T00:00:00Z',
    error: null,
  };

  it('mirrors artifact keys and round-trips the download URL', () => {
    const wired = wire(artifact);
    expectMirror(wired, 'user_id', 'userId', 'user-9');
    expectMirror(
      wired,
      'download_url',
      'downloadUrl',
      '/admin/gdpr/exports/exp-123/download',
    );
    expectMirror(wired, 'completed_at', 'completedAt', '2026-01-01T00:05:00Z');
    expect(wired.status).toBe('complete');
  });

  it('carries the failed-artifact error string and omits optionals', () => {
    const failed: GDPRExportArtifact = {
      id: 'exp-9',
      status: 'failed',
      format: 'zip',
      created_at: '2026-01-01T00:00:00Z',
      error: 'extract timed out',
    };
    const wired = wire(failed);
    expect(wired.error).toBe('extract timed out');
    expect(wired).not.toHaveProperty('download_url');
    expect(wired).not.toHaveProperty('completed_at');
  });

  it('pins GDPRArtifactStatus and classifies download availability', () => {
    const statuses: GDPRArtifactStatus[] = ['queued', 'running', 'complete', 'failed', 'expired'];
    const badge: Record<GDPRArtifactStatus, string> = {
      queued: 'Queued',
      running: 'Running',
      complete: 'Complete',
      failed: 'Failed',
      expired: 'Expired',
    };
    expect(Object.keys(badge).sort()).toEqual([...statuses].sort());

    // Mirrors GDPRDownloadPanel's branch: in-flight statuses show "wait",
    // expired shows "expired", terminal states resolve to ready-or-failed.
    const downloadState = (s: GDPRArtifactStatus): 'wait' | 'expired' | 'terminal' =>
      s === 'queued' || s === 'running' ? 'wait' : s === 'expired' ? 'expired' : 'terminal';
    expect(downloadState('queued')).toBe('wait');
    expect(downloadState('running')).toBe('wait');
    expect(downloadState('expired')).toBe('expired');
    expect(downloadState('complete')).toBe('terminal');
    expect(downloadState('failed')).toBe('terminal');
  });
});
