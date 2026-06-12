package io.teslasync.android.featureviews.environmentalimpact

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no CO₂
 * figure, tree count, gallons, or dollar savings — so a diagnostics line can never leak a user's driving or
 * spending footprint. Runs in the :android:testReleaseUnitTest gate.
 */
class EnvironmentalImpactDiagnosticsTest {
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
        assertEquals("EnvironmentalImpact", EnvironmentalImpactDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        EnvironmentalImpactDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "EnvironmentalImpact"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoPayloadFields() {
        val logger = RecordingLogger()

        EnvironmentalImpactDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // No digit can appear in a field value, so no CO₂ figure / tree count / gallons / savings can leak.
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
