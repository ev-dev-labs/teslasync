package io.teslasync.shared.core.net.sse

import io.teslasync.shared.core.net.RealScheduler
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.min
import kotlin.math.pow
import kotlin.random.Random

/**
 * Default backend SSE path (the resilient client adds the `/api/v1` prefix). Matches
 * `internal/api/router.go`'s `/events` route consumed by the web `sseManager`.
 */
public const val DEFAULT_SSE_PATH: String = "/events"

/**
 * The result of [SseClient.subscribe]: a cold [events] stream paired with the live
 * [connection] state it drives. Collecting [events] starts the connection; cancelling
 * the collection closes it. [connection] reflects the most recent collection's
 * lifecycle and resets to [Connection.Closed] when collection ends. A subscription is
 * single-collector — call [SseClient.subscribe] again for an independent stream.
 */
public class LiveSubscription internal constructor(
    public val events: Flow<LiveEvent>,
    public val connection: StateFlow<Connection>,
)

/**
 * Immutable configuration for an [SseClient]. Build via the [SseClient] factory's
 * [SseClientBuilder] DSL rather than constructing directly so defaults stay in one
 * place.
 *
 * @property path default SSE path used by [SseClient.subscribe] when none is given.
 * @property freshnessWindowMillis silence (no event/heartbeat) after which an open
 *   stream is flagged [Connection.Stale] — ADR-013's 2-minute contract by default.
 * @property reconnect whether to backoff-reconnect after a drop/close. When `false`
 *   the stream ends ([Connection.Closed]) on the first disconnect.
 * @property baseRetryDelayMillis first-reconnect backoff base; doubles per attempt.
 * @property maxRetryDelayMillis upper bound for a single backoff sleep.
 * @property nowMillis monotonic clock seam for staleness; injected as virtual time in
 *   tests so freshness transitions are deterministic with zero real waiting.
 * @property random jitter source in `[0,1)`; injectable for deterministic tests.
 */
public class SseConfig(
    public val path: String = DEFAULT_SSE_PATH,
    public val freshnessWindowMillis: Long = 120_000,
    public val reconnect: Boolean = true,
    public val baseRetryDelayMillis: Long = 1_000,
    public val maxRetryDelayMillis: Long = 60_000,
    public val nowMillis: () -> Long = RealScheduler::nowMillis,
    public val random: () -> Double = { Random.nextDouble() },
)

/**
 * The shared Server-Sent-Events client that streams live signal/state updates,
 * mirroring the web `useRealtimeEvents`/`sseManager` pair. Feeds every live panel
 * across the native apps.
 *
 * [subscribe] returns a cold [LiveSubscription]: each collection opens one stream via
 * the injected [SseTransport], parses frames into typed [LiveEvent]s, and maintains a
 * [Connection] [StateFlow] with auto-reconnect (capped exponential backoff + jitter,
 * resuming with `Last-Event-ID`) and ADR-013 staleness detection. Cancelling the
 * collection closes the underlying connection.
 *
 * Construct via the [SseClient] factory (functional-options DSL).
 */
public class SseClient internal constructor(
    private val transport: SseTransport,
    private val config: SseConfig,
) {
    /**
     * Opens a cold live subscription to [path]. Nothing happens until [events] is
     * collected; the returned [LiveSubscription.connection] tracks lifecycle while it
     * is.
     */
    public fun subscribe(path: String = config.path): LiveSubscription {
        val connection = MutableStateFlow(Connection.Closed)
        val events: Flow<LiveEvent> =
            channelFlow {
                val lastMessageAt = MutableStateFlow(config.nowMillis())
                val watchdog = launch { runStalenessWatchdog(connection, lastMessageAt) }
                try {
                    runConnectionLoop(path, connection, lastMessageAt) { event -> send(event) }
                } finally {
                    watchdog.cancel()
                    connection.value = Connection.Closed
                }
            }
        return LiveSubscription(events, connection.asStateFlow())
    }

    /**
     * Connect → parse → emit, reconnecting with backoff until the collector cancels
     * (or, when [SseConfig.reconnect] is false, until the first disconnect).
     */
    private suspend fun runConnectionLoop(
        path: String,
        connection: MutableStateFlow<Connection>,
        lastMessageAt: MutableStateFlow<Long>,
        emit: suspend (LiveEvent) -> Unit,
    ) {
        var lastEventId: String? = null
        var attempt = 0
        while (currentCoroutineContext().isActive) {
            connection.value = if (attempt == 0) Connection.Connecting else Connection.Reconnecting
            try {
                val parser = SseFrameParser()
                transport.open(SseRequest(path, lastEventId)).collect { chunk ->
                    for (frame in parser.feed(chunk)) {
                        frame.id?.let { lastEventId = it }
                        lastMessageAt.value = config.nowMillis()
                        connection.value = Connection.Open
                        attempt = 0
                        emit(decodeEvent(frame))
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Transport failure — fall through to the backoff-reconnect below.
            }
            if (!config.reconnect) break
            connection.value = Connection.Reconnecting
            delay(backoffDelay(attempt))
            attempt += 1
        }
    }

    /**
     * Flags the stream [Connection.Stale] when an OPEN connection sees no
     * event/heartbeat within [SseConfig.freshnessWindowMillis]. Never drops the
     * stream; parks until the next message advances [lastMessageAt], then re-arms.
     */
    private suspend fun runStalenessWatchdog(
        connection: MutableStateFlow<Connection>,
        lastMessageAt: MutableStateFlow<Long>,
    ) {
        while (currentCoroutineContext().isActive) {
            val sinceLast = config.nowMillis() - lastMessageAt.value
            val remaining = config.freshnessWindowMillis - sinceLast
            if (remaining > 0) {
                delay(remaining)
                continue
            }
            if (connection.value == Connection.Open) {
                connection.value = Connection.Stale
            }
            val mark = lastMessageAt.value
            lastMessageAt.first { it != mark }
        }
    }

    private fun backoffDelay(attempt: Int): Long {
        val exponential = config.baseRetryDelayMillis * 2.0.pow(attempt)
        val jittered = exponential * (0.75 + config.random() * 0.5)
        return min(jittered, 1.0 * config.maxRetryDelayMillis).toLong()
    }
}

/**
 * Builds an [SseClient] over [transport], configured through the [SseClientBuilder]
 * receiver. Production code passes a [KtorSseTransport]; tests pass a scripted fake.
 */
public fun SseClient(
    transport: SseTransport,
    configure: SseClientBuilder.() -> Unit = {},
): SseClient {
    val config = SseClientBuilder().apply(configure).build()
    return SseClient(transport, config)
}

/**
 * Mutable builder backing the functional-options DSL of the [SseClient] factory. Each
 * field mirrors an [SseConfig] property and starts at the same default.
 */
public class SseClientBuilder internal constructor() {
    public var path: String = DEFAULT_SSE_PATH
    public var freshnessWindowMillis: Long = 120_000
    public var reconnect: Boolean = true
    public var baseRetryDelayMillis: Long = 1_000
    public var maxRetryDelayMillis: Long = 60_000
    public var nowMillis: () -> Long = RealScheduler::nowMillis
    public var random: () -> Double = { Random.nextDouble() }

    internal fun build(): SseConfig =
        SseConfig(
            path = path,
            freshnessWindowMillis = freshnessWindowMillis,
            reconnect = reconnect,
            baseRetryDelayMillis = baseRetryDelayMillis,
            maxRetryDelayMillis = maxRetryDelayMillis,
            nowMillis = nowMillis,
            random = random,
        )
}
