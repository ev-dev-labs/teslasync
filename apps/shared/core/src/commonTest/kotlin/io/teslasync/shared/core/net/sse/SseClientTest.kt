package io.teslasync.shared.core.net.sse

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

@OptIn(ExperimentalCoroutinesApi::class)
class SseClientTest {
    private val connectedFrame = "event: connected\ndata: {\"client_id\":\"c1\"}\n\n"
    private val heartbeatFrame = "event: heartbeat\ndata: {\"time\":\"t\"}\n\n"

    @Test
    fun emitsTypedEventsAndReportsOpen() =
        runTest {
            val transport =
                FakeSseTransport { attempt, _ ->
                    if (attempt == 0) listOf(SseStep.Emit(connectedFrame), SseStep.Hang) else listOf(SseStep.Hang)
                }
            val client = SseClient(transport) { nowMillis = { currentTime } }
            val sub = client.subscribe()
            val events = mutableListOf<LiveEvent>()
            backgroundScope.launch { sub.events.collect { events.add(it) } }

            runCurrent()

            assertEquals(Connection.Open, sub.connection.value)
            assertEquals(1, events.size)
            assertEquals("c1", assertIs<LiveEvent.Connected>(events[0]).clientId)
        }

    @Test
    fun reconnectsWithLastEventIdAfterServerClose() =
        runTest {
            val frameWithId = "id: 77\n$heartbeatFrame"
            val transport =
                FakeSseTransport { attempt, _ ->
                    when (attempt) {
                        0 -> listOf(SseStep.Emit(frameWithId), SseStep.Complete)
                        else -> listOf(SseStep.Hang)
                    }
                }
            val client =
                SseClient(transport) {
                    nowMillis = { currentTime }
                    baseRetryDelayMillis = 1_000
                    random = { 0.5 }
                }
            val sub = client.subscribe()
            backgroundScope.launch { sub.events.collect {} }

            runCurrent()
            // First connection delivered a frame then closed; the client backs off 1s.
            advanceTimeBy(1_000)
            runCurrent()

            assertEquals(2, transport.opens.size)
            assertEquals(null, transport.opens[0].lastEventId)
            assertEquals("77", transport.opens[1].lastEventId)
        }

    @Test
    fun marksStaleAfterFreshnessWindowWithoutDropping() =
        runTest {
            val transport =
                FakeSseTransport { attempt, _ ->
                    if (attempt == 0) listOf(SseStep.Emit(heartbeatFrame), SseStep.Hang) else listOf(SseStep.Hang)
                }
            val client =
                SseClient(transport) {
                    nowMillis = { currentTime }
                    freshnessWindowMillis = 120_000
                }
            val sub = client.subscribe()
            backgroundScope.launch { sub.events.collect {} }

            runCurrent()
            assertEquals(Connection.Open, sub.connection.value)

            advanceTimeBy(120_001)
            runCurrent()

            assertEquals(Connection.Stale, sub.connection.value)
            // Still open (Hang), never reconnected — staleness flags, it does not drop.
            assertEquals(1, transport.opens.size)
            assertEquals(1, transport.activeConnections)
        }

    @Test
    fun recoversFromStaleWhenANewMessageArrives() =
        runTest {
            val transport =
                FakeSseTransport { attempt, _ ->
                    if (attempt == 0) {
                        listOf(
                            SseStep.Emit(heartbeatFrame),
                            SseStep.Wait(200_000),
                            SseStep.Emit(heartbeatFrame),
                            SseStep.Hang,
                        )
                    } else {
                        listOf(SseStep.Hang)
                    }
                }
            val client =
                SseClient(transport) {
                    nowMillis = { currentTime }
                    freshnessWindowMillis = 120_000
                }
            val sub = client.subscribe()
            backgroundScope.launch { sub.events.collect {} }

            runCurrent()
            assertEquals(Connection.Open, sub.connection.value)

            advanceTimeBy(120_001)
            runCurrent()
            assertEquals(Connection.Stale, sub.connection.value)

            advanceTimeBy(80_000)
            runCurrent()
            assertEquals(Connection.Open, sub.connection.value)
        }

    @Test
    fun cancellingTheCollectorClosesTheTransport() =
        runTest {
            val transport = FakeSseTransport { _, _ -> listOf(SseStep.Hang) }
            val client = SseClient(transport) { nowMillis = { currentTime } }
            val sub = client.subscribe()
            val job = launch { sub.events.collect {} }

            runCurrent()
            assertEquals(1, transport.activeConnections)

            job.cancel()
            runCurrent()

            assertEquals(0, transport.activeConnections)
            assertEquals(Connection.Closed, sub.connection.value)
        }

    @Test
    fun retriesWithCappedExponentialBackoff() =
        runTest {
            val transport =
                FakeSseTransport { attempt, _ ->
                    if (attempt < 4) listOf(SseStep.Fail(RuntimeException("drop"))) else listOf(SseStep.Hang)
                }
            val client =
                SseClient(transport) {
                    nowMillis = { currentTime }
                    baseRetryDelayMillis = 1_000
                    maxRetryDelayMillis = 2_500
                    random = { 0.5 }
                }
            val sub = client.subscribe()
            backgroundScope.launch { sub.events.collect {} }

            // Kick off collection, then drive virtual time past every backoff:
            // 1000, 2000, 4000→capped 2500, 2500.
            runCurrent()
            advanceTimeBy(10_000)
            runCurrent()

            // 4 failing attempts + the 5th that hangs open.
            assertEquals(5, transport.opens.size)
        }

    @Test
    fun stopsAtClosedWhenReconnectDisabled() =
        runTest {
            val transport =
                FakeSseTransport { attempt, _ ->
                    if (attempt == 0) listOf(SseStep.Emit(heartbeatFrame), SseStep.Complete) else listOf(SseStep.Hang)
                }
            val client =
                SseClient(transport) {
                    nowMillis = { currentTime }
                    reconnect = false
                }
            val sub = client.subscribe()
            val events = mutableListOf<LiveEvent>()
            backgroundScope.launch { sub.events.collect { events.add(it) } }

            runCurrent()

            assertEquals(1, transport.opens.size)
            assertEquals(1, events.size)
            assertIs<LiveEvent.Heartbeat>(events[0])
            assertEquals(Connection.Closed, sub.connection.value)
        }
}
