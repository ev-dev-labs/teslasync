package io.teslasync.android.sharedsurfaces.metricswitcherchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no metric
 * label, value, or chart title — so a diagnostics line can never leak what the operator was viewing. Runs in the
 * :app:testReleaseUnitTest gate.
 */
class MetricSwitcherChartDiagnosticsTest {
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
        assertEquals("MetricSwitcherChart", MetricSwitcherChartDiagnostics.SLUG)
        assertEquals(METRIC_SWITCHER_CHART_SLUG, MetricSwitcherChartDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        MetricSwitcherChartDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "MetricSwitcherChart"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoMetricOrTitlePayload() {
        val logger = RecordingLogger()

        MetricSwitcherChartDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no metric label or chart title could have leaked.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
