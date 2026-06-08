package io.teslasync.shared.core.net

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp

internal actual fun defaultHttpClientEngine(): HttpClientEngine = OkHttp.create()
