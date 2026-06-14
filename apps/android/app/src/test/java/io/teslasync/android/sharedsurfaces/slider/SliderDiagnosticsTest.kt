package io.teslasync.android.sharedsurfaces.slider

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): `view.opened` emits ONLY the surface slug — never the slider value,
 * the bounds, or the label — so a diagnostics line can never leak what the user is adjusting. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class SliderDiagnosticsTest {
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
        assertEquals("Slider", SliderDiagnostics.SLUG)
        assertEquals(SLIDER_SLUG, SliderDiagnostics.SLUG)
        assertEquals("Slider", SliderRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        SliderDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "Slider"), opened.single().third)
    }

    @Test
    fun viewOpenedCarriesNoUserPayload() {
        val logger = RecordingLogger()

        SliderDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        assertTrue("only the constant slug may be emitted", fields.values.all { it == "Slider" })
    }
}
