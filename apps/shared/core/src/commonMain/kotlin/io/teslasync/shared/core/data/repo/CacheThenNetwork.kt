package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.Clock
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlin.coroutines.cancellation.CancellationException

/**
 * A value read back from the cache together with the [fetchedAt] epoch-millisecond
 * stamp it was stored with, so the operator can compute staleness without re-reading.
 */
public data class CachedValue<out T>(
    public val data: T,
    public val fetchedAt: Long,
)

/** `true` when a value stamped [fetchedAt] is older than [ttlMillis] relative to [nowMillis]. */
internal fun isStale(
    nowMillis: Long,
    fetchedAt: Long,
    ttlMillis: Long,
): Boolean = nowMillis - fetchedAt > ttlMillis

/**
 * The generic cache-then-network operator (ADR-013).
 *
 * Emits the cached value immediately as [Resource.Loading] (stamped with its age-based
 * staleness), then refreshes via [fetch]:
 *  - on success, writes through ([write]) with a fresh `fetched_at` stamp and emits
 *    [Resource.Success] (never stale);
 *  - on failure, emits [Resource.Error] — serving the cached value with `stale = true`
 *    when one exists (offline ⇒ cache + stale), or a cause-only error when it does not.
 *
 * Coroutine cancellation always propagates (it is never swallowed as an error).
 *
 * @param clock wall-clock seam; injected so tests drive freshness deterministically.
 * @param ttlMillis per-entity staleness threshold for the initial cached emission.
 * @param read reads the current cached value (and its stamp), or `null` when absent.
 * @param fetch performs the network refresh, returning the fresh value or throwing.
 * @param write persists a fresh value with its `fetched_at` stamp (write-through).
 */
public fun <T> cacheThenNetwork(
    clock: Clock,
    ttlMillis: Long,
    read: suspend () -> CachedValue<T>?,
    fetch: suspend () -> T,
    write: suspend (data: T, fetchedAt: Long) -> Unit,
): Flow<Resource<T>> =
    flow {
        val cached = read()
        if (cached != null) {
            val stale = isStale(clock.nowMillis(), cached.fetchedAt, ttlMillis)
            emit(Resource.Loading(cached = cached.data, fetchedAt = cached.fetchedAt, stale = stale))
        } else {
            emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
        }

        try {
            val data = fetch()
            val fetchedAt = clock.nowMillis()
            // Best-effort persistence: a cache write failure (disk full, locked DB) must
            // never hide freshly fetched data — surface Success and let the write loss be
            // a degraded-durability concern, not a data-availability one.
            try {
                write(data, fetchedAt)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Intentionally swallowed: the fresh value is still emitted below.
            }
            emit(Resource.Success(data = data, fetchedAt = fetchedAt, stale = false))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            emit(
                Resource.Error(
                    cached = cached?.data,
                    fetchedAt = cached?.fetchedAt,
                    stale = cached != null,
                    error = e,
                ),
            )
        }
    }
