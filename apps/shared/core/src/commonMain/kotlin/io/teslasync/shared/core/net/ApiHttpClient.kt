package io.teslasync.shared.core.net

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.io.IOException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.min
import kotlin.math.pow

/**
 * The shared, resilient HTTP client every native repository builds on.
 *
 * Wraps a configured Ktor [HttpClient] with the same resilience contract the web
 * `request()`/`resilientFetch()` pair provides:
 *  - prepends `/api/v1` exactly once (no double prefix) and appends snake_case query
 *    params as given;
 *  - retries idempotent requests on transport failures, timeouts and 5xx with
 *    exponential backoff + jitter;
 *  - fast-fails through a [CircuitBreaker] once a failure threshold is crossed;
 *  - invokes the [TokenProvider] auth seam — a token on every attempt, and a single
 *    `onUnauthorized` refresh-and-replay on a 401;
 *  - maps every outcome to the sealed [ApiError] taxonomy.
 *
 * Construct via the [ApiHttpClient] factory (functional-options DSL). Tests inject a
 * Ktor `MockEngine` + a virtual [Scheduler] so no real network or sleep is involved.
 */
public class ApiHttpClient internal constructor(
    private val client: HttpClient,
    private val config: ApiClientConfig,
) {
    private val breaker: CircuitBreaker =
        CircuitBreaker(
            failureThreshold = config.breakerFailureThreshold,
            openMillis = config.breakerOpenMillis,
            scheduler = config.scheduler,
        )

    /** Current breaker state — exposed for diagnostics and tests. */
    public suspend fun circuitState(): CircuitState = breaker.currentState()

    /** Releases the underlying engine. Idempotent. */
    public fun close() {
        client.close()
    }

    /**
     * Core resilience loop shared by every typed entrypoint. Not called directly;
     * the inline `request`/`safeRequest` extensions supply [decode] (a reified
     * `response.body<T>()`) so this layer needs no `TypeInfo` plumbing.
     *
     * The network call, status classification AND body read/decode all happen inside
     * one [withTimeout] window so a stalled body stream still maps to [ApiError.Timeout].
     * Control flow for non-2xx statuses returns a sealed [Attempt] rather than throwing
     * across the timeout boundary, keeping retry/breaker decisions out here.
     */
    @PublishedApi
    internal suspend fun <T> requestCore(
        spec: RequestSpec,
        decode: suspend (HttpResponse) -> T,
    ): T {
        var attempt = 0
        var authRefreshAttempted = false
        var lastError: ApiError

        while (true) {
            if (!breaker.tryAcquire()) {
                throw ApiError.CircuitOpen()
            }

            val outcome: Attempt<T> =
                try {
                    withTimeout(config.requestTimeoutMillis) {
                        val token = config.tokenProvider.token()
                        val response = performCall(spec, token)
                        classify(response, decode)
                    }
                } catch (e: TimeoutCancellationException) {
                    breaker.onFailure()
                    lastError = ApiError.Timeout(cause = e)
                    if (canRetry(spec, attempt)) {
                        backoff(attempt)
                        attempt += 1
                        continue
                    }
                    throw lastError
                } catch (e: CancellationException) {
                    throw e
                } catch (e: ApiError.Decode) {
                    // 2xx body failed to deserialize: the server is healthy, so this is
                    // neither a breaker failure nor retryable.
                    breaker.onSuccess()
                    throw e
                } catch (e: SerializationException) {
                    // Request *encoding* failed before the wire — not a transport fault,
                    // so it must not pollute the breaker or be retried.
                    throw ApiError.Decode(message = "Failed to encode request body", cause = e)
                } catch (e: IOException) {
                    breaker.onFailure()
                    lastError = ApiError.Network(cause = e)
                    if (canRetry(spec, attempt)) {
                        backoff(attempt)
                        attempt += 1
                        continue
                    }
                    throw lastError
                } catch (e: Throwable) {
                    // Unknown transport-layer fault (serialization is split out above and
                    // cancellation is rethrown): treat as a retryable network failure.
                    breaker.onFailure()
                    lastError = ApiError.Network(cause = e)
                    if (canRetry(spec, attempt)) {
                        backoff(attempt)
                        attempt += 1
                        continue
                    }
                    throw lastError
                }

            when (outcome) {
                is Attempt.Ok -> {
                    breaker.onSuccess()
                    return outcome.value
                }

                is Attempt.Unauthorized -> {
                    // The server answered, so it is healthy from the breaker's view —
                    // a 401 is an auth problem, not a reliability failure.
                    breaker.onSuccess()
                    if (!authRefreshAttempted) {
                        authRefreshAttempted = true
                        if (config.tokenProvider.onUnauthorized()) {
                            // Replay once with the refreshed credential. This does NOT
                            // consume a backoff-retry slot.
                            continue
                        }
                    }
                    throw outcome.error
                }

                is Attempt.ClientError -> {
                    breaker.onSuccess()
                    throw outcome.error
                }

                is Attempt.ServerError -> {
                    // 5xx — a server-side reliability failure: count it and maybe retry.
                    breaker.onFailure()
                    lastError = outcome.error
                    if (canRetry(spec, attempt)) {
                        backoff(attempt)
                        attempt += 1
                        continue
                    }
                    throw lastError
                }
            }
        }
    }

    /**
     * Classifies a received response inside the timeout window, decoding a 2xx body to
     * [T] (a failed decode throws [ApiError.Decode]) and reading the error body for any
     * non-2xx status so the whole exchange is timeout-bounded.
     */
    private suspend fun <T> classify(
        response: HttpResponse,
        decode: suspend (HttpResponse) -> T,
    ): Attempt<T> {
        val status = response.status.value
        return when {
            status in 200..299 -> Attempt.Ok(decodeBody(response, decode))
            status == 401 -> Attempt.Unauthorized(httpError(response, status))
            status in 400..499 -> Attempt.ClientError(httpError(response, status))
            else -> Attempt.ServerError(httpError(response, status))
        }
    }

    private suspend fun performCall(
        spec: RequestSpec,
        token: String?,
    ): HttpResponse {
        val url = buildUrl(config.baseUrl, spec.path, spec.versioned)
        return client.request(url) {
            method = spec.method.toKtor()
            for ((key, value) in spec.query) {
                if (value != null) parameter(key, value)
            }
            if (token != null) {
                header(HttpHeaders.Authorization, "Bearer $token")
            }
            if (spec.body != null) {
                contentType(ContentType.Application.Json)
                setBody(spec.body)
            }
        }
    }

    private suspend fun <T> decodeBody(
        response: HttpResponse,
        decode: suspend (HttpResponse) -> T,
    ): T =
        try {
            decode(response)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            throw ApiError.Decode(cause = e)
        }

    private suspend fun httpError(
        response: HttpResponse,
        status: Int,
    ): ApiError.Http {
        val text =
            try {
                response.bodyAsText()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                null
            }
        return ApiError.Http(status = status, body = text, code = extractCode(text))
    }

    private fun extractCode(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            val element = config.json.parseToJsonElement(body)
            (element as? JsonObject)?.get("code")?.jsonPrimitive?.contentOrNull
        } catch (e: Throwable) {
            null
        }
    }

    private fun canRetry(
        spec: RequestSpec,
        attempt: Int,
    ): Boolean = spec.method.idempotent && attempt < config.maxRetries

    private suspend fun backoff(attempt: Int) {
        val exponential = config.baseRetryDelayMillis * 2.0.pow(attempt)
        val jittered = exponential * (0.75 + config.random() * 0.5)
        val capped = min(jittered, config.maxRetryDelayMillis * 1.0)
        config.scheduler.sleep(capped.toLong())
    }
}

/**
 * Result of one classified attempt, returned (not thrown) from inside the timeout
 * window so the retry/breaker policy is decided by the outer loop.
 */
private sealed interface Attempt<out T> {
    data class Ok<T>(
        val value: T,
    ) : Attempt<T>

    data class Unauthorized(
        val error: ApiError.Http,
    ) : Attempt<Nothing>

    data class ClientError(
        val error: ApiError.Http,
    ) : Attempt<Nothing>

    data class ServerError(
        val error: ApiError.Http,
    ) : Attempt<Nothing>
}

private fun HttpMethodKind.toKtor(): HttpMethod =
    when (this) {
        HttpMethodKind.GET -> HttpMethod.Get
        HttpMethodKind.HEAD -> HttpMethod.Head
        HttpMethodKind.OPTIONS -> HttpMethod.Options
        HttpMethodKind.PUT -> HttpMethod.Put
        HttpMethodKind.DELETE -> HttpMethod.Delete
        HttpMethodKind.POST -> HttpMethod.Post
        HttpMethodKind.PATCH -> HttpMethod.Patch
    }

/**
 * Normalises a caller path to a single leading slash and defensively strips a stray
 * `/api/v1` prefix so a caller passing `/api/v1/foo` never yields `/api/v1/api/v1/foo`.
 * Mirrors the web `normalizePath`.
 */
internal fun normalizePath(path: String): String {
    val withSlash = if (path.startsWith("/")) path else "/$path"
    return if (withSlash.startsWith("/api/v1/")) withSlash.removePrefix("/api/v1") else withSlash
}

/** Joins host + (optional) version segment + normalised path, prefixing `/api/v1` once. */
internal fun buildUrl(
    baseUrl: String,
    path: String,
    versioned: Boolean,
): String {
    val base = baseUrl.trimEnd('/')
    val normalized = normalizePath(path)
    return if (versioned) "$base/api/v1$normalized" else "$base$normalized"
}

/**
 * Builds a production [ApiHttpClient] for [baseUrl] using the platform default engine
 * (OkHttp on Android, Darwin on Apple). Configure resilience knobs and the auth seam
 * through the [ApiHttpClientBuilder] receiver.
 */
public fun ApiHttpClient(
    baseUrl: String,
    configure: ApiHttpClientBuilder.() -> Unit = {},
): ApiHttpClient {
    val config = ApiHttpClientBuilder(baseUrl).apply(configure).build()
    return buildApiHttpClient(defaultHttpClientEngine(), config)
}

/**
 * Engine-injecting factory. Production code goes through the [baseUrl] overload;
 * tests pass a Ktor `MockEngine` so no real network is touched.
 */
internal fun buildApiHttpClient(
    engine: HttpClientEngine,
    config: ApiClientConfig,
): ApiHttpClient {
    val client =
        HttpClient(engine) {
            // Non-2xx must NOT throw inside Ktor — requestCore owns status handling so it
            // can map errors, read bodies, and drive retry/breaker decisions.
            expectSuccess = false
            install(ContentNegotiation) {
                json(config.json)
            }
        }
    return ApiHttpClient(client, config)
}

/**
 * Performs a typed request through the resilient pipeline, decoding a 2xx body into
 * [T]. Throws an [ApiError] on any failure (use [safeRequest] for a non-throwing
 * `Result`).
 */
public suspend inline fun <reified T> ApiHttpClient.request(
    method: HttpMethodKind = HttpMethodKind.GET,
    path: String,
    versioned: Boolean = true,
    query: Map<String, String?> = emptyMap(),
    body: Any? = null,
): T =
    requestCore(RequestSpec(method, path, versioned, query, body)) { response ->
        response.body<T>()
    }

/**
 * Non-throwing variant of [request]: a success yields `Result.success(T)` and any
 * [ApiError] yields `Result.failure(error)`. Coroutine cancellation still propagates.
 */
public suspend inline fun <reified T> ApiHttpClient.safeRequest(
    method: HttpMethodKind = HttpMethodKind.GET,
    path: String,
    versioned: Boolean = true,
    query: Map<String, String?> = emptyMap(),
    body: Any? = null,
): Result<T> =
    try {
        Result.success(request<T>(method, path, versioned, query, body))
    } catch (e: ApiError) {
        Result.failure(e)
    }
