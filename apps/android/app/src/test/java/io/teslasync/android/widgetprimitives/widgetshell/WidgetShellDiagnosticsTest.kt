package io.teslasync.android.widgetprimitives.widgetshell

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Verifies the PII-safe diagnostic (P1/S11): `view.opened` emits only the surface slug — never the title, help
 * text, freshness timestamp, or any host-supplied copy — so a diagnostics line can never leak what the shell
 * wraps. Runs in the :android:testReleaseUnitTest gate.
 */
class WidgetShellDiagnosticsTest {
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
        assertEquals("WidgetShell", WidgetShellRegistration.SLUG)
        assertEquals("widget-shell", WidgetShellRegistration.ID)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        WidgetShellDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "WidgetShell"), opened.single().third)
    }
}
