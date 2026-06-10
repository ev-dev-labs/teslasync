package io.teslasync.shared.core.presentation.systemdiagnostic

import io.teslasync.shared.core.data.repo.SystemDiagnosticRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * UI-free shared state holder for the system-diagnostic feature — the cross-platform port of the web
 * `useSystemDiagnostic` hook domain (web/src/api/hooks/useSystemDiagnostic.ts). Every native
 * diagnostic surface (Android/Apple via KMP, Windows via the C# port) binds to this single holder
 * rather than re-implementing the endpoint, the last-report cache, or the formatter.
 *
 * The web domain is one `useMutation` (`useRunDiagnostic`) plus one cache-peek selector
 * (`useLastDiagnostic`) — there is NO `useQuery`, because the report is expensive and
 * operator-initiated, so it never auto-runs and there is no polling read / [Resource] feed here. The
 * run hook's `onSuccess` does exactly one thing: it primes `diagnosticKeys.last` with the report via
 * `setQueryData` (it does NOT `invalidateQueries`). The companion `useLastDiagnostic` simply reads
 * that key back via `getQueryData`, surviving a Strict-Mode unmount/remount without re-running.
 *
 * Both responsibilities collapse onto one observable field here:
 *  - [runDiagnostic] (web `useRunDiagnostic`) — `POST /system/diagnostic`, and on success writes the
 *    report into [lastReport] (the `setQueryData(diagnosticKeys.last, report)` analogue);
 *  - [lastReport] (web `useLastDiagnostic`) — the most recent successful report, or `null` before
 *    the first run in this session (the `getQueryData(diagnosticKeys.last)` analogue).
 *
 * The [formatDiagnosticReportText] helper stays a free function, not a method on this holder, so it
 * remains pure and golden-locked across the C# port. The holder makes no network calls itself; it
 * injects the S7 repository and mirrors the web hook's single-threaded usage — it is not internally
 * synchronised, so create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every run is routed through.
 */
public class SystemDiagnosticStore(
    private val repo: SystemDiagnosticRepository,
) {
    private val _lastReport = MutableStateFlow<DiagnosticReport?>(null)

    /**
     * The most recent successful diagnostic report (web `useLastDiagnostic` /
     * `diagnosticKeys.last`), or `null` before the first successful [runDiagnostic] in this session.
     * A screen renders the report — or its [formatDiagnosticReportText] dump — off this without
     * re-running the expensive probe set.
     */
    public val lastReport: StateFlow<DiagnosticReport?> = _lastReport.asStateFlow()

    /**
     * Runs the aggregated self-test (web `useRunDiagnostic`) and, on success, publishes the report
     * into [lastReport] — the `setQueryData(diagnosticKeys.last, report)` analogue. A failed run
     * surfaces as a `Result.failure` and leaves [lastReport] unchanged (the web `onError` path never
     * primes the cache).
     */
    public suspend fun runDiagnostic(): Result<DiagnosticReport> = repo.runDiagnostic().onSuccess { _lastReport.value = it }
}
