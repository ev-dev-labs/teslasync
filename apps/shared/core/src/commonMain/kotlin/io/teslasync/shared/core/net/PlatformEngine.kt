package io.teslasync.shared.core.net

import io.ktor.client.engine.HttpClientEngine

/**
 * Platform-provided default transport engine for the resilient client:
 * OkHttp on Android, Darwin (NSURLSession) on Apple. Tests bypass this entirely by
 * supplying Ktor's `MockEngine`, so no real network is ever touched in `commonTest`.
 */
internal expect fun defaultHttpClientEngine(): HttpClientEngine
