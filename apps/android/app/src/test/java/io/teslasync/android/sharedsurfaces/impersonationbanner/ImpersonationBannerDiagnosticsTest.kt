package io.teslasync.android.sharedsurfaces.impersonationbanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — never
 * the impersonation target or the original admin (opaque-but-sensitive identifiers) — so a diagnostics line can
 * never leak who an admin is impersonating. Runs in the :android:testReleaseUnitTest gate.
 */
class ImpersonationBannerDiagnosticsTest {
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
    fun registrationExposesTheStableSlugAndWebParityTestTags() {
        assertEquals("ImpersonationBanner", ImpersonationBannerRegistration.SLUG)
        assertEquals("impersonation-banner", ImpersonationBannerRegistration.BANNER_TEST_TAG)
        assertEquals("impersonation-banner-end", ImpersonationBannerRegistration.END_BUTTON_TEST_TAG)
        assertEquals("impersonation-banner-countdown", ImpersonationBannerRegistration.COUNTDOWN_TEST_TAG)
        assertEquals(ImpersonationBannerRegistration.SLUG, ImpersonationBannerDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        ImpersonationBannerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ImpersonationBanner"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoTargetAdminOrPayloadFields() {
        val logger = RecordingLogger()

        ImpersonationBannerDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.contains("@") || it.contains(":") })
    }
}
