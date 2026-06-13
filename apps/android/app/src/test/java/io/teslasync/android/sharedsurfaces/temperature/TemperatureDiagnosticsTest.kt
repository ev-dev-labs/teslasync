package io.teslasync.android.sharedsurfaces.temperature

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — never
 * a temperature value — so a diagnostics line can never leak a cabin, battery, or ambient reading. Runs in
 * the :android:testReleaseUnitTest gate.
 */
class TemperatureDiagnosticsTest {
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
        assertEquals("Temperature", TemperatureDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        TemperatureDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "Temperature"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoTemperaturePayload() {
        val logger = RecordingLogger()

        TemperatureDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no digit could have leaked a temperature reading into it.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
