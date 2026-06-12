package io.teslasync.android.featureviews.sliderenderer

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SlideRenderer PII-safe diagnostics (P1/S11). The web component emits no
 * telemetry; the native surface adds the one sanctioned `view.opened` event carrying only the surface slug
 * — no VIN, location, or actor. Runs in the :app:testReleaseUnitTest gate with a recording [Logger].
 */
class SlideRendererDiagnosticsTest {
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
    fun recordViewOpenedEmitsExactlyTheSurfaceSlug() {
        val logger = RecordingLogger()
        recordSlideRendererOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "SlideRenderer"), opened.single().second)
    }

    @Test
    fun viewOpenedFieldsCarryNoPii() {
        val logger = RecordingLogger()
        recordSlideRendererOpened(logger)
        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.contains("vin", ignoreCase = true) })
    }

    @Test
    fun slugConstantIsStable() {
        assertEquals("SlideRenderer", SLIDE_RENDERER_SLUG)
    }
}
