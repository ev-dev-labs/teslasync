package io.teslasync.android.featureviews.batteryrangepanel

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits only the surface slug — never a battery
 * level, range, charge rate, or time-to-full — so a diagnostics line can never leak the vehicle's state.
 */
class BatteryRangePanelDiagnosticsTest {
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
        assertEquals("BatteryRangePanel", BatteryRangePanelDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        BatteryRangePanelDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "BatteryRangePanel"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoVehicleStateFields() {
        val logger = RecordingLogger()

        BatteryRangePanelDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // No numeric battery/range/charge value can have leaked into the single surface field.
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
