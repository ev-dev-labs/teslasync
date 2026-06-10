package io.teslasync.shared.core.net

import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import kotlinx.serialization.Serializable

/** Minimal DTO used to exercise JSON content negotiation in the client tests. */
@Serializable
internal data class Sample(
    val name: String,
    val count: Int,
)

/** `Content-Type: application/json` so ContentNegotiation decodes mock responses. */
internal val jsonHeaders: Headers = headersOf(HttpHeaders.ContentType, "application/json")

/**
 * Deterministic [Scheduler] for tests: [sleep] records the requested duration and
 * advances [current] instead of waiting, so backoff and breaker windows are driven
 * with zero real time. Tests may also advance [current] directly to elapse the
 * breaker's open window.
 */
internal class VirtualScheduler(
    var current: Long = 0L,
) : Scheduler {
    val sleeps: MutableList<Long> = mutableListOf()

    override fun nowMillis(): Long = current

    override suspend fun sleep(millis: Long) {
        sleeps += millis
        current += millis
    }
}

/** Builds an [ApiClientConfig] with test-friendly, fully deterministic defaults. */
internal fun testConfig(
    scheduler: Scheduler = VirtualScheduler(),
    maxRetries: Int = 1,
    tokenProvider: TokenProvider = NoopTokenProvider,
    breakerFailureThreshold: Int = 5,
    breakerOpenMillis: Long = 30_000,
    requestTimeoutMillis: Long = 15_000,
    baseRetryDelayMillis: Long = 1_000,
    maxRetryDelayMillis: Long = 30_000,
    // Fixed jitter (0.5) → backoff multiplier of exactly 1.0 for deterministic delays.
    random: () -> Double = { 0.5 },
): ApiClientConfig =
    ApiClientConfig(
        baseUrl = "https://api.test",
        maxRetries = maxRetries,
        baseRetryDelayMillis = baseRetryDelayMillis,
        maxRetryDelayMillis = maxRetryDelayMillis,
        requestTimeoutMillis = requestTimeoutMillis,
        breakerFailureThreshold = breakerFailureThreshold,
        breakerOpenMillis = breakerOpenMillis,
        tokenProvider = tokenProvider,
        scheduler = scheduler,
        random = random,
    )
