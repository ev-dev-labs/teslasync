package io.teslasync.shared.core.cache

import io.teslasync.shared.core.cache.db.TeslaSyncCache

/**
 * A single cached record: the canonical SI [payload] JSON and the [fetchedAt]
 * epoch-millisecond stamp used for freshness math.
 */
public data class CacheRecord(
    public val payload: String,
    public val fetchedAt: Long,
)

/**
 * Persistence seam for the offline cache (ADR-013). Stores opaque, already-serialized
 * SI payloads keyed by ([CacheDomain], key) — the repository layer owns (de)serialization
 * so this store stays domain-agnostic and trivially fakeable in tests.
 *
 * Write-through ([write]) and invalidation ([delete]/[clear]/[clearAll], the
 * clear-on-logout hook) are first-class so feature state holders never reach past it.
 */
public interface CacheStore {
    /** Reads the cached record for ([domain], [key]), or `null` when absent. */
    public suspend fun read(
        domain: CacheDomain,
        key: String,
    ): CacheRecord?

    /** Inserts or replaces the record for ([domain], [key]) with [payload] stamped [fetchedAt]. */
    public suspend fun write(
        domain: CacheDomain,
        key: String,
        payload: String,
        fetchedAt: Long,
    )

    /** Removes a single ([domain], [key]) entry. */
    public suspend fun delete(
        domain: CacheDomain,
        key: String,
    )

    /** Removes every entry in [domain] (per-domain invalidation). */
    public suspend fun clear(domain: CacheDomain)

    /** Removes every cached entry across all domains (clear-on-logout). */
    public suspend fun clearAll()
}

/**
 * SQLDelight-backed [CacheStore]. The driver runs queries synchronously; this layer is
 * called from repository coroutines that already run off the UI thread, so it does not
 * impose its own dispatcher.
 */
internal class SqlDelightCacheStore(
    database: TeslaSyncCache,
) : CacheStore {
    private val queries = database.cacheQueries

    override suspend fun read(
        domain: CacheDomain,
        key: String,
    ): CacheRecord? =
        queries
            .selectEntry(domain.key, key)
            .executeAsOneOrNull()
            ?.let { CacheRecord(payload = it.payload, fetchedAt = it.fetchedAt) }

    override suspend fun write(
        domain: CacheDomain,
        key: String,
        payload: String,
        fetchedAt: Long,
    ) {
        queries.upsertEntry(domain.key, key, payload, fetchedAt)
    }

    override suspend fun delete(
        domain: CacheDomain,
        key: String,
    ) {
        queries.deleteByKey(domain.key, key)
    }

    override suspend fun clear(domain: CacheDomain) {
        queries.deleteDomain(domain.key)
    }

    override suspend fun clearAll() {
        queries.deleteAll()
    }
}
