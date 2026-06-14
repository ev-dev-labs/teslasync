package io.teslasync.android.widgetprimitives.widgetbignumber

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Verifies the PII-safe diagnostic (P1/S11): `view.opened` emits only the surface slug — never the rendered
 * number, unit, label, subtitle, or badge — so a diagnostics line can never leak the value the primitive
 * displays. Runs in the :android:testReleaseUnitTest gate.
 */
class WidgetBigNumberDiagnosticsTest {
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
        assertEquals("WidgetBigNumber", WidgetBigNumberRegistration.SLUG)
        assertEquals("widget-big-number", WidgetBigNumberRegistration.ID)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        WidgetBigNumberDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "WidgetBigNumber"), opened.single().third)
    }
}
