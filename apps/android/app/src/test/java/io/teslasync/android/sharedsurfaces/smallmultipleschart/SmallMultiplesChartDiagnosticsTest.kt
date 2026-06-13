package io.teslasync.android.sharedsurfaces.smallmultipleschart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no series
 * key, timestamp, or value — so a diagnostics line can never leak what the operator was viewing. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class SmallMultiplesChartDiagnosticsTest {
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
        assertEquals("SmallMultiplesChart", SmallMultiplesChartDiagnostics.SLUG)
        assertEquals(SMALL_MULTIPLES_CHART_SLUG, SmallMultiplesChartDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        SmallMultiplesChartDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "SmallMultiplesChart"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoSeriesOrValuePayload() {
        val logger = RecordingLogger()

        SmallMultiplesChartDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no series label or value could have leaked.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
