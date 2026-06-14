// Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
// coordinate, no heading, no color — so a diagnostics line can never leak where a vehicle is. Runs in the
// :android:testReleaseUnitTest gate.
package io.teslasync.android.sharedsurfaces.animatedmarker

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AnimatedMarkerDiagnosticsTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += Triple(level, event, fields)
        }
    }

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("AnimatedMarker", AnimatedMarkerDiagnostics.SLUG)
        assertEquals(AnimatedMarkerRegistration.SLUG, AnimatedMarkerDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        AnimatedMarkerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "AnimatedMarker"), opened.single().third)
    }

    @Test
    fun diagnosticCarriesNoMarkerPayload() {
        val logger = RecordingLogger()

        AnimatedMarkerDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no coordinate / heading / color could have leaked.
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
