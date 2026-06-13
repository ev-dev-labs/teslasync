package io.teslasync.android.sharedsurfaces.alertbanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * title, no body, no variant — so a diagnostics line can never leak the notice's content. Runs in the
 * :app:testReleaseUnitTest gate.
 */
class AlertBannerDiagnosticsTest {
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
        assertEquals("AlertBanner", AlertBannerDiagnostics.SLUG)
        assertEquals(ALERT_BANNER_SLUG, AlertBannerDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        AlertBannerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "AlertBanner"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoTitleOrBodyPayload() {
        val logger = RecordingLogger()

        AlertBannerDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no title/body sentence could have leaked into it.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
