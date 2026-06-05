package io.teslasync.shared.core.net

import kotlinx.serialization.json.Json
import kotlin.random.Random

/**
 * HTTP verbs the client supports, tagged with idempotency. Only idempotent verbs
 * are eligible for transparent retry — mirrors the web policy ("max-retries on
 * GET/timeout/5xx") while never silently replaying a non-idempotent POST/PATCH.
 *
 * Deliberately a small, net-owned enum rather than Ktor's `HttpMethod` so the
 * public framework surface does not leak the transport library's types.
 */
public enum class HttpMethodKind(
    public val idempotent: Boolean,
) {
    GET(idempotent = true),
    HEAD(idempotent = true),
    OPTIONS(idempotent = true),
    PUT(idempotent = true),
    DELETE(idempotent = true),
    POST(idempotent = false),
    PATCH(idempotent = false),
}

/**
 * One API call's intent. [path] is given WITHOUT the `/api/v1` prefix (the client
 * adds it exactly once when [versioned] is true). [query] values are appended as
 * given — callers must use snake_case keys to match the backend contract; `null`
 * values are skipped.
 */
public class RequestSpec(
    public val method: HttpMethodKind = HttpMethodKind.GET,
    public val path: String,
    public val versioned: Boolean = true,
    public val query: Map<String, String?> = emptyMap(),
    public val body: Any? = null,
)

/**
 * Immutable, fully-resolved configuration for an [ApiHttpClient]. Build one via the
 * [ApiHttpClient] factory's [ApiHttpClientBuilder] DSL rather than constructing it
 * directly so defaults stay in one place.
 *
 * @property baseUrl scheme + host (+ optional port), e.g. `https://example.test`.
 *   A trailing slash is tolerated. The `/api/v1` version segment is added by the
 *   client, not here.
 * @property maxRetries additional attempts after the first for retryable failures
 *   on idempotent requests.
 * @property baseRetryDelayMillis first-retry backoff base; doubles per attempt.
 * @property maxRetryDelayMillis upper bound for a single backoff sleep.
 * @property requestTimeoutMillis per-attempt request timeout.
 * @property breakerFailureThreshold consecutive failures before the breaker opens.
 * @property breakerOpenMillis how long the breaker stays open before a probe.
 * @property tokenProvider auth seam (no-op by default; S6 supplies the real one).
 * @property scheduler clock + sleep seam (real by default; virtual in tests).
 * @property random jitter source in `[0,1)`; injectable for deterministic tests.
 * @property json kotlinx serializer used for content negotiation.
 */
public class ApiClientConfig(
    public val baseUrl: String,
    public val maxRetries: Int = 1,
    public val baseRetryDelayMillis: Long = 1_000,
    public val maxRetryDelayMillis: Long = 30_000,
    public val requestTimeoutMillis: Long = 15_000,
    public val breakerFailureThreshold: Int = 5,
    public val breakerOpenMillis: Long = 30_000,
    public val tokenProvider: TokenProvider = NoopTokenProvider,
    public val scheduler: Scheduler = RealScheduler,
    public val random: () -> Double = { Random.nextDouble() },
    public val json: Json = defaultApiJson,
)

/** Lenient-but-strict JSON: ignore unknown server fields, omit nulls/defaults on write. */
public val defaultApiJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

/**
 * Mutable builder backing the functional-options DSL of the [ApiHttpClient] factory.
 * Every field mirrors an [ApiClientConfig] property and starts at the same default.
 */
public class ApiHttpClientBuilder internal constructor(
    public var baseUrl: String,
) {
    public var maxRetries: Int = 1
    public var baseRetryDelayMillis: Long = 1_000
    public var maxRetryDelayMillis: Long = 30_000
    public var requestTimeoutMillis: Long = 15_000
    public var breakerFailureThreshold: Int = 5
    public var breakerOpenMillis: Long = 30_000
    public var tokenProvider: TokenProvider = NoopTokenProvider
    public var scheduler: Scheduler = RealScheduler
    public var random: () -> Double = { Random.nextDouble() }
    public var json: Json = defaultApiJson

    internal fun build(): ApiClientConfig =
        ApiClientConfig(
            baseUrl = baseUrl,
            maxRetries = maxRetries,
            baseRetryDelayMillis = baseRetryDelayMillis,
            maxRetryDelayMillis = maxRetryDelayMillis,
            requestTimeoutMillis = requestTimeoutMillis,
            breakerFailureThreshold = breakerFailureThreshold,
            breakerOpenMillis = breakerOpenMillis,
            tokenProvider = tokenProvider,
            scheduler = scheduler,
            random = random,
            json = json,
        )
}
