package io.teslasync.android.widgetprimitives.widgetgaugehero

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): `view.opened` emits ONLY the surface slug — never a gauge value,
 * label, unit, or stat — so a diagnostics line can never leak what the widget is showing. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class WidgetGaugeHeroDiagnosticsTest {
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
        assertEquals("WidgetGaugeHero", WidgetGaugeHeroDiagnostics.SLUG)
        assertEquals(WIDGET_GAUGE_HERO_SLUG, WidgetGaugeHeroDiagnostics.SLUG)
        assertEquals("WidgetGaugeHero", WidgetGaugeHeroRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        WidgetGaugeHeroDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == WidgetGaugeHeroDiagnostics.EVENT_VIEW_OPENED }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "WidgetGaugeHero"), opened.single().third)
    }

    @Test
    fun viewOpenedCarriesNoUserPayload() {
        val logger = RecordingLogger()

        WidgetGaugeHeroDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf(WidgetGaugeHeroDiagnostics.FIELD_SURFACE), fields.keys)
        assertTrue("only the constant slug may be emitted", fields.values.all { it == "WidgetGaugeHero" })
    }
}
