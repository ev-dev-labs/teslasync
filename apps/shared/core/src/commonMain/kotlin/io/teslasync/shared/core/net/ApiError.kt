package io.teslasync.shared.core.net

/**
 * Structured failure surface for every call made through [ApiHttpClient].
 *
 * Mirrors the web `resilience.ts` error taxonomy so the three native apps
 * branch on the same set of cases the SPA already does:
 *  - [Network]     transport-level failure (no response reached us).
 *  - [Timeout]     the request exceeded the configured request timeout.
 *  - [Http]        a non-2xx response, carrying status + raw body + optional
 *                  machine-readable `code` from the JSON error envelope.
 *  - [Decode]      a 2xx response whose body failed to deserialize.
 *  - [CircuitOpen] the breaker is open, so the call was fast-failed without
 *                  touching the network.
 *
 * Extends [Exception] so it composes with Kotlin's [Result] (a `safeRequest`
 * returns `Result<T>` whose failure is always an `ApiError`).
 */
public sealed class ApiError(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {
    /** Transport failure before any HTTP response was produced. */
    public class Network(
        message: String = "Network request failed",
        cause: Throwable? = null,
    ) : ApiError(message, cause)

    /** The request exceeded the client's configured request timeout. */
    public class Timeout(
        message: String = "Request timed out",
        cause: Throwable? = null,
    ) : ApiError(message, cause)

    /**
     * A non-2xx HTTP response.
     *
     * @property status the HTTP status code.
     * @property body the raw (text) response body, when one was returned.
     * @property code the structured `code` field from the JSON error envelope,
     *   when the backend supplied one (e.g. `SUDO_REQUIRED`, `RATE_LIMITED`).
     */
    public class Http(
        public val status: Int,
        public val body: String? = null,
        public val code: String? = null,
        message: String = "HTTP $status",
    ) : ApiError(message)

    /** A successful response whose body could not be deserialized into `T`. */
    public class Decode(
        message: String = "Failed to decode response body",
        cause: Throwable? = null,
    ) : ApiError(message, cause)

    /** The circuit breaker is open; the call was rejected without a network round-trip. */
    public class CircuitOpen(
        message: String = "Circuit breaker is open",
    ) : ApiError(message)
}
