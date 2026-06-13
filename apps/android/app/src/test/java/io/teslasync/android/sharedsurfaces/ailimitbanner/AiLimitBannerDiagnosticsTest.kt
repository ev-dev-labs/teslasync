package io.teslasync.android.sharedsurfaces.ailimitbanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * reason, no provider message, no retry timing — so a diagnostics line can never leak the operator's AI usage
 * state. Runs in the :app:testReleaseUnitTest gate.
 */
class AiLimitBannerDiagnosticsTest {
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
        assertEquals("AiLimitBanner", AiLimitBannerDiagnostics.SLUG)
        assertEquals(AI_LIMIT_BANNER_SLUG, AiLimitBannerDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        AiLimitBannerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "AiLimitBanner"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoReasonOrMessagePayload() {
        val logger = RecordingLogger()

        AiLimitBannerDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, no provider sentence could have leaked into it.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
