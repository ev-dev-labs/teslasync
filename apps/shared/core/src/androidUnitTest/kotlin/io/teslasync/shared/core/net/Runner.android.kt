package io.teslasync.shared.core.net

import kotlinx.coroutines.runBlocking

internal actual fun runTestBlocking(block: suspend () -> Unit): Unit = runBlocking { block() }
