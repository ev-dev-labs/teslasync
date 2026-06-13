package io.teslasync.android.sharedsurfaces.timelinescrubber

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * progress value, marker position, or preview figure — so a diagnostics line can never leak a user's trip
 * timeline. Runs in the :android:testReleaseUnitTest gate.
 */
class TimelineScrubberDiagnosticsTest {
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
        assertEquals("TimelineScrubber", TimelineScrubberDiagnostics.SLUG)
        assertEquals(TIMELINE_SCRUBBER_SLUG, TimelineScrubberDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        TimelineScrubberDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "TimelineScrubber"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoTimelinePayload() {
        val logger = RecordingLogger()

        TimelineScrubberDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no timeline detail could have leaked.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
