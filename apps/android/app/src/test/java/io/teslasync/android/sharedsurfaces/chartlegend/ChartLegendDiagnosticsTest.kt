package io.teslasync.android.sharedsurfaces.chartlegend

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): both the one-shot `view.opened` and the per-interaction
 * `chartLegend.toggle` emit the surface slug and nothing else — no chart id and no series key — so a
 * diagnostics line can never leak which chart a user viewed or which series they hid. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class ChartLegendDiagnosticsTest {
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
        assertEquals("ChartLegend", ChartLegendRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordChartLegendOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ChartLegend"), opened.single().second)
    }

    @Test
    fun recordToggleEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordChartLegendToggle(logger)

        val toggled = logger.events.filter { it.first == "chartLegend.toggle" }
        assertEquals(1, toggled.size)
        assertEquals(mapOf("surface" to "ChartLegend"), toggled.single().second)
    }

    @Test
    fun diagnosticsCarryNoChartOrSeriesPayload() {
        val logger = RecordingLogger()

        recordChartLegendOpened(logger)
        recordChartLegendToggle(logger)

        logger.events.forEach { (_, fields) ->
            assertEquals(setOf("surface"), fields.keys)
            assertTrue("the slug carries no path separator", fields.values.none { it.contains('/') })
        }
    }
}
