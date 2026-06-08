package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.safeRequest
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Instant

/**
 * HTTP-backed [ApiHealthRepository] over the resilient [ApiHttpClient].
 *
 * Mirrors the web `useApiHealth` `probe()` helper (web/src/api/hooks/useApiHealth.ts):
 *  - hits the API server *root* `/healthz` (`versioned = false`) — NOT the `/api/v1`
 *    namespace — so the call lands on the liveness endpoint rather than a 404;
 *  - reads the response as raw text so a 2xx is judged on status alone (the body shape is
 *    irrelevant to liveness), reproducing the web `res.ok` semantics;
 *  - times the round-trip with the injected [Clock] and records it on BOTH the success and
 *    the failure branch, exactly as the web helper times its `try` and `catch`;
 *  - swallows every [io.teslasync.shared.core.net.ApiError] into `ok = false` (the
 *    non-throwing [safeRequest] does this), so an unreachable/erroring server resolves to an
 *    offline probe instead of an exception — coroutine cancellation alone still propagates.
 *
 * There is no cache and no invalidation surface here: the web hook neither caches nor mutates.
 *
 * @property api the resilient shared HTTP client (S4).
 * @property clock wall-clock seam used for both the latency span and the completion stamp;
 *   injected so tests measure deterministic latency with no real waiting.
 */
public class HttpApiHealthRepository(
    private val api: ApiHttpClient,
    private val clock: Clock = SystemClock,
) : ApiHealthRepository {
    override suspend fun probe(): ApiHealthProbe {
        val start = clock.nowMillis()
        val ok =
            try {
                api.safeRequest<String>(path = HEALTH_PATH, versioned = false).isSuccess
            } catch (e: CancellationException) {
                throw e
            }
        val end = clock.nowMillis()
        return ApiHealthProbe(
            ok = ok,
            latencyMs = (end - start).coerceAtLeast(0),
            checkedAt = Instant.fromEpochMilliseconds(end).toString(),
        )
    }

    private companion object {
        // Root liveness endpoint — deliberately outside the `/api/v1` version segment.
        const val HEALTH_PATH = "/healthz"
    }
}
