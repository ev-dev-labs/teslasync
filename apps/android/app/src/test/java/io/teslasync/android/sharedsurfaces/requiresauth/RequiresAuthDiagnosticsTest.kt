package io.teslasync.android.sharedsurfaces.requiresauth

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — never the
 * deployment auth mode, the capability gate, or the operator's provider hint — so a diagnostics line can never
 * leak the deployment's auth posture. Runs in the :android:testReleaseUnitTest gate.
 */
class RequiresAuthDiagnosticsTest {
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
    fun registrationExposesTheStableSurfaceSlug() {
        assertEquals("RequiresAuth", RequiresAuthRegistration.SLUG)
        assertEquals(RequiresAuthRegistration.SLUG, RequiresAuthDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        RequiresAuthDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "RequiresAuth"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoAuthModeCapabilityOrProviderHintFields() {
        val logger = RecordingLogger()

        RequiresAuthDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.contains("forward_auth") || it.contains("open") })
    }
}
