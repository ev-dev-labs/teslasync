package io.teslasync.android.sharedsurfaces.staggercontainer

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Verifies the PII-safe diagnostic (P1/S11): `view.opened` emits only the surface slug — no child content, no
 * count, no user data — so a diagnostics line can never leak what was staggered into view. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class StaggerContainerDiagnosticsTest {
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
        assertEquals("StaggerContainer", StaggerContainerDiagnostics.SLUG)
        assertEquals(STAGGER_CONTAINER_SLUG, StaggerContainerDiagnostics.SLUG)
        assertEquals("StaggerContainer", StaggerContainerRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        StaggerContainerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "StaggerContainer"), opened.single().third)
    }
}
