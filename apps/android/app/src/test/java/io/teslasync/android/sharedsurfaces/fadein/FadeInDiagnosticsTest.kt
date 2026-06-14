package io.teslasync.android.sharedsurfaces.fadein

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Verifies the PII-safe diagnostic (P1/S11): `view.opened` emits only the surface slug — no child content, no
 * timing, no user data — so a diagnostics line can never leak what was faded into view. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class FadeInDiagnosticsTest {
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
        assertEquals("FadeIn", FadeInDiagnostics.SLUG)
        assertEquals(FADE_IN_SLUG, FadeInDiagnostics.SLUG)
        assertEquals("FadeIn", FadeInRegistration.SLUG)
        assertEquals("fade-in", FadeInRegistration.ID)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        FadeInDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "FadeIn"), opened.single().third)
    }
}
