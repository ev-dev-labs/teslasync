package io.teslasync.android.widgetprimitives.widgetmapview

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): `view.opened` emits ONLY the surface slug — never a coordinate, a
 * child, or any caller text — so a diagnostics line can never leak where a vehicle is. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class WidgetMapViewDiagnosticsTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += Triple(level, event, fields)
        }
    }

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("WidgetMapView", WidgetMapViewDiagnostics.SLUG)
        assertEquals(WIDGET_MAP_VIEW_SLUG, WidgetMapViewDiagnostics.SLUG)
        assertEquals("WidgetMapView", WidgetMapViewRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        WidgetMapViewDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "WidgetMapView"), opened.single().third)
    }

    @Test
    fun viewOpenedCarriesNoLocationPayload() {
        val logger = RecordingLogger()

        WidgetMapViewDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        assertTrue("only the constant slug may be emitted", fields.values.all { it == "WidgetMapView" })
    }
}
