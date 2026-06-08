package io.teslasync.shared.core.cache

import app.cash.sqldelight.db.SqlDriver

/**
 * Filename of the on-disk cache database, shared by every platform driver so the
 * Android and Apple actuals open the same logical store.
 */
public const val CACHE_DATABASE_NAME: String = "teslasync_cache.db"

/**
 * Opens the platform SQLite database that backs the offline cache (ADR-013).
 *
 * Implemented per platform: Android wraps `AndroidSqliteDriver` (and therefore needs
 * a `Context`), Apple wraps `NativeSqliteDriver`. Tests substitute an in-memory
 * driver so no real database file is touched.
 */
public expect class DriverFactory {
    /** Creates a ready-to-use driver with the cache schema applied. */
    public fun createDriver(): SqlDriver
}
