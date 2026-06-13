package io.teslasync.android.sharedsurfaces.emptystatethreshold

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — never
 * the counts, the noun, or the section label — so a diagnostics line can never leak how much data a vehicle
 * has produced or which gated section the operator is viewing. Runs in the :app:testReleaseUnitTest gate.
 */
class EmptyStateThresholdDiagnosticsTest {
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
        assertEquals("EmptyStateThreshold", EmptyStateThresholdDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        EmptyStateThresholdDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "EmptyStateThreshold"), opened.single().second)
    }

    @Test
    fun theDiagnosticCarriesNoCountPayload() {
        val logger = RecordingLogger()

        EmptyStateThresholdDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no digit could have leaked a threshold / current count into it.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
