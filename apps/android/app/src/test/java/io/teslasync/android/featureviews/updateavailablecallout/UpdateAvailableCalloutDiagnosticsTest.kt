package io.teslasync.android.featureviews.updateavailablecallout

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * current/target version and no check timestamp — so a diagnostics line can never leak a deployment's version
 * posture. Runs in the :app:testReleaseUnitTest gate.
 */
class UpdateAvailableCalloutDiagnosticsTest {
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
        assertEquals("UpdateAvailableCallout", UpdateAvailableCalloutDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        UpdateAvailableCalloutDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "UpdateAvailableCallout"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoVersionOrTimestampPayload() {
        val logger = RecordingLogger()

        UpdateAvailableCalloutDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // No digit ⇒ no version string and no timestamp could have leaked into the payload.
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
