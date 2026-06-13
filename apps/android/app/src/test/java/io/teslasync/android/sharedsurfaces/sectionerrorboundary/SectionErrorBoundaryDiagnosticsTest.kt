package io.teslasync.android.sharedsurfaces.sectionerrorboundary

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): `view.opened` emits only the surface slug, and the `caught`
 * event (the native analogue of the web boundary's `componentDidCatch` log) emits only the surface slug, the
 * host `name` correlation id, and the error TYPE — never the captured message or stack — so a diagnostics line
 * can never leak guarded content or why a child failed. Runs in the :android:testReleaseUnitTest gate.
 */
class SectionErrorBoundaryDiagnosticsTest {
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
        assertEquals("SectionErrorBoundary", SectionErrorBoundaryDiagnostics.SLUG)
        assertEquals(SECTION_ERROR_BOUNDARY_SLUG, SectionErrorBoundaryDiagnostics.SLUG)
        assertEquals("SectionErrorBoundary", SectionErrorBoundaryRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        SectionErrorBoundaryDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "SectionErrorBoundary"), opened.single().third)
    }

    @Test
    fun recordCaughtCarriesOnlySlugNameAndErrorType() {
        val logger = RecordingLogger()

        SectionErrorBoundaryDiagnostics.recordCaught(
            logger,
            name = "BatteryDegradationChart",
            errorType = "IllegalStateException",
        )

        val caught = logger.events.single { it.second == "sectionErrorBoundary.caught" }
        assertEquals(LogLevel.Warn, caught.first)
        assertEquals(
            mapOf(
                "surface" to "SectionErrorBoundary",
                "name" to "BatteryDegradationChart",
                "errorType" to "IllegalStateException",
            ),
            caught.third,
        )
    }

    @Test
    fun caughtDiagnosticCarriesNoMessageOrStackPayload() {
        val logger = RecordingLogger()

        SectionErrorBoundaryDiagnostics.recordCaught(
            logger,
            name = "chart",
            errorType = errorTypeOf(IllegalStateException("leaked detail 5YJ")),
        )

        val fields = logger.events.single().third
        assertEquals(setOf("surface", "name", "errorType"), fields.keys)
        assertTrue("no field may carry the captured message", fields.values.none { it.contains("leaked") })
        assertFalse(fields.containsValue("leaked detail 5YJ"))
    }
}
