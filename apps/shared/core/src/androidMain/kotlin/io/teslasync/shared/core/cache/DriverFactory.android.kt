package io.teslasync.shared.core.cache

import android.content.Context
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import io.teslasync.shared.core.cache.db.TeslaSyncCache

/**
 * Android cache driver: wraps [AndroidSqliteDriver], which applies the schema on first
 * open. Needs an application [Context] to resolve the database file.
 */
public actual class DriverFactory(
    private val context: Context,
) {
    public actual fun createDriver(): SqlDriver = AndroidSqliteDriver(TeslaSyncCache.Schema, context, CACHE_DATABASE_NAME)
}
