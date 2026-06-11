package io.teslasync.android.featureviews.livevehiclestate

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * lock / sentry / valet / seat / key value — so a diagnostics line can never leak the vehicle's security
 * posture.
 */
class LiveVehicleStateDiagnosticsTest {
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
        assertEquals("LiveVehicleState", LiveVehicleStateDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        LiveVehicleStateDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "LiveVehicleState"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoSignalFields() {
        val logger = RecordingLogger()

        LiveVehicleStateDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
