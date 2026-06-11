package io.teslasync.android.data.live

import io.teslasync.shared.core.net.sse.Connection
import io.teslasync.shared.core.net.sse.LiveEvent
import io.teslasync.shared.core.net.sse.SseClient
import io.teslasync.shared.core.net.sse.SseRequest
import io.teslasync.shared.core.net.sse.SseTransport
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Integration coverage for the production [LiveFeed] adapter over the real shared [SseClient], driven
 * by a scripted [SseTransport] (no network/clock). Proves a `feed.open()` surfaces the client's typed
 * events + `Connection` state, resumes with `Last-Event-ID` across the client's own reconnect, and
 * closes the underlying transport when the events collection is cancelled.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveFeedSseClientTest {
    private val connectedFrame = "event: connected\ndata: {\"client_id\":\"c1\"}\n\n"

    @Test
    fun surfacesEventsAndConnectionThenClosesOnCancel() =
        runTest {
            val transport =
                ScriptedTransport { attempt, _ ->
                    if (attempt == 0) listOf(Step.Emit(connectedFrame), Step.Hang) else listOf(Step.Hang)
                }
            val client = SseClient(transport) { nowMillis = { currentTime } }
            val stream = LiveFeed(client).open()
            val events = mutableListOf<LiveEvent>()
            val job = backgroundScope.launch { stream.events.collect { events.add(it) } }

            runCurrent()

            assertEquals(Connection.Open, stream.connection.value)
            assertEquals(1, events.size)
            assertTrue(events[0] is LiveEvent.Connected)
            assertEquals("c1", (events[0] as LiveEvent.Connected).clientId)
            assertEquals(1, transport.active)

            job.cancel()
            runCurrent()
            assertEquals(0, transport.active)
        }

    @Test
    fun reconnectsWithLastEventId() =
        runTest {
            val transport =
                ScriptedTransport { attempt, _ ->
                    when (attempt) {
                        0 -> listOf(Step.Emit("id: 77\nevent: heartbeat\ndata: {\"time\":\"t\"}\n\n"), Step.Complete)
                        else -> listOf(Step.Hang)
                    }
                }
            val client =
                SseClient(transport) {
                    nowMillis = { currentTime }
                    baseRetryDelayMillis = 1_000
                    random = { 0.5 }
                }
            val stream = LiveFeed(client).open()
            backgroundScope.launch { stream.events.collect {} }

            runCurrent()
            advanceTimeBy(1_000)
            runCurrent()

            assertEquals(2, transport.opens.size)
            assertNull(transport.opens[0])
            assertEquals("77", transport.opens[1])
        }

    private sealed interface Step {
        data class Emit(
            val chunk: String,
        ) : Step

        data object Complete : Step

        data object Hang : Step
    }

    private class ScriptedTransport(
        private val script: (attempt: Int, lastEventId: String?) -> List<Step>,
    ) : SseTransport {
        val opens: MutableList<String?> = mutableListOf()
        var active: Int = 0
            private set

        override fun open(request: SseRequest): Flow<String> {
            val attempt = opens.size
            opens.add(request.lastEventId)
            val steps = script(attempt, request.lastEventId)
            return flow {
                active += 1
                try {
                    for (step in steps) {
                        when (step) {
                            is Step.Emit -> emit(step.chunk)
                            Step.Complete -> return@flow
                            Step.Hang -> awaitCancellation()
                        }
                    }
                } finally {
                    active -= 1
                }
            }
        }
    }
}
