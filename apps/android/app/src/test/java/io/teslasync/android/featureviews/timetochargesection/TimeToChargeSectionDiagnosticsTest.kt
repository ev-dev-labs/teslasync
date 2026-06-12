package io.teslasync.android.featureviews.timetochargesection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the TimeToChargeSection diagnostics contract (P1/S11): the surface emits exactly
 * one `view.opened` event carrying only its `surface` slug — never a VIN, location, charge rate, or session
 * id — so a diagnostics line can never leak the fleet's identity or charging posture. Runs in the
 * :android:testReleaseUnitTest gate with a recording [Logger]; no Compose, no device.
 */
class TimeToChargeSectionDiagnosticsTest {
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
        recordTimeToChargeSectionOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "TimeToChargeSection"), opened.single().second)
    }

    @Test
    fun slugIsStable() {
        assertEquals("TimeToChargeSection", TimeToChargeSectionRegistration.SLUG)
    }
}
