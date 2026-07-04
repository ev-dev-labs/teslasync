// useSystemDiagnostic
//
// Mutation hook that POSTs to /system/diagnostic and returns the
// aggregated DiagnosticReport. Implemented as a mutation (not a query)
// because the request is operator-initiated, expensive, and never
// auto-runs — the page only fires it when the user clicks "Run".
//
// On success we cache the report under the diagnosticKeys.last query
// key so the page can survive a Strict-Mode unmount/remount without
// losing the most recent run. On error we emit a toast so the failure
// is visible even if the page is unmounted before the catch resolves.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import type { DiagnosticReport } from '../types';

export const diagnosticKeys = {
  root: ['system', 'diagnostic'] as const,
  last: ['system', 'diagnostic', 'last'] as const,
};

export interface UseRunDiagnosticOptions {
  /**
   * Override the default endpoint. Used by tests to point at a stub
   * server. Production callers must omit this.
   */
  endpoint?: string;
}

/**
 * useRunDiagnostic exposes a mutation that posts to the aggregated
 * diagnostic endpoint. Consumers call `mutate()` (no args) — the
 * resulting `DiagnosticReport` lands in `data` and is cached under
 * diagnosticKeys.last for cross-render persistence.
 */
export function useRunDiagnostic(options: UseRunDiagnosticOptions = {}) {
  const qc = useQueryClient();
  const { error } = useMutationToast();
  const endpoint = options.endpoint ?? '/system/diagnostic';

  return useMutation<DiagnosticReport, Error, void>({
    mutationFn: () => request<DiagnosticReport>(endpoint, { method: 'POST' }),
    onSuccess: (report) => {
      qc.setQueryData<DiagnosticReport>(diagnosticKeys.last, report);
    },
    onError: (e) =>
      error(e, 'toast.diagnostic.run.error', 'Failed to run diagnostic'),
  });
}

/**
 * Convenience hook to read the most recent report without re-running
 * the diagnostic. Returns `undefined` until the user fires at least
 * one successful run in this session.
 */
export function useLastDiagnostic(): DiagnosticReport | undefined {
  const qc = useQueryClient();
  return qc.getQueryData<DiagnosticReport>(diagnosticKeys.last);
}

/**
 * Serialize a report to a plain-text format suitable for paste-into-
 * support-ticket. Exported here (not inside the page) so it stays
 * pure / testable / re-usable from a CLI script if we ever ship one.
 */
export function formatDiagnosticReportText(report: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push('TeslaSync diagnostic report');
  lines.push(`Generated: ${report.generated_at ?? '—'}`);
  lines.push(`Overall:   ${report.overall_status ?? '—'}`);
  lines.push('');
  lines.push('Checks:');
  // Go marshals a nil `[]DiagnosticCheck` slice as JSON `null`, so `checks`
  // can be null/undefined at runtime even though the type says otherwise.
  // Guard the iteration (and each field) so a support-ticket export never
  // throws "checks is not iterable" on an empty or degraded report.
  const checks = report.checks ?? [];
  for (const c of checks) {
    const status = String(c.status ?? 'unknown').toUpperCase();
    const durationMs = c.duration_ms ?? 0;
    lines.push(`  [${status}] ${c.name ?? '—'} (${c.id ?? '—'}) — ${durationMs}ms`);
    if (c.detail) lines.push(`    detail:      ${c.detail}`);
    if (c.remediation) lines.push(`    remediation: ${c.remediation}`);
  }
  lines.push('');
  return lines.join('\n');
}
