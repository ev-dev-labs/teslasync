package io.teslasync.shared.core.cache

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.native.NativeSqliteDriver
import io.teslasync.shared.core.cache.db.TeslaSyncCache

/**
 * Apple cache driver: wraps [NativeSqliteDriver], which applies the schema on first open.
 */
public actual class DriverFactory {
    public actual fun createDriver(): SqlDriver = NativeSqliteDriver(TeslaSyncCache.Schema, CACHE_DATABASE_NAME)
}
