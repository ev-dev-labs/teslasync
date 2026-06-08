package io.teslasync.shared.core.data.repo

/**
 * One completed health probe of the backend root `/healthz` endpoint — the raw, undervied
 * measurement the web `useApiHealth` hook computes inside its `probe()` helper
 * (web/src/api/hooks/useApiHealth.ts). The coarse `ok | degraded | offline | unknown`
 * bucket is derived from this in the presentation layer, never here, so the data port stays
 * free of display policy.
 *
 * @property ok whether the server answered with a 2xx status. A non-2xx response, a transport
 *   failure, or no response within the probe deadline all yield `false` (⇒ `offline`).
 * @property latencyMs measured round-trip in whole milliseconds (always recorded, even for a
 *   failed probe, exactly as the web helper times both branches).
 * @property checkedAt ISO-8601 UTC timestamp of when the probe completed.
 */
public data class ApiHealthProbe(
    public val ok: Boolean,
    public val latencyMs: Long,
    public val checkedAt: String,
)

/**
 * The S7 data port for the API-health probe — the cross-platform analogue of the web
 * `useApiHealth` hook domain (web/src/api/hooks/useApiHealth.ts). Every native footer
 * status indicator (Android/Apple via KMP, Windows via the C# port) reaches the backend
 * exclusively through this interface, so a single fake stands in for the whole domain in the
 * S8 state-holder tests.
 *
 * Unlike the other S8 domains this is NOT a cache-then-network read: the web hook issues a
 * direct `fetch()` (bypassing the resilient `/api/v1` client) against the root `/healthz`
 * endpoint, times the round-trip, and never caches the result. The port mirrors that exactly
 * — a single suspend probe, no [Resource]/cache surface, and no invalidation (the web hook
 * has no mutations).
 */
public interface ApiHealthRepository {
    /**
     * Probes `GET /healthz` (at the API server *root*, not under `/api/v1`), measuring the
     * round-trip and reporting whether the server answered with a 2xx status. Never throws for
     * an unreachable or erroring server: a transport failure, a non-2xx status, or a timeout
     * all resolve to a probe with [ApiHealthProbe.ok] `= false` (coroutine cancellation still
     * propagates), reproducing the web helper's `try/catch` that returns an `ok: false` result
     * rather than rejecting.
     */
    public suspend fun probe(): ApiHealthProbe
}
