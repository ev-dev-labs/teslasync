package io.teslasync.shared.core.net

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.darwin.Darwin

internal actual fun defaultHttpClientEngine(): HttpClientEngine = Darwin.create()
