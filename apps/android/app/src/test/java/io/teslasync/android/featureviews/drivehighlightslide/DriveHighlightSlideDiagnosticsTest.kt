package io.teslasync.android.featureviews.drivehighlightslide

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * route addresses, distance, duration, or date — so a diagnostics line can never leak where or when a user
 * drove.
 */
class DriveHighlightSlideDiagnosticsTest {
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
        assertEquals("DriveHighlightSlide", DriveHighlightSlideDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        DriveHighlightSlideDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "DriveHighlightSlide"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoPayloadFields() {
        val logger = RecordingLogger()

        DriveHighlightSlideDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
