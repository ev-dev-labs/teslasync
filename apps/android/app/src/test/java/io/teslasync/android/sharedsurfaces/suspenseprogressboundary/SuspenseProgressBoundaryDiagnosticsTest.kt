package io.teslasync.android.sharedsurfaces.suspenseprogressboundary

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * route, no chunk name, no timing — so a diagnostics line from this structural boundary can never reveal what
 * the operator was navigating to. Runs in the testReleaseUnitTest gate.
 */
class SuspenseProgressBoundaryDiagnosticsTest {
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
        assertEquals("SuspenseProgressBoundary", SuspenseProgressBoundaryDiagnostics.SLUG)
        assertEquals(SUSPENSE_PROGRESS_BOUNDARY_SLUG, SuspenseProgressBoundaryDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        SuspenseProgressBoundaryDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "SuspenseProgressBoundary"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoTimingOrRoutePayload() {
        val logger = RecordingLogger()

        SuspenseProgressBoundaryDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no route or sentence could have leaked into it.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
