package io.teslasync.shared.core.cache

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.native.inMemoryDriver
import io.teslasync.shared.core.cache.db.TeslaSyncCache

internal actual fun inMemoryCacheDriver(): SqlDriver = inMemoryDriver(TeslaSyncCache.Schema)
