package io.teslasync.android.sharedsurfaces.scrollrestoration

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * route key and no scroll offset — so a diagnostics line can never leak which screen a user visited or how far
 * they scrolled it. Runs in the :android:testReleaseUnitTest gate.
 */
class ScrollRestorationDiagnosticsTest {
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
        assertEquals("ScrollRestoration", ScrollRestorationDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        ScrollRestorationDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ScrollRestoration"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoRouteKeyOrScrollOffsetPayload() {
        val logger = RecordingLogger()

        ScrollRestorationDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // No path separator can have leaked a route key, and no digit can have leaked a scroll offset.
        assertTrue(fields.values.none { value -> value.contains('/') })
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
