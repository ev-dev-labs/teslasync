package io.teslasync.android.sharedsurfaces.draftrecoverybanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no noun,
 * no draft contents, no persisted timestamp — so a diagnostics line can never leak what the operator was editing.
 * Runs in the :app:testReleaseUnitTest gate.
 */
class DraftRecoveryBannerDiagnosticsTest {
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
        assertEquals("DraftRecoveryBanner", DraftRecoveryBannerDiagnostics.SLUG)
        assertEquals(DRAFT_RECOVERY_BANNER_SLUG, DraftRecoveryBannerDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        DraftRecoveryBannerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "DraftRecoveryBanner"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoDraftPayload() {
        val logger = RecordingLogger()

        DraftRecoveryBannerDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no noun or sentence could have leaked into it.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
