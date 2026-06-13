package io.teslasync.android.sharedsurfaces.charttooltip

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * series name, no value, no axis label — so a diagnostics line can never leak what the operator was hovering.
 * Runs in the :android:testReleaseUnitTest gate.
 */
class ChartTooltipDiagnosticsTest {
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
        assertEquals("ChartTooltip", ChartTooltipDiagnostics.SLUG)
        assertEquals(CHART_TOOLTIP_SLUG, ChartTooltipDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        ChartTooltipDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ChartTooltip"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoPayloadBeyondTheSlug() {
        val logger = RecordingLogger()

        ChartTooltipDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no series name or label could have leaked.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
