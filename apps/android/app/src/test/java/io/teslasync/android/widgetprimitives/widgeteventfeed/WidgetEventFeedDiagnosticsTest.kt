package io.teslasync.android.widgetprimitives.widgeteventfeed

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else —
 * never an event title, subtitle, timestamp or href — so a diagnostics line can never leak a location or a
 * vehicle's activity through this feed. Runs in the `:app:testReleaseUnitTest` gate.
 */
class WidgetEventFeedDiagnosticsTest {
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
        assertEquals("WidgetEventFeed", WidgetEventFeedDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        WidgetEventFeedDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "WidgetEventFeed"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoEventPayload() {
        val logger = RecordingLogger()

        WidgetEventFeedDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no digit could have leaked a timestamp or id into it.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
