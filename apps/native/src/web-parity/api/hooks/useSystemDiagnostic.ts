// useSystemDiagnostic
//
// Mutation hook that POSTs to /system/diagnostic and returns the aggregated
// DiagnosticReport. Implemented as a mutation because the request is
// operator-initiated, expensive, and should never auto-run.
//
// On success we cache the report under diagnosticKeys.last so screens survive
// unmount/remount without losing the most recent run. On error we use the
// native-safe mutation toast bridge, which currently surfaces Alert feedback.

import {useMutation, useQueryClient} from '@tanstack/react-query';

import {request} from '../client';
import type {DiagnosticReport} from '../../../api/types';
import {useMutationToast} from './_toastHelpers';

export const diagnosticKeys = {
  root: ['system', 'diagnostic'] as const,
  last: ['system', 'diagnostic', 'last'] as const,
};

export interface UseRunDiagnosticOptions {
  /**
   * Override the default endpoint. Used by tests to point at a stub server.
   * Production callers must omit this.
   */
  endpoint?: string;
}

/**
 * useRunDiagnostic exposes a mutation that posts to the aggregated diagnostic
 * endpoint. Consumers call `mutate()` (no args); the resulting
 * `DiagnosticReport` lands in `data` and is cached under diagnosticKeys.last
 * for cross-render persistence.
 */
export function useRunDiagnostic(options: UseRunDiagnosticOptions = {}) {
  const qc = useQueryClient();
  const {error} = useMutationToast();
  const endpoint = options.endpoint ?? '/system/diagnostic';

  return useMutation<DiagnosticReport, Error, void>({
    mutationFn: () => request<DiagnosticReport>(endpoint, {method: 'POST'}),
    onSuccess: report => {
      qc.setQueryData<DiagnosticReport>(diagnosticKeys.last, report);
    },
    onError: e =>
      error(e, 'toast.diagnostic.run.error', 'Failed to run diagnostic'),
  });
}

/**
 * Convenience hook to read the most recent report without re-running the
 * diagnostic. Returns `undefined` until the user fires at least one successful
 * run in this session.
 */
export function useLastDiagnostic(): DiagnosticReport | undefined {
  const qc = useQueryClient();
  return qc.getQueryData<DiagnosticReport>(diagnosticKeys.last);
}

/**
 * Serialize a report to a plain-text format suitable for paste-into-support
 * tickets. Kept pure/testable/re-usable just like the web hook.
 */
export function formatDiagnosticReportText(report: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push('TeslaSync diagnostic report');
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Overall:   ${report.overall_status}`);
  lines.push('');
  lines.push('Checks:');
  for (const c of report.checks) {
    lines.push(
      `  [${c.status.toUpperCase()}] ${c.name} (${c.id}) \u2014 ${c.duration_ms}ms`,
    );
    if (c.detail) {
      lines.push(`    detail:      ${c.detail}`);
    }
    if (c.remediation) {
      lines.push(`    remediation: ${c.remediation}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
