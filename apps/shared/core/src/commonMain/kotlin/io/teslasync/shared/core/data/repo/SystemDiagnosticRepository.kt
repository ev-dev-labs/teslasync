package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.systemdiagnostic.DiagnosticReport

/**
 * The S7 data port for the aggregated self-test — the cross-platform analogue of the web
 * `useSystemDiagnostic` hook domain (web/src/api/hooks/useSystemDiagnostic.ts), mounted at
 * `/api/v1/system/diagnostic`. Every native diagnostic surface (Android/Apple via KMP, Windows via
 * the C# port) reaches the backend exclusively through this interface, so a single fake stands in
 * for the whole domain in the S8 state-holder tests.
 *
 * The domain is a SINGLE mutation (the web `useRunDiagnostic` is a `useMutation`, not a `useQuery`):
 * the report is expensive and operator-initiated, so it never auto-runs and there is no
 * cache-then-network read at this layer. The web hook's companion `useLastDiagnostic` is NOT a
 * network read — it is a pure `queryClient.getQueryData(diagnosticKeys.last)` peek at the last
 * successful run; its KMP analogue is the observable "last report" state the S8 store exposes
 * ([io.teslasync.shared.core.presentation.systemdiagnostic.SystemDiagnosticStore.lastReport]), not
 * a method on this port.
 *
 * The web hook's `onSuccess` does exactly one thing — `setQueryData(diagnosticKeys.last, report)`;
 * it does NOT call `invalidateQueries`, so this port has no cache to flush. The report is decoded
 * directly off the wire (the web hook calls the plain `request<DiagnosticReport>` with no `{data:T}`
 * unwrap). No field is display-unit-bearing, so the payload round-trips verbatim with no SI
 * conversion (S5).
 */
public interface SystemDiagnosticRepository {
    /**
     * `POST /system/diagnostic` with no body — runs every probe and returns the aggregated
     * [DiagnosticReport] (web `useRunDiagnostic`). A transport/HTTP failure surfaces as a
     * non-throwing `Result.failure`; on success the S8 store primes its last-report state (the web
     * `setQueryData(diagnosticKeys.last, …)` analogue). Nothing is invalidated.
     */
    public suspend fun runDiagnostic(): Result<DiagnosticReport>
}

/**
 * The web `diagnosticKeys.root` tuple flattened (`['system', 'diagnostic']`). The diagnostic keys
 * are flat parents the web hook primes with `setQueryData`; their KMP analogue is the "last report"
 * state the S8 store exposes, but the key strings are mirrored here so the C# port and KMP agree on
 * the cache namespace. Locked by golden vectors shared with the C# port.
 */
public const val SYSTEM_DIAGNOSTIC_PREFIX: String = "system:diagnostic"

/**
 * Cache key for the last diagnostic report — the web `diagnosticKeys.last`
 * (`['system', 'diagnostic', 'last']`), the key the run hook primes via `setQueryData` and the
 * companion `useLastDiagnostic` reads via `getQueryData`. Its KMP analogue is the observable "last
 * report" state the S8 store exposes. Locked by golden vectors shared with the C# port.
 */
public fun systemDiagnosticLastKey(): String = "$SYSTEM_DIAGNOSTIC_PREFIX:last"
