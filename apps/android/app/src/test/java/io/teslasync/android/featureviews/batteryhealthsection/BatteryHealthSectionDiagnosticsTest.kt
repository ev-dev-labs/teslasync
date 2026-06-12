package io.teslasync.android.featureviews.batteryhealthsection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the BatteryHealthSection diagnostics contract (P1/S11): the surface emits
 * exactly one `view.opened` event carrying only its `surface` slug — never a VIN, location, or battery
 * value — so a diagnostics line can never leak the fleet's identity or charge posture. Runs in the
 * :android:testReleaseUnitTest gate with a recording [Logger]; no Compose, no device.
 */
class BatteryHealthSectionDiagnosticsTest {
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
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordBatteryHealthSectionOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "BatteryHealthSection"), opened.single().second)
    }

    @Test
    fun slugIsStable() {
        assertEquals("BatteryHealthSection", BatteryHealthSectionRegistration.SLUG)
    }
}
