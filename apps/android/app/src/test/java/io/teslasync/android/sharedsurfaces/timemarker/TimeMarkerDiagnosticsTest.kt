package io.teslasync.android.sharedsurfaces.timemarker

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * vehicle id, no timestamp, no signal name — so a diagnostics line can never leak which alert a user opened.
 * Runs in the :android:testReleaseUnitTest gate.
 */
class TimeMarkerDiagnosticsTest {
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
        assertEquals("TimeMarker", TimeMarkerDiagnostics.SLUG)
        assertEquals(TIME_MARKER_SLUG, TimeMarkerDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        TimeMarkerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "TimeMarker"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoAlertPayload() {
        val logger = RecordingLogger()

        TimeMarkerDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no alert detail could have leaked.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
