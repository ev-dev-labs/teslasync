package io.teslasync.android.sharedsurfaces.input

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): `view.opened` emits ONLY the surface slug — never the typed
 * value, the label, or any user data — so a diagnostics line can never leak what is being entered. Runs in
 * the :android:testReleaseUnitTest gate.
 */
class InputDiagnosticsTest {
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
        assertEquals("Input", InputDiagnostics.SLUG)
        assertEquals(INPUT_SLUG, InputDiagnostics.SLUG)
        assertEquals("Input", InputRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        InputDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "Input"), opened.single().third)
    }

    @Test
    fun viewOpenedCarriesNoUserPayload() {
        val logger = RecordingLogger()

        InputDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        assertTrue("only the constant slug may be emitted", fields.values.all { it == "Input" })
    }
}
