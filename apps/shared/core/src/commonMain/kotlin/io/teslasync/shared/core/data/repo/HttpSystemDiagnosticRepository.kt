package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.systemdiagnostic.DiagnosticReport

/**
 * HTTP-backed [SystemDiagnosticRepository] over the resilient [ApiHttpClient] (ADR-006). The single
 * surface is a mutation (web `useRunDiagnostic`), so this port keeps no cache-then-network read and
 * — mirroring the web hook's `onSuccess`, which only `setQueryData`s the last report and never
 * `invalidateQueries` — flushes nothing. It POSTs and returns a non-throwing [Result].
 *
 * The request carries NO body: the web hook calls `request(endpoint, { method: 'POST' })` with no
 * payload, so [runDiagnostic] issues a bodyless POST to match the wire exactly (the backend's
 * `apidiag.Handler` reads no request body). The endpoint is the version-namespaced
 * `/system/diagnostic`; the resilient client adds the `/api/v1` prefix exactly once. The aggregated
 * [DiagnosticReport] is decoded directly off the wire (no `{data:T}` envelope), and no field is
 * display-unit-bearing, so the payload round-trips verbatim with no SI conversion (S5).
 */
public class HttpSystemDiagnosticRepository(
    private val api: ApiHttpClient,
) : SystemDiagnosticRepository {
    override suspend fun runDiagnostic(): Result<DiagnosticReport> =
        api.safeRequest<DiagnosticReport>(
            method = HttpMethodKind.POST,
            path = DIAGNOSTIC_PATH,
        )

    private companion object {
        const val DIAGNOSTIC_PATH = "/system/diagnostic"
    }
}
