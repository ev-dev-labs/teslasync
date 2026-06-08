package io.teslasync.shared.core.cache

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.teslasync.shared.core.cache.db.TeslaSyncCache

internal actual fun inMemoryCacheDriver(): SqlDriver {
    val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
    TeslaSyncCache.Schema.create(driver)
    return driver
}
