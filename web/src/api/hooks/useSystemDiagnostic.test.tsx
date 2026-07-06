// useSystemDiagnostic hook-suite tests.
//
// Covers EVERY runtime export of useSystemDiagnostic.ts:
//   - diagnosticKeys              — stable, namespaced query-key tuples.
//   - useRunDiagnostic            — POST /system/diagnostic method/URL, the
//     resolved DiagnosticReport, the diagnosticKeys.last cache write on
//     success, the endpoint override, the no-double-/api/v1 regression guard,
//     and the error path (isError + exact error-toast wiring, no cache write).
//   - useLastDiagnostic          — undefined before any run, the cached report
//     after a successful run, and a directly-seeded cache read.
//   - formatDiagnosticReportText — the well-formed plain-text layout, the
//     detail/remediation omission branches, status upper-casing, and the
//     null-safety hardening (a nil Go slice marshals to JSON `null`, so an
//     unguarded `for…of report.checks` would throw at runtime).
//
// Network is stubbed at the request() boundary; the mutation-toast bridge is
// replaced with spies so onError assertions are exact and no ToastProvider /
// i18n instance is required (mirrors useFeedback.test.tsx / useDataRepair).
//
// Keep this test next to the hook — the gate's path-scoped checks match
// `api/hooks/useSystemDiagnostic` as a contiguous substring.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// Replace the toast bridge with spies so the onError assertion is exact and no
// ToastProvider / i18n instance is required.
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: successToast, error: errorToast }),
}));

import { request } from '@/api/client';
import {
  diagnosticKeys,
  useRunDiagnostic,
  useLastDiagnostic,
  formatDiagnosticReportText,
} from './useSystemDiagnostic';
import type { DiagnosticReport } from '../types';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

// A fresh QueryClient per test keeps caches isolated across cases; the module
// wrapper reads the `qc` that makeWrapper() creates.
function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

function buildReport(overrides?: Partial<DiagnosticReport>): DiagnosticReport {
  return {
    generated_at: '2026-07-04T10:00:00Z',
    overall_status: 'degraded',
    checks: [
      {
        id: 'db.ping',
        name: 'Database',
        status: 'ok',
        detail: 'SELECT 1 ok',
        duration_ms: 4,
      },
      {
        id: 'mqtt.conn',
        name: 'MQTT broker',
        status: 'fail',
        detail: 'no connection',
        remediation: 'Restart mosquitto',
        duration_ms: 12,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mockedRequest.mockReset();
  successToast.mockReset();
  errorToast.mockReset();
});

// ---------------------------------------------------------------------------
// diagnosticKeys
// ---------------------------------------------------------------------------

describe('diagnosticKeys', () => {
  it('exposes the stable root tuple', () => {
    expect(diagnosticKeys.root).toEqual(['system', 'diagnostic']);
  });

  it('namespaces the last-report key under the root', () => {
    expect(diagnosticKeys.last).toEqual(['system', 'diagnostic', 'last']);
    // The cache anchor must sit *under* the root so a root-scoped
    // invalidation would also clear the cached report.
    expect(diagnosticKeys.last.slice(0, diagnosticKeys.root.length)).toEqual(
      diagnosticKeys.root,
    );
    // Distinct identities — root and last must never collapse.
    expect(diagnosticKeys.last).not.toEqual(diagnosticKeys.root);
  });
});

// ---------------------------------------------------------------------------
// useRunDiagnostic
// ---------------------------------------------------------------------------

describe('useRunDiagnostic', () => {
  it('POSTs the default /system/diagnostic endpoint and resolves the report', async () => {
    const report = buildReport();
    mockedRequest.mockResolvedValueOnce(report);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRunDiagnostic(), { wrapper: Wrapper });

    const resolved = await result.current.mutateAsync();
    expect(resolved).toEqual(report);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(report);

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/system/diagnostic');
    expect(opts.method).toBe('POST');
    // The request() client auto-prepends /api/v1 — the hook URL must not.
    expect(url).not.toContain('/api/v1');
  });

  it('caches the resolved report under diagnosticKeys.last on success', async () => {
    const report = buildReport();
    mockedRequest.mockResolvedValueOnce(report);
    const { Wrapper, qc } = makeWrapper();
    const { result } = renderHook(() => useRunDiagnostic(), { wrapper: Wrapper });

    expect(qc.getQueryData(diagnosticKeys.last)).toBeUndefined();
    await result.current.mutateAsync();

    expect(qc.getQueryData(diagnosticKeys.last)).toEqual(report);
  });

  it('honours an explicit endpoint override (test-only escape hatch)', async () => {
    mockedRequest.mockResolvedValueOnce(buildReport());
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useRunDiagnostic({ endpoint: '/test/system/diagnostic' }),
      { wrapper: Wrapper },
    );

    await result.current.mutateAsync();

    expect(mockedRequest.mock.calls[0][0]).toBe('/test/system/diagnostic');
  });

  it('surfaces failures as isError, forwards the error to the toast bridge, and skips the cache write', async () => {
    const boom = new Error('HTTP 500: diagnostic on fire');
    mockedRequest.mockRejectedValueOnce(boom);
    const { Wrapper, qc } = makeWrapper();
    const { result } = renderHook(() => useRunDiagnostic(), { wrapper: Wrapper });

    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(boom);
    expect(errorToast).toHaveBeenCalledWith(
      boom,
      'toast.diagnostic.run.error',
      'Failed to run diagnostic',
    );
    expect(successToast).not.toHaveBeenCalled();
    // A failed run must not leave a stale report in the cache.
    expect(qc.getQueryData(diagnosticKeys.last)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// useLastDiagnostic
// ---------------------------------------------------------------------------

describe('useLastDiagnostic', () => {
  it('returns undefined until a diagnostic has run in this session', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useLastDiagnostic(), { wrapper: Wrapper });
    expect(result.current).toBeUndefined();
  });

  it('returns the cached report after a successful run against the same client', async () => {
    const report = buildReport();
    mockedRequest.mockResolvedValueOnce(report);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => ({ run: useRunDiagnostic(), last: useLastDiagnostic() }),
      { wrapper: Wrapper },
    );

    expect(result.current.last).toBeUndefined();

    await act(async () => {
      await result.current.run.mutateAsync();
    });

    await waitFor(() => expect(result.current.last).toEqual(report));
  });

  it('reflects a directly seeded diagnosticKeys.last cache entry', () => {
    const report = buildReport({ overall_status: 'ok' });
    const { Wrapper, qc } = makeWrapper();
    qc.setQueryData(diagnosticKeys.last, report);

    const { result } = renderHook(() => useLastDiagnostic(), { wrapper: Wrapper });
    expect(result.current).toEqual(report);
    expect(result.current?.overall_status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// formatDiagnosticReportText
// ---------------------------------------------------------------------------

describe('formatDiagnosticReportText', () => {
  it('renders the header, an upper-cased status line per check, and detail/remediation', () => {
    const text = formatDiagnosticReportText(buildReport());
    const lines = text.split('\n');

    expect(lines[0]).toBe('TeslaSync diagnostic report');
    expect(text).toContain('Generated: 2026-07-04T10:00:00Z');
    expect(text).toContain('Overall:   degraded');
    expect(text).toContain('Checks:');

    // Status is upper-cased; id + duration are rendered inline.
    expect(text).toContain('[OK] Database (db.ping) — 4ms');
    expect(text).toContain('[FAIL] MQTT broker (mqtt.conn) — 12ms');
    expect(text).not.toContain('[ok]');

    // The failing check carries its remediation; both detail lines appear.
    expect(text).toContain('detail:      SELECT 1 ok');
    expect(text).toContain('detail:      no connection');
    expect(text).toContain('remediation: Restart mosquitto');
  });

  it('omits the detail and remediation lines when they are absent/empty', () => {
    const text = formatDiagnosticReportText({
      generated_at: '2026-07-04T10:00:00Z',
      overall_status: 'ok',
      checks: [
        { id: 'redis.ping', name: 'Redis', status: 'ok', detail: '', duration_ms: 3 },
      ],
    });

    expect(text).toContain('[OK] Redis (redis.ping) — 3ms');
    expect(text).not.toContain('detail:');
    expect(text).not.toContain('remediation:');
  });

  it('does not throw when checks is a JSON null (Go nil slice) — the real bug', () => {
    // The backend marshals a nil `[]DiagnosticCheck` as `null`; an unguarded
    // `for…of report.checks` would throw "checks is not iterable".
    const nullChecks = {
      generated_at: '2026-07-04T10:00:00Z',
      overall_status: 'down',
      checks: null,
    } as unknown as DiagnosticReport;

    expect(() => formatDiagnosticReportText(nullChecks)).not.toThrow();
    const text = formatDiagnosticReportText(nullChecks);
    expect(text).toContain('Overall:   down');
    expect(text).toContain('Checks:');

    // The same guard must cover an undefined slice.
    const undefChecks = {
      generated_at: '2026-07-04T10:00:00Z',
      overall_status: 'ok',
    } as unknown as DiagnosticReport;
    expect(() => formatDiagnosticReportText(undefChecks)).not.toThrow();
  });

  it('substitutes placeholders for null report/check fields instead of printing "null"', () => {
    const weird = {
      generated_at: null,
      overall_status: null,
      checks: [
        { id: null, name: null, status: null, detail: 'partial', duration_ms: null },
      ],
    } as unknown as DiagnosticReport;

    const text = formatDiagnosticReportText(weird);
    expect(text).toContain('Generated: —');
    expect(text).toContain('Overall:   —');
    expect(text).toContain('[UNKNOWN] — (—) — 0ms');
    expect(text).not.toContain('null');
  });
});
