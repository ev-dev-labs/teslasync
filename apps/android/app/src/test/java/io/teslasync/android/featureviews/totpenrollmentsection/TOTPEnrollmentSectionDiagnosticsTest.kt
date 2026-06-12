package io.teslasync.android.featureviews.totpenrollmentsection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * secret, backup code, or subject — so a diagnostics line can never leak the credential state.
 */
class TOTPEnrollmentSectionDiagnosticsTest {
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
        assertEquals("TOTPEnrollmentSection", TOTPEnrollmentSectionRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSurfaceSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordTOTPEnrollmentSectionOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "TOTPEnrollmentSection"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoSecretFields() {
        val logger = RecordingLogger()

        recordTOTPEnrollmentSectionOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
