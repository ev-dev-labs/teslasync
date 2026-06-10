package io.teslasync.shared.core.data.repo

/**
 * The result surface emitted by every cache-then-network repository (ADR-013).
 *
 * A typical stream emits [Loading] (carrying any cached value for instant cold-start
 * UI) and then exactly one terminal [Success] or [Error]. Freshness is never implied:
 * [stale] is always explicit, and a value served from cache after a failed refresh is
 * flagged stale so the UI can show an honest "offline / last known" indicator rather
 * than presenting stale data as live.
 *
 * @property cached the most recent cached value available at emission, if any.
 * @property stale whether [cached]/data should be treated as stale (older than the
 *   entity TTL, or served from cache because the network was unreachable).
 */
public sealed interface Resource<out T> {
    public val cached: T?
    public val stale: Boolean

    /**
     * Emitted first: the refresh is in flight. [cached] holds the last value (with its
     * [fetchedAt] stamp) when one exists, so the UI renders immediately.
     */
    public data class Loading<out T>(
        override val cached: T?,
        public val fetchedAt: Long?,
        override val stale: Boolean,
    ) : Resource<T>

    /**
     * Terminal success: [data] is fresh from the network and has been written through to
     * the cache with the [fetchedAt] stamp. [stale] is always `false`.
     */
    public data class Success<out T>(
        public val data: T,
        public val fetchedAt: Long,
        override val stale: Boolean,
    ) : Resource<T> {
        override val cached: T get() = data
    }

    /**
     * Terminal failure: the refresh failed. [cached] is served when present (offline ⇒
     * cache + [stale] = `true`); with no cache, [cached] is `null`. [error] is the cause.
     */
    public data class Error<out T>(
        override val cached: T?,
        public val fetchedAt: Long?,
        override val stale: Boolean,
        public val error: Throwable,
    ) : Resource<T>
}
