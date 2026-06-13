package io.teslasync.android.sharedsurfaces.routeannouncer

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * route path and no page title — so a diagnostics line can never leak which screen a user navigated to. Runs
 * in the :app:testReleaseUnitTest gate.
 */
class RouteAnnouncerDiagnosticsTest {
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
        assertEquals("RouteAnnouncer", RouteAnnouncerDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        RouteAnnouncerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "RouteAnnouncer"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoRouteOrTitlePayload() {
        val logger = RecordingLogger()

        RouteAnnouncerDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // No path separator can have leaked a route, and the slug carries no digits.
        assertTrue(fields.values.none { it.contains('/') })
    }
}
