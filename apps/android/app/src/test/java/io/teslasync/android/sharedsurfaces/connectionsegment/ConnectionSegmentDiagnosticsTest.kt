// Verifies the PII-safe diagnostics (P1/S11): the one-shot `view.opened` emits the surface slug and nothing
// else — no latency, no request payload, no path-separated value — so a diagnostics line can never leak anything
// about the user's session. Runs in the :app:testReleaseUnitTest gate.
package io.teslasync.android.sharedsurfaces.connectionsegment

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionSegmentDiagnosticsTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("ConnectionSegment", ConnectionSegmentRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordConnectionSegmentOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ConnectionSegment"), opened.single().second)
    }

    @Test
    fun diagnosticsCarryNoSessionPayload() {
        val logger = RecordingLogger()

        recordConnectionSegmentOpened(logger)

        logger.events.forEach { (_, fields) ->
            assertEquals(setOf("surface"), fields.keys)
            assertTrue("the slug carries no path separator", fields.values.none { it.contains('/') })
        }
    }
}
