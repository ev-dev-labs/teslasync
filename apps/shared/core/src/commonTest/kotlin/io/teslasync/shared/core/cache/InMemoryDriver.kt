package io.teslasync.shared.core.cache

import app.cash.sqldelight.db.SqlDriver

/**
 * An in-memory SQL driver for tests — no real database file is opened. Backed by the
 * JVM JDBC SQLite driver on Android unit tests and the native in-memory driver on Apple.
 */
internal expect fun inMemoryCacheDriver(): SqlDriver
