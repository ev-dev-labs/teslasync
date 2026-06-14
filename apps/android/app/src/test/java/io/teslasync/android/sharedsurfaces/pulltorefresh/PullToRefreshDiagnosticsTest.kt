package io.teslasync.android.sharedsurfaces.pulltorefresh

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no pull
 * distance, threshold, or refresh outcome — so a diagnostics line can never leak what the user was viewing or
 * doing. Runs in the :android:testReleaseUnitTest gate.
 */
class PullToRefreshDiagnosticsTest {
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
        assertEquals("PullToRefresh", PullToRefreshDiagnostics.SLUG)
        assertEquals(PULL_TO_REFRESH_SLUG, PullToRefreshDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        PullToRefreshDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "PullToRefresh"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoGesturePayload() {
        val logger = RecordingLogger()

        PullToRefreshDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no pull/threshold detail could have leaked.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
