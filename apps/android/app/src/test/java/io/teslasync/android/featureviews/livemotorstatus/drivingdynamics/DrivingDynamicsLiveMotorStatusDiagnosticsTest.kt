package io.teslasync.android.featureviews.livemotorstatus.drivingdynamics

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * torque, RPM, temperature, or shift reading — so a diagnostics line can never leak fleet telemetry. The slug
 * is the shared surface name `LiveMotorStatus` (both LiveMotorStatus surfaces share it, per the prompt), even
 * though this driving-dynamics port lives in its own object.
 */
class DrivingDynamicsLiveMotorStatusDiagnosticsTest {
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
        assertEquals("LiveMotorStatus", DrivingDynamicsLiveMotorStatusDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        DrivingDynamicsLiveMotorStatusDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "LiveMotorStatus"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoNumericPayload() {
        val logger = RecordingLogger()

        DrivingDynamicsLiveMotorStatusDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
