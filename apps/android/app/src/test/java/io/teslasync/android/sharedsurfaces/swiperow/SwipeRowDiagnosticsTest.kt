package io.teslasync.android.sharedsurfaces.swiperow

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no action
 * label, offset, or fire outcome — so a diagnostics line can never leak what the user swiped or which row it was.
 * Runs in the :android:testReleaseUnitTest gate.
 */
class SwipeRowDiagnosticsTest {
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
        assertEquals("SwipeRow", SwipeRowDiagnostics.SLUG)
        assertEquals(SWIPE_ROW_SLUG, SwipeRowDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        SwipeRowDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "SwipeRow"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoGesturePayload() {
        val logger = RecordingLogger()

        SwipeRowDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no label/offset detail could have leaked.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
