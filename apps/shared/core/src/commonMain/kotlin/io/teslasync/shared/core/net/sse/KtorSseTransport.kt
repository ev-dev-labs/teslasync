package io.teslasync.shared.core.net.sse

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.header
import io.ktor.client.request.prepareGet
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.utils.io.readUTF8Line
import io.teslasync.shared.core.net.NoopTokenProvider
import io.teslasync.shared.core.net.TokenProvider
import io.teslasync.shared.core.net.buildUrl
import io.teslasync.shared.core.net.defaultHttpClientEngine
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Production [SseTransport]: streams `text/event-stream` over the same Ktor networking
 * foundation the resilient HTTP client uses (platform default engine — OkHttp on
 * Android, Darwin on Apple).
 *
 * Each [open] reads the current bearer token from the [TokenProvider] (so a reconnect
 * after a refreshed credential carries the new token) and forwards [SseRequest.lastEventId]
 * as the `Last-Event-ID` header for server-side resume. The response body is read line
 * by line and re-emitted with the newline restored so the client's [SseFrameParser]
 * sees intact frame boundaries.
 *
 * Construct via the [KtorSseTransport] factory; the socket timeout is disabled so an
 * idle stream between 30-second heartbeats is not torn down by the engine's defaults.
 */
public class KtorSseTransport internal constructor(
    private val client: HttpClient,
    private val baseUrl: String,
    private val tokenProvider: TokenProvider,
) : SseTransport {
    @Suppress("DEPRECATION")
    override fun open(request: SseRequest): Flow<String> =
        flow {
            val token = tokenProvider.token()
            val url = buildUrl(baseUrl, request.path, versioned = true)
            client
                .prepareGet(url) {
                    header(HttpHeaders.Accept, "text/event-stream")
                    header(HttpHeaders.CacheControl, "no-cache")
                    if (token != null) {
                        header(HttpHeaders.Authorization, "Bearer $token")
                    }
                    request.lastEventId?.let { header("Last-Event-ID", it) }
                }.execute { response ->
                    val channel = response.bodyAsChannel()
                    while (true) {
                        val line = channel.readUTF8Line() ?: break
                        emit(line + "\n")
                    }
                }
        }

    /** Releases the underlying engine. Idempotent. */
    public fun close() {
        client.close()
    }
}

/**
 * Builds a production [KtorSseTransport] for [baseUrl] using the platform default
 * engine. The [tokenProvider] defaults to the no-op (unauthenticated) provider; S6
 * supplies the secure-storage backed one.
 */
public fun KtorSseTransport(
    baseUrl: String,
    tokenProvider: TokenProvider = NoopTokenProvider,
    engine: HttpClientEngine = defaultHttpClientEngine(),
): KtorSseTransport {
    val client =
        HttpClient(engine) {
            install(HttpTimeout) {
                // Long-lived stream: never cut an idle connection between heartbeats.
                socketTimeoutMillis = Long.MAX_VALUE
                requestTimeoutMillis = Long.MAX_VALUE
            }
        }
    return KtorSseTransport(client, baseUrl, tokenProvider)
}
