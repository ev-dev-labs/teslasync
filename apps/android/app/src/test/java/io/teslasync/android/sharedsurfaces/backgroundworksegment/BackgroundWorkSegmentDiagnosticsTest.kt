// Verifies the PII-safe diagnostics (P1/S11): both the one-shot `view.opened` and the per-interaction
// `backgroundWork.retry` emit the surface slug and nothing else — no job label, count, or payload — so a
// diagnostics line can never leak what work a user has in flight. Runs in the :android:testReleaseUnitTest gate.
package io.teslasync.android.sharedsurfaces.backgroundworksegment

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundWorkSegmentDiagnosticsTest {
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
        assertEquals("BackgroundWorkSegment", BackgroundWorkSegmentDiagnostics.SLUG)
        assertEquals("BackgroundWorkSegment", BackgroundWorkSegmentRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        BackgroundWorkSegmentDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "BackgroundWorkSegment"), opened.single().second)
    }

    @Test
    fun recordRetryEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        BackgroundWorkSegmentDiagnostics.recordRetry(logger)

        val retried = logger.events.filter { it.first == "backgroundWork.retry" }
        assertEquals(1, retried.size)
        assertEquals(mapOf("surface" to "BackgroundWorkSegment"), retried.single().second)
    }

    @Test
    fun diagnosticsCarryNoJobOrPayloadFields() {
        val logger = RecordingLogger()

        BackgroundWorkSegmentDiagnostics.recordViewOpened(logger)
        BackgroundWorkSegmentDiagnostics.recordRetry(logger)

        logger.events.forEach { (_, fields) ->
            assertEquals(setOf("surface"), fields.keys)
            assertTrue("the slug carries no path separator", fields.values.none { it.contains('/') })
        }
    }
}
