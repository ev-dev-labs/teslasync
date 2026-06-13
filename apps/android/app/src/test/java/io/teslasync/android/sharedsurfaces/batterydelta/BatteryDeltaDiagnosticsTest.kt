package io.teslasync.android.sharedsurfaces.batterydelta

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — never
 * a state-of-charge endpoint — so a diagnostics line can never leak a vehicle's battery level or whether it
 * was driving or charging. Runs in the :app:testReleaseUnitTest gate.
 */
class BatteryDeltaDiagnosticsTest {
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
        assertEquals("BatteryDelta", BatteryDeltaDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        BatteryDeltaDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "BatteryDelta"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoBatteryOrMovementPayload() {
        val logger = RecordingLogger()

        BatteryDeltaDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no digit could have leaked a state-of-charge value into it.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
