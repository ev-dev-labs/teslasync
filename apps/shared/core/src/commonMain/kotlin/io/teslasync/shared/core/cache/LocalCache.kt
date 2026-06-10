package io.teslasync.shared.core.cache

import app.cash.sqldelight.db.SqlDriver
import io.teslasync.shared.core.cache.db.TeslaSyncCache

/**
 * The shared offline cache (ADR-013): a thin wrapper over the SQLDelight database
 * exposing the domain-agnostic [CacheStore] every repository builds on.
 *
 * Construct from a platform [SqlDriver] (see [DriverFactory]) in production, or from
 * an in-memory driver in tests. [logout] is the clear-on-logout hook — it wipes every
 * cached domain so a signed-out session can never surface a previous user's data.
 */
public class LocalCache(
    driver: SqlDriver,
) {
    private val database: TeslaSyncCache = TeslaSyncCache(driver)

    /** The persistence seam shared by every repository. */
    public val store: CacheStore = SqlDelightCacheStore(database)

    /** Clears the entire cache. Wired to sign-out so no stale user data persists. */
    public suspend fun logout() {
        store.clearAll()
    }
}
