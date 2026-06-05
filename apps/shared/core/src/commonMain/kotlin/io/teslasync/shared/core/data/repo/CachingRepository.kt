package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.net.defaultApiJson
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/**
 * Thin base for the per-domain repositories (ADR-013). Owns the SI-payload
 * (de)serialization and the freshness/TTL wiring so each concrete repository only
 * declares its [domain], its `T` [serializer], and how to [fetch] from the API.
 *
 * Feature-specific merging/derivation (e.g. live SSE reconciliation) is intentionally
 * out of scope here — that belongs to the S8 state holders that read through these.
 *
 * @param T the cached read-model type; stored as its canonical SI JSON, never converted.
 */
public abstract class CachingRepository<T : Any>(
    private val store: CacheStore,
    private val clock: Clock,
    private val json: Json,
    private val serializer: KSerializer<T>,
) {
    /** The cache partition this repository owns. */
    protected abstract val domain: CacheDomain

    /** Staleness threshold; defaults to the domain's, override per repository if needed. */
    protected open val ttlMillis: Long get() = domain.defaultTtlMillis

    /**
     * Streams a cache-then-network [Resource] for [key], refreshing via [fetch]. The
     * cached value is decoded from its stored SI JSON; a fresh value is written through.
     */
    protected fun observe(
        key: String,
        fetch: suspend () -> T,
    ): Flow<Resource<T>> =
        cacheThenNetwork(
            clock = clock,
            ttlMillis = ttlMillis,
            read = { readCached(key) },
            fetch = fetch,
            write = { data, fetchedAt ->
                store.write(domain, key, json.encodeToString(serializer, data), fetchedAt)
            },
        )

    /**
     * Reads and decodes the cached value for [key]. A payload that no longer matches the
     * current DTO shape (corruption, or a schema change across an app upgrade) is treated
     * as a cache miss and evicted, so a stale row can never brick the network refresh.
     */
    private suspend fun readCached(key: String): CachedValue<T>? {
        val record = store.read(domain, key) ?: return null
        return try {
            CachedValue(json.decodeFromString(serializer, record.payload), record.fetchedAt)
        } catch (e: SerializationException) {
            store.delete(domain, key)
            null
        }
    }

    /**
     * Write-through hook for mutations: persists [value] under [key] stamped now, so a
     * subsequent read reflects the change without a network round-trip.
     */
    public suspend fun put(
        key: String,
        value: T,
    ) {
        store.write(domain, key, json.encodeToString(serializer, value), clock.nowMillis())
    }

    /** Reads the currently cached value (and its stamp) for [key], or `null`. */
    public suspend fun peek(key: String): CachedValue<T>? = readCached(key)

    /** Invalidates this repository's entire domain. */
    public suspend fun clear() {
        store.clear(domain)
    }

    protected companion object {
        /** Shared JSON identical to the networking client's, so SI payloads round-trip. */
        public val cacheJson: Json = defaultApiJson
    }
}
