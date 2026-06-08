package io.teslasync.shared.core.diagnostics

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Covers the shared [BufferedDiagnosticsSink] queue/format/emit/purge logic that
 * the platform `actual` sinks inherit — verified here with a capturing subclass
 * so no real platform logging facility is touched.
 */
class BufferedDiagnosticsSinkTest {
    private class CapturingSink : BufferedDiagnosticsSink() {
        val emitted: MutableList<String> = mutableListOf()

        override fun emit(line: String) {
            emitted.add(line)
        }
    }

    @Test
    fun formatsEachPayloadKindAndQueuesIt() {
        val sink = CapturingSink()

        sink.log(LogRecord(LogLevel.Info, "drive.sync", mapOf("drive_id" to "4412")))
        sink.event("screen_view", linkedMapOf("screen" to "home"))
        sink.breadcrumb("navigated")
        sink.crash(CrashReport("IllegalState", "boom", mapOf("code" to "500")))

        assertEquals(
            listOf(
                "[Info] drive.sync drive_id=4412",
                "EVENT screen_view screen=home",
                "BREADCRUMB navigated",
                "CRASH IllegalState: boom code=500",
            ),
            sink.emitted,
        )
        assertEquals(sink.emitted, sink.queuedLines)
    }

    @Test
    fun purgeClearsQueueButNotAlreadyEmittedSideEffects() {
        val sink = CapturingSink()
        sink.breadcrumb("one")
        assertTrue(sink.queuedLines.isNotEmpty())

        sink.purge()

        assertEquals(emptyList(), sink.queuedLines)
        // emit already happened; purge only discards the local queue.
        assertEquals(listOf("BREADCRUMB one"), sink.emitted)
    }
}
