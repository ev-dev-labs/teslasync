// The data port the DiagnosticPage surface binds to (P1/S8), plus its production binding over the shared-core
// SystemDiagnosticStore. The view (composable) performs NO HTTP — it only invokes the run action through the
// view-model, which delegates to this seam, reproducing the web page's single read
// (web/src/features/system/pages/DiagnosticPage.tsx): the `useRunDiagnostic` mutation (`POST /system/diagnostic`).
//
// The web domain is one `useMutation` (`useRunDiagnostic`) plus a pure cache-peek (`useLastDiagnostic`) and a pure
// formatter (`formatDiagnosticReportText`). The store already owns all three (it primes its `lastReport` on success
// and the formatter is a free function in the shared core), so this seam exposes only the single run mutation the
// page actually calls — the last-report survival across recomposition/config changes is provided by the ViewModel's
// own lifecycle-scoped state, not a second source of truth. Narrow the seam so the view-model + page depend on an
// abstraction (the real store in production, a fake in tests), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located production-binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.diagnostic

import io.teslasync.shared.core.presentation.systemdiagnostic.DiagnosticReport
import io.teslasync.shared.core.presentation.systemdiagnostic.SystemDiagnosticStore

/**
 * The seam the DiagnosticPage surface depends on so it binds to an abstraction (the shared SystemDiagnosticStore in
 * production, a fake in tests), never to a concrete store or the network. The single capability is the aggregated
 * self-test run — the web `useRunDiagnostic` mutation. No HTTP touches the view.
 */
interface DiagnosticPageSource {
    /**
     * Runs the aggregated self-test (web `useRunDiagnostic.mutate`) and returns the resolved [DiagnosticReport], or a
     * non-throwing `Result.failure` on a transport/HTTP error (web `onError` → `latestError`). Operator-initiated and
     * expensive, so it is never called on mount.
     */
    suspend fun runDiagnostic(): Result<DiagnosticReport>
}

/**
 * Binds the surface to the shared **S8** [SystemDiagnosticStore] — the single holder every native diagnostic surface
 * routes through. The store's `runDiagnostic` POSTs through the resilient client and primes its own last-report state
 * on success; this binding forwards the run verbatim so the view-model renders the full phase matrix (idle / running
 * / loaded / failed). No HTTP touches the view.
 */
fun diagnosticPageSourceOf(store: SystemDiagnosticStore): DiagnosticPageSource =
    object : DiagnosticPageSource {
        override suspend fun runDiagnostic(): Result<DiagnosticReport> = store.runDiagnostic()
    }
