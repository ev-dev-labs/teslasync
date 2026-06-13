package io.teslasync.android.sharedsurfaces.chartexportmenu

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no chart
 * title, no file name, no copy outcome — so a diagnostics line can never leak what the operator exported. Runs
 * in the :android:testReleaseUnitTest gate.
 */
class ChartExportMenuDiagnosticsTest {
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
        assertEquals("ChartExportMenu", ChartExportMenuDiagnostics.SLUG)
        assertEquals(CHART_EXPORT_MENU_SLUG, ChartExportMenuDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        ChartExportMenuDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ChartExportMenu"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoChartOrFilePayload() {
        val logger = RecordingLogger()

        ChartExportMenuDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no chart title or file name could have leaked.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
