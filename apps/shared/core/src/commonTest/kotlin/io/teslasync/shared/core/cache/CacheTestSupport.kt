package io.teslasync.shared.core.cache

import io.teslasync.shared.core.data.repo.CachingRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Deterministic clock: tests set [now] directly to drive freshness without waiting. */
internal class FakeClock(
    var now: Long = 0L,
) : Clock {
    override fun nowMillis(): Long = now
}

/** Minimal SI read-model used to exercise the cache mechanics (meters + seconds). */
@Serializable
internal data class Reading(
    val distanceM: Double,
    val durationS: Long,
)

/** JSON identical to the cache's, so the test seeds and assertions round-trip the same way. */
internal val testJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

/**
 * Test double of a concrete repository over the generic [CachingRepository] machinery,
 * exposing the otherwise-protected [observe]/[put] hooks so the operator, store, and
 * freshness wiring can be exercised end-to-end with a [FakeClock] and a real in-memory
 * store. Always uses the Energy domain (5-minute TTL).
 */
internal class ReadingRepository(
    store: CacheStore,
    clock: Clock,
    json: Json = testJson,
) : CachingRepository<Reading>(store, clock, json, Reading.serializer()) {
    override val domain: CacheDomain = CacheDomain.Energy

    val ttl: Long get() = ttlMillis

    fun stream(
        key: String,
        fetch: suspend () -> Reading,
    ): Flow<Resource<Reading>> = observe(key, fetch)

    suspend fun seed(
        key: String,
        value: Reading,
    ) {
        put(key, value)
    }
}

/** Builds a fresh [LocalCache] over an in-memory driver — no real database file. */
internal fun newTestCache(): LocalCache = LocalCache(inMemoryCacheDriver())

/**
 * In-memory [CacheStore] double with fault-injection hooks: [failWrites] simulates a
 * persistence failure (disk full / locked DB), and [putRaw] seeds an arbitrary (possibly
 * corrupt) payload so the decode-recovery path can be exercised.
 */
internal class MapCacheStore : CacheStore {
    private val data = mutableMapOf<Pair<String, String>, CacheRecord>()
    var failWrites: Boolean = false

    override suspend fun read(
        domain: CacheDomain,
        key: String,
    ): CacheRecord? = data[domain.key to key]

    override suspend fun write(
        domain: CacheDomain,
        key: String,
        payload: String,
        fetchedAt: Long,
    ) {
        if (failWrites) throw IllegalStateException("disk full")
        data[domain.key to key] = CacheRecord(payload, fetchedAt)
    }

    override suspend fun delete(
        domain: CacheDomain,
        key: String,
    ) {
        data.remove(domain.key to key)
    }

    override suspend fun clear(domain: CacheDomain) {
        data.keys.removeAll { it.first == domain.key }
    }

    override suspend fun clearAll() {
        data.clear()
    }

    /** Seeds a raw payload without serialization — used to inject corrupt cache rows. */
    fun putRaw(
        domain: CacheDomain,
        key: String,
        payload: String,
        fetchedAt: Long,
    ) {
        data[domain.key to key] = CacheRecord(payload, fetchedAt)
    }

    /** Number of rows currently stored — lets tests assert eviction. */
    fun size(): Int = data.size
}
