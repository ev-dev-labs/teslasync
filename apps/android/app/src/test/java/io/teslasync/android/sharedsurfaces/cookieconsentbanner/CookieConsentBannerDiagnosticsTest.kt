package io.teslasync.android.sharedsurfaces.cookieconsentbanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): the one-shot `view.opened` emits the surface slug and nothing else
 * — no consent decision and no deployment detail — so a diagnostics line can never leak the user's privacy
 * posture. Runs in the :app:testReleaseUnitTest gate.
 */
class CookieConsentBannerDiagnosticsTest {
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
        assertEquals("CookieConsentBanner", CookieConsentBannerRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordCookieConsentOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "CookieConsentBanner"), opened.single().second)
    }

    @Test
    fun diagnosticsCarryNoConsentDecisionOrDeploymentPayload() {
        val logger = RecordingLogger()

        recordCookieConsentOpened(logger)

        logger.events.forEach { (_, fields) ->
            assertEquals(setOf("surface"), fields.keys)
            assertTrue("the slug carries no path separator", fields.values.none { it.contains('/') })
        }
    }
}
