package io.teslasync.android.widgetprimitives.widgetstatgrid

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): `view.opened` emits ONLY the surface slug — never a stat label, a
 * value, or any unit text — so a diagnostics line can never leak what was shown. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class WidgetStatGridDiagnosticsTest {
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
        assertEquals("WidgetStatGrid", WidgetStatGridDiagnostics.SLUG)
        assertEquals(WIDGET_STAT_GRID_SLUG, WidgetStatGridDiagnostics.SLUG)
        assertEquals("WidgetStatGrid", WidgetStatGridRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        WidgetStatGridDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "WidgetStatGrid"), opened.single().third)
    }

    @Test
    fun viewOpenedCarriesNoUserPayload() {
        val logger = RecordingLogger()

        WidgetStatGridDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        assertTrue("only the constant slug may be emitted", fields.values.all { it == "WidgetStatGrid" })
    }
}
