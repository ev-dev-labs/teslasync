package io.teslasync.android.sharedsurfaces.onboardingwizard

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no step
 * index, no copy — so a diagnostics line can never leak what the user is reading. Runs in the
 * :app:testReleaseUnitTest gate.
 */
class OnboardingWizardDiagnosticsTest {
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
        assertEquals("OnboardingWizard", OnboardingWizardDiagnostics.SLUG)
        assertEquals(ONBOARDING_WIZARD_SLUG, OnboardingWizardDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        OnboardingWizardDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "OnboardingWizard"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoStepOrCopyPayload() {
        val logger = RecordingLogger()

        OnboardingWizardDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no step title/body could have leaked into it.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
