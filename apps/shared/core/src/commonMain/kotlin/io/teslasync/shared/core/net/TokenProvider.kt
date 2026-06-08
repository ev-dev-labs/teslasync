package io.teslasync.shared.core.net

/**
 * Auth seam consumed by [ApiHttpClient]. S6 supplies the concrete, secure-storage
 * backed implementation; this layer ships only the no-op default ([NoopTokenProvider])
 * so the networking foundation is independently testable.
 *
 * Two responsibilities, intentionally minimal:
 *  - [token] is read before every attempt and, when non-null, attached as a
 *    `Bearer` Authorization header.
 *  - [onUnauthorized] is invoked at most once per logical request when the server
 *    responds 401. It receives the exact token that was attached to the failed
 *    attempt ([failedToken]) so a refresh implementation can coalesce concurrent
 *    401s: if the current credential already differs from [failedToken], another
 *    caller has refreshed and the request can simply be replayed. Returning `true`
 *    means "I refreshed the credential, replay the request"; returning `false`
 *    means "give up", and the 401 surfaces as [ApiError.Http].
 */
public interface TokenProvider {
    /** Current bearer token, or `null` when the caller is unauthenticated. */
    public suspend fun token(): String?

    /**
     * Invoked once on a 401 to attempt a credential refresh. [failedToken] is the
     * bearer value that was sent on the rejected attempt (`null` if none). Returns
     * `true` if the request should be replayed with a freshly minted token, `false`
     * otherwise.
     */
    public suspend fun onUnauthorized(failedToken: String?): Boolean
}

/**
 * Default no-op provider: no token is attached and a 401 is never retried.
 * Replaced by the S6 wiring; kept here so the foundation has a safe, inert default.
 */
public object NoopTokenProvider : TokenProvider {
    override suspend fun token(): String? = null

    override suspend fun onUnauthorized(failedToken: String?): Boolean = false
}
