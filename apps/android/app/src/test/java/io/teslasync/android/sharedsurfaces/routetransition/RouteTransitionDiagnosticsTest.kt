package io.teslasync.android.sharedsurfaces.routetransition

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostic (P1/S11): the one-shot `view.opened` emits only the surface slug — never the
 * route, the page content or any user data — so a diagnostics line can never leak which screen a user navigated
 * to. Runs in the :android:testReleaseUnitTest gate.
 */
class RouteTransitionDiagnosticsTest {
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
        assertEquals("RouteTransition", RouteTransitionDiagnostics.SLUG)
        assertEquals(ROUTE_TRANSITION_SLUG, RouteTransitionDiagnostics.SLUG)
        assertEquals("RouteTransition", RouteTransitionRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        RouteTransitionDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "RouteTransition"), opened.single().third)
    }

    @Test
    fun diagnosticsCarryNoRouteOrContentPayload() {
        val logger = RecordingLogger()

        RouteTransitionDiagnostics.recordViewOpened(logger)

        logger.events.forEach { (_, _, fields) ->
            assertEquals(setOf("surface"), fields.keys)
            assertTrue("the slug carries no path separator", fields.values.none { it.contains('/') })
        }
    }
}
