// useAdmin hook-layer tests.
//
// useAdmin.ts is the admin/dev-tools TanStack Query surface: API keys,
// request logs, backups, system health, maintenance mode, audit log,
// web-error summary, security events, DB/migration/pool introspection,
// export jobs and the vehicle state-machine debugger hooks.
//
// These tests exercise the contract each export exposes — the exact
// request path (no /api/v1 prefix, snake_case query params), that the
// AbortSignal is threaded through, safeArray coercion on the list
// hooks, the enabled-guard on the id-scoped hooks, mutation bodies +
// cache invalidation, URL-encoding of caller-supplied vehicle ids, and
// error pass-through — without standing up the whole admin page.
//
// Sibling-of-source location is mandatory: the elevation gate matches
// `api/hooks/useAdmin` as a contiguous path substring, which a
// __tests__/ subdir would interrupt.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { ApiError, request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import {
  adminKeys,
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  useRevokeApiKey,
  useApiLogs,
  useApiLogStats,
  useBackupConfigs,
  useBackupRuns,
  useSystemHealth,
  useMaintenanceState,
  useUpdateMaintenance,
  useAuditLogs,
  useWebErrorsSummary,
  useSecurityEvents,
  useDBStats,
  useMigrations,
  useConnectionPool,
  useExportJobs,
  useCreateExport,
  useVehicleStateMachine,
  useStateTimeline,
} from './useAdmin';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

/**
 * Fresh QueryClient + provider tree per test. Returns the client too so
 * mutation tests can spy on invalidateQueries. Mirrors the wrapper used
 * across the hook-layer suite (retry off, gcTime 0) plus a ToastProvider
 * because every mutation here routes through useMutationToast().
 */
function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return { qc, wrapper };
}

/** Reads back the [path, options] pair from the Nth request() call. */
function callArgs(n = 0): [string, { method?: string; body?: unknown; signal?: unknown }] {
  const call = mockedRequest.mock.calls[n];
  return call as [string, { method?: string; body?: unknown; signal?: unknown }];
}

beforeEach(() => {
  mockedRequest.mockReset();
});

// ---------------------------------------------------------------------------
// adminKeys — query-key factory
// ---------------------------------------------------------------------------

describe('adminKeys', () => {
  it('exposes stable static key tuples', () => {
    expect(adminKeys.apiKeys).toEqual(['api-keys']);
    expect(adminKeys.apiLogStats).toEqual(['api-log-stats']);
    expect(adminKeys.systemHealth).toEqual(['system-health']);
    expect(adminKeys.webErrorsSummary).toEqual(['admin', 'web-errors-summary']);
    expect(adminKeys.maintenance).toEqual(['admin', 'maintenance']);
  });

  it('derives per-argument key tuples that vary with their input', () => {
    expect(adminKeys.apiLogs(3)).toEqual(['api-logs', 3]);
    expect(adminKeys.apiLogs(3)).not.toEqual(adminKeys.apiLogs(4));
    expect(adminKeys.securityEvents('42')).toEqual(['security-events', '42']);
    expect(adminKeys.vehicleState('7')).toEqual(['vehicle-state', '7']);
    expect(adminKeys.stateTimeline('7')).toEqual(['state-timeline', '7']);
  });
});

// ---------------------------------------------------------------------------
// API keys — list + create/delete/revoke mutations
// ---------------------------------------------------------------------------

describe('useApiKeys', () => {
  it('GETs /api-keys and threads the AbortSignal', async () => {
    mockedRequest.mockResolvedValueOnce([
      { id: 'k1', name: 'CI', keyPrefix: 'tsk_ab', permissions: 'read-write' },
    ]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiKeys(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [path, opts] = callArgs();
    expect(path).toBe('/api-keys');
    expect(opts).toMatchObject({ signal: expect.any(AbortSignal) });
    expect(result.current.data?.[0].id).toBe('k1');
  });

  it('coerces a non-array payload to [] via safeArray', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiKeys(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useCreateApiKey', () => {
  it('POSTs the name/permissions body and invalidates the list', async () => {
    mockedRequest.mockResolvedValueOnce({
      id: 'k9',
      name: 'deploy',
      keyPrefix: 'tsk_zz',
      permissions: 'admin',
      key: 'tsk_zz_secret',
    });
    const { qc, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateApiKey(), { wrapper });

    await act(async () => {
      const created = await result.current.mutateAsync({ name: 'deploy', permissions: 'admin' });
      expect(created.key).toBe('tsk_zz_secret');
    });

    const [path, opts] = callArgs();
    expect(path).toBe('/api-keys');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ name: 'deploy', permissions: 'admin' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: adminKeys.apiKeys });
  });

  it('rejects and surfaces the error when the POST fails', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('nope', 500));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateApiKey(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ name: 'x', permissions: 'read' }),
      ).rejects.toThrow('nope');
    });
  });
});

describe('useDeleteApiKey', () => {
  it('DELETEs /api-keys/{id} and invalidates the list', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { qc, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteApiKey(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('k1');
    });
    const [path, opts] = callArgs();
    expect(path).toBe('/api-keys/k1');
    expect(opts.method).toBe('DELETE');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: adminKeys.apiKeys });
  });
});

describe('useRevokeApiKey', () => {
  it('POSTs /api-keys/{id}/revoke', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRevokeApiKey(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('k2');
    });
    const [path, opts] = callArgs();
    expect(path).toBe('/api-keys/k2/revoke');
    expect(opts.method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// API call logs + stats
// ---------------------------------------------------------------------------

describe('useApiLogs', () => {
  it('GETs the paged /api-logs endpoint with the fixed limit', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: 'l1', method: 'GET', url: '/x', statusCode: 200 }]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiLogs(2), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/api-logs?page=2&limit=25');
    expect(result.current.data?.[0].id).toBe('l1');
  });

  it('scopes its query key to the page so pages cache independently', () => {
    expect(adminKeys.apiLogs(1)).not.toEqual(adminKeys.apiLogs(2));
  });
});

describe('useApiLogStats', () => {
  it('GETs /api-logs/stats and returns the stats object', async () => {
    mockedRequest.mockResolvedValueOnce({
      totalCalls: 10,
      errorRate: 0.1,
      avgDurationMs: 42,
      last24h: 5,
      errorCount: 1,
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiLogStats(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/api-logs/stats');
    expect(result.current.data?.totalCalls).toBe(10);
    expect(result.current.data?.errorCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

describe('useBackupConfigs', () => {
  it('GETs /backup/configs and passes an array through', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: 'b1', name: 'nightly', enabled: true }]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useBackupConfigs(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/backup/configs');
    expect(result.current.data).toHaveLength(1);
  });
});

describe('useBackupRuns', () => {
  it('GETs /backup/runs and coerces a missing payload to []', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useBackupRuns(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/backup/runs');
    expect(result.current.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------

describe('useSystemHealth', () => {
  it('GETs /system/health and returns the resolved status view', async () => {
    mockedRequest.mockResolvedValueOnce({
      status: 'degraded',
      components: {},
      databaseSize: '1 GB',
      tableCount: 12,
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSystemHealth(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/system/health');
    expect(result.current.data?.status).toBe('degraded');
    expect(result.current.data?.tableCount).toBe(12);
  });

  it('surfaces transport failures as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('Service Unavailable', 503));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSystemHealth(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Maintenance mode (persisted state + operator override)
// ---------------------------------------------------------------------------

describe('useMaintenanceState', () => {
  it('GETs /admin/maintenance and returns the system_state row', async () => {
    mockedRequest.mockResolvedValueOnce({
      mode: 'maintenance',
      maintenance_message: 'brb',
      source: 'db',
      updated_at: '2025-01-01T00:00:00Z',
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useMaintenanceState(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/admin/maintenance');
    expect(result.current.data?.mode).toBe('maintenance');
    expect(result.current.data?.source).toBe('db');
  });
});

describe('useUpdateMaintenance', () => {
  it('POSTs the normalized body and invalidates BOTH maintenance and health', async () => {
    mockedRequest.mockResolvedValueOnce({
      mode: 'degraded',
      source: 'db',
      updated_at: '2025-01-02T00:00:00Z',
    });
    const { qc, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateMaintenance(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        mode: 'degraded',
        message: 'reduced service',
        until: '2025-01-03T00:00:00Z',
      });
    });

    const [path, opts] = callArgs();
    expect(path).toBe('/admin/maintenance');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({
      mode: 'degraded',
      message: 'reduced service',
      until: '2025-01-03T00:00:00Z',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: adminKeys.maintenance });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: adminKeys.systemHealth });
  });

  it('defaults an omitted message to "" and an omitted until to null', async () => {
    mockedRequest.mockResolvedValueOnce({
      mode: 'ok',
      source: 'db',
      updated_at: '2025-01-02T00:00:00Z',
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateMaintenance(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ mode: 'ok' });
    });
    expect(JSON.parse(callArgs()[1].body as string)).toEqual({
      mode: 'ok',
      message: '',
      until: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Audit log + web-error summary
// ---------------------------------------------------------------------------

describe('useAuditLogs', () => {
  it('GETs /system/audit and passes the array through safeArray', async () => {
    mockedRequest.mockResolvedValueOnce([
      { id: 'a1', action: 'delete', resource: 'vehicle', details: '', createdAt: 'now' },
    ]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useAuditLogs(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/system/audit');
    expect(result.current.data?.[0].action).toBe('delete');
  });
});

describe('useWebErrorsSummary', () => {
  it('GETs /admin/web-errors/summary and returns the rolling summary', async () => {
    mockedRequest.mockResolvedValueOnce({
      window_seconds: 3600,
      windowSeconds: 3600,
      total: 4,
      top: [{ name: 'TypeError', route: '/drives', count: 3 }],
      as_of: 't',
      asOf: 't',
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useWebErrorsSummary(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/admin/web-errors/summary');
    expect(result.current.data?.total).toBe(4);
    expect(result.current.data?.top[0].name).toBe('TypeError');
  });
});

// ---------------------------------------------------------------------------
// Security events (id-scoped, enabled-guarded, encoded query param)
// ---------------------------------------------------------------------------

describe('useSecurityEvents', () => {
  it('GETs /security with a snake_case vehicle_id query param', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: 's1', locked: true, createdAt: 'now' }]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSecurityEvents('42'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/security?vehicle_id=42');
    expect(result.current.data?.[0].locked).toBe(true);
  });

  it('URL-encodes a vehicle id that carries reserved characters', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const { wrapper } = makeWrapper();
    renderHook(() => useSecurityEvents('7 8&x=1'), { wrapper });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callArgs()[0]).toBe('/security?vehicle_id=7%208%26x%3D1');
  });

  it('is disabled (never fires) when the vehicle id is empty', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSecurityEvents(''), { wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('coerces a non-array payload to [] via safeArray', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSecurityEvents('42'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Dev-tools introspection: DB stats, migrations, connection pool
// ---------------------------------------------------------------------------

describe('useDBStats', () => {
  it('GETs /dev-tools/db-stats', async () => {
    mockedRequest.mockResolvedValueOnce({ tables: [], tableCount: 0, databaseSize: '0 B' });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDBStats(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/dev-tools/db-stats');
    expect(result.current.data?.databaseSize).toBe('0 B');
  });
});

describe('useMigrations', () => {
  it('GETs /dev-tools/migration-status', async () => {
    mockedRequest.mockResolvedValueOnce({
      currentVersion: '000185',
      dirty: false,
      pending: 0,
      migrations: [],
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useMigrations(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/dev-tools/migration-status');
    expect(result.current.data?.currentVersion).toBe('000185');
    expect(result.current.data?.dirty).toBe(false);
  });
});

describe('useConnectionPool', () => {
  it('GETs /dev-tools/runtime-info', async () => {
    mockedRequest.mockResolvedValueOnce({
      maxOpen: 25,
      open: 3,
      inUse: 1,
      idle: 2,
      waitCount: 0,
      waitDurationMs: 0,
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useConnectionPool(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/dev-tools/runtime-info');
    expect(result.current.data?.maxOpen).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Export jobs (list + create)
// ---------------------------------------------------------------------------

describe('useExportJobs', () => {
  it('GETs /export/jobs and passes the array through', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: 'e1', type: 'drives', format: 'csv', status: 'ready' }]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useExportJobs(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/export/jobs');
    expect(result.current.data?.[0].status).toBe('ready');
  });
});

describe('useCreateExport', () => {
  it('POSTs /exports with the camelCase body the backend DTO expects', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 'e2', type: 'charging', format: 'json', status: 'queued' });
    const { qc, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateExport(), { wrapper });

    await act(async () => {
      const job = await result.current.mutateAsync({ type: 'charging', format: 'json', vehicleId: '7' });
      expect(job.id).toBe('e2');
    });

    const [path, opts] = callArgs();
    expect(path).toBe('/exports');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({
      type: 'charging',
      format: 'json',
      vehicleId: '7',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: adminKeys.exportJobs });
  });
});

// ---------------------------------------------------------------------------
// Vehicle state-machine debugger hooks (id-scoped, encoded path/param)
// ---------------------------------------------------------------------------

describe('useVehicleStateMachine', () => {
  it('GETs /vehicles/{id}/state when a vehicle id is present', async () => {
    mockedRequest.mockResolvedValueOnce({ state: 'driving', since: 'now', vehicleId: '7' });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehicleStateMachine('7'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/vehicles/7/state');
    expect(result.current.data?.state).toBe('driving');
  });

  it('URL-encodes the vehicle id in the path segment', async () => {
    mockedRequest.mockResolvedValueOnce({ state: 'asleep', since: 'now', vehicleId: 'a/b' });
    const { wrapper } = makeWrapper();
    renderHook(() => useVehicleStateMachine('a/b'), { wrapper });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callArgs()[0]).toBe('/vehicles/a%2Fb/state');
  });

  it('is disabled when the vehicle id is empty', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehicleStateMachine(''), { wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useStateTimeline', () => {
  it('GETs the timeline endpoint with the default 7-day window', async () => {
    mockedRequest.mockResolvedValueOnce({ transitions: [{ state: 'parked' }] });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useStateTimeline('7'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/vehicle-states/timeline?vehicle_id=7&days=7');
    expect(result.current.data?.transitions).toHaveLength(1);
  });

  it('threads a custom day window and encodes the vehicle id', async () => {
    mockedRequest.mockResolvedValueOnce({ transitions: [] });
    const { wrapper } = makeWrapper();
    renderHook(() => useStateTimeline('a b', 30), { wrapper });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(callArgs()[0]).toBe('/vehicle-states/timeline?vehicle_id=a%20b&days=30');
  });

  it('is disabled when the vehicle id is empty', async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useStateTimeline(''), { wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('surfaces the deprecated route 404 gracefully via error', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('Not Found', 404));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useStateTimeline('7'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(404);
  });
});
