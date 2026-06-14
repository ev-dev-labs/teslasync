package io.teslasync.android.sharedsurfaces.typography

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): `view.opened` emits ONLY the surface slug — never the rendered text or
 * any user data — so a diagnostics line can never leak what the surface is displaying. Runs in the
 * :app:testReleaseUnitTest gate.
 */
class TypographyDiagnosticsTest {
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
        assertEquals("Typography", TypographyDiagnostics.SLUG)
        assertEquals(TYPOGRAPHY_SLUG, TypographyDiagnostics.SLUG)
        assertEquals("Typography", TypographyRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        TypographyDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == TypographyDiagnostics.EVENT_VIEW_OPENED }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf(TypographyDiagnostics.FIELD_SURFACE to "Typography"), opened.single().third)
    }

    @Test
    fun viewOpenedCarriesNoUserPayload() {
        val logger = RecordingLogger()

        TypographyDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        assertTrue("only the constant slug may be emitted", fields.values.all { it == "Typography" })
    }
}
