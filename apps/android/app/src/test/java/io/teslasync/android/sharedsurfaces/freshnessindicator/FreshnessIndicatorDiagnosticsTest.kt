package io.teslasync.android.sharedsurfaces.freshnessindicator

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — never
 * the timestamp, age, or freshness status — so a diagnostics line can never leak when a vehicle last reported
 * a signal or whether its data is stale. Runs in the :app:testReleaseUnitTest gate.
 */
class FreshnessIndicatorDiagnosticsTest {
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
        assertEquals("FreshnessIndicator", FreshnessIndicatorDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        FreshnessIndicatorDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "FreshnessIndicator"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoTimestampOrAgePayload() {
        val logger = RecordingLogger()

        FreshnessIndicatorDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no digit could have leaked a timestamp or age into it.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
