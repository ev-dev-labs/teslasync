package io.teslasync.shared.core.presentation.logstream

import io.teslasync.shared.core.net.sse.FakeSseTransport
import io.teslasync.shared.core.net.sse.SseStep
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class LogStreamStoreTest {
    private fun logFrame(
        level: String,
        msg: String = "m",
    ): String = "event: log\ndata: {\"level\":\"$level\",\"msg\":\"$msg\"}\n\n"

    private fun dropFrame(body: String): String = "event: drop\ndata: $body\n\n"

    private fun transportEmitting(stepsFor0: () -> List<SseStep>): FakeSseTransport =
        FakeSseTransport { attempt, _ ->
            if (attempt == 0) stepsFor0() else listOf(SseStep.Hang)
        }

    private fun storeOver(
        transport: FakeSseTransport,
        scope: kotlinx.coroutines.CoroutineScope,
        level: LogStreamLevel = LogStreamLevel.Info,
        grep: String = "",
        maxEvents: Int = LOG_STREAM_MAX_EVENTS,
    ): LogStreamStore =
        LogStreamStore(
            transport = transport,
            scope = scope,
            level = level,
            grep = grep,
            maxEvents = maxEvents,
            nowMillis = { 123L },
        )

    @Test
    fun appendsLogEventsInOrderAndMarksConnected() =
        runTest {
            val transport =
                transportEmitting {
                    listOf(SseStep.Emit(logFrame("info")), SseStep.Emit(logFrame("warn")), SseStep.Hang)
                }
            val store = storeOver(transport, backgroundScope, grep = "mqtt")
            store.start()
            runCurrent()

            val s = store.state.value
            assertEquals(listOf("info", "warn"), s.events.map { it.level })
            assertEquals(2, s.totalReceived)
            assertEquals(0, s.drops)
            assertTrue(s.isConnected)
            assertNull(s.error)
            assertEquals(123L, s.events.first().receivedAt)
            // endpoint + snake_case params parity.
            assertEquals("/admin/logs/stream?level=info&grep=mqtt", transport.opens.single().path)
        }

    @Test
    fun accumulatesDropCount() =
        runTest {
            val transport =
                transportEmitting {
                    listOf(SseStep.Emit(dropFrame("{\"count\":2}")), SseStep.Emit(dropFrame("{\"count\":3}")), SseStep.Hang)
                }
            val store = storeOver(transport, backgroundScope)
            store.start()
            runCurrent()

            assertEquals(5, store.state.value.drops)
            assertEquals(0, store.state.value.totalReceived)
        }

    @Test
    fun ignoresBackendDropKeysForWebParity() =
        runTest {
            val transport =
                transportEmitting {
                    listOf(SseStep.Emit(dropFrame("{\"missed\":4,\"total\":9}")), SseStep.Hang)
                }
            val store = storeOver(transport, backgroundScope)
            store.start()
            runCurrent()

            // Web hook reads `count`; backend's missed/total are ignored verbatim.
            assertEquals(0, store.state.value.drops)
        }

    @Test
    fun ignoresConnectedAndHeartbeatFrames() =
        runTest {
            val transport =
                transportEmitting {
                    listOf(
                        SseStep.Emit("event: connected\ndata: {\"level\":\"info\"}\n\n"),
                        SseStep.Emit("event: heartbeat\ndata: {\"at\":\"t\"}\n\n"),
                        SseStep.Emit(logFrame("info")),
                        SseStep.Hang,
                    )
                }
            val store = storeOver(transport, backgroundScope)
            store.start()
            runCurrent()

            assertEquals(
                listOf("info"),
                store.state.value.events
                    .map { it.level },
            )
            assertEquals(1, store.state.value.totalReceived)
        }

    @Test
    fun boundedEvictionDropsOldest() =
        runTest {
            val transport =
                transportEmitting {
                    listOf(
                        SseStep.Emit(logFrame("debug")),
                        SseStep.Emit(logFrame("info")),
                        SseStep.Emit(logFrame("warn")),
                        SseStep.Hang,
                    )
                }
            val store = storeOver(transport, backgroundScope, maxEvents = 2)
            store.start()
            runCurrent()

            assertEquals(
                listOf("info", "warn"),
                store.state.value.events
                    .map { it.level },
            )
            assertEquals(3, store.state.value.totalReceived)
        }

    @Test
    fun malformedLogPayloadStillAppendsWithInfoLevel() =
        runTest {
            val transport =
                transportEmitting {
                    listOf(SseStep.Emit("event: log\ndata: not-json\n\n"), SseStep.Hang)
                }
            val store = storeOver(transport, backgroundScope)
            store.start()
            runCurrent()

            val ev =
                store.state.value.events
                    .single()
            assertEquals("info", ev.level)
            assertNull(ev.parsed)
            assertEquals("not-json", ev.payload)
        }

    @Test
    fun pauseSkipsLogsButKeepsConnectionAndDrops() =
        runTest {
            val transport =
                transportEmitting {
                    listOf(
                        SseStep.Emit(logFrame("info")),
                        SseStep.Wait(1_000),
                        SseStep.Emit(dropFrame("{\"count\":2}")),
                        SseStep.Emit(logFrame("warn")),
                        SseStep.Wait(1_000),
                        SseStep.Emit(logFrame("error")),
                        SseStep.Hang,
                    )
                }
            val store = storeOver(transport, backgroundScope)
            store.start()
            runCurrent()
            assertEquals(
                listOf("info"),
                store.state.value.events
                    .map { it.level },
            )

            store.setPaused(true)
            advanceTimeBy(1_000)
            runCurrent()
            // warn was skipped; drop still counted while paused.
            assertEquals(
                listOf("info"),
                store.state.value.events
                    .map { it.level },
            )
            assertEquals(2, store.state.value.drops)

            store.setPaused(false)
            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(
                listOf("info", "error"),
                store.state.value.events
                    .map { it.level },
            )
            assertEquals(2, store.state.value.totalReceived)
            assertTrue(store.state.value.isConnected)
        }

    @Test
    fun clearResetsBufferAndCounters() =
        runTest {
            val transport =
                transportEmitting {
                    listOf(SseStep.Emit(logFrame("info")), SseStep.Emit(dropFrame("{\"count\":4}")), SseStep.Hang)
                }
            val store = storeOver(transport, backgroundScope)
            store.start()
            runCurrent()
            assertEquals(1, store.state.value.totalReceived)

            store.clear()
            assertTrue(
                store.state.value.events
                    .isEmpty(),
            )
            assertEquals(0, store.state.value.drops)
            assertEquals(0, store.state.value.totalReceived)
            // Connection is untouched by clear.
            assertTrue(store.state.value.isConnected)
        }

    @Test
    fun surfacesTransportFailureAndClearsConnected() =
        runTest {
            val transport =
                transportEmitting {
                    listOf(SseStep.Emit(logFrame("info")), SseStep.Fail(RuntimeException("stream rejected")))
                }
            val store = storeOver(transport, backgroundScope)
            store.start()
            runCurrent()

            assertEquals("stream rejected", store.state.value.error)
            assertTrue(!store.state.value.isConnected)
            // The single event received before the failure is retained.
            assertEquals(
                listOf("info"),
                store.state.value.events
                    .map { it.level },
            )
        }

    @Test
    fun stopClosesConnection() =
        runTest {
            val transport = transportEmitting { listOf(SseStep.Emit(logFrame("info")), SseStep.Hang) }
            val store = storeOver(transport, backgroundScope)
            store.start()
            runCurrent()
            assertEquals(1, transport.activeConnections)

            store.stop()
            runCurrent()
            assertEquals(0, transport.activeConnections)
            // Retained buffer survives a stop, matching the web hook's in-memory list.
            assertTrue(
                store.state.value.events
                    .isNotEmpty(),
            )
        }

    @Test
    fun doesNotReconnectAfterStreamEnds() =
        runTest {
            val transport = transportEmitting { listOf(SseStep.Emit(logFrame("info")), SseStep.Complete) }
            val store = storeOver(transport, backgroundScope)
            store.start()
            runCurrent()

            // One open only — the web hook does not auto-reconnect.
            assertEquals(1, transport.opens.size)
            assertTrue(!store.state.value.isConnected)
        }
}
