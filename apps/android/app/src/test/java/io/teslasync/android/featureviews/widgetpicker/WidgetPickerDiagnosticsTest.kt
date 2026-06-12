package io.teslasync.android.featureviews.widgetpicker

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * search text, no active widget ids, no callbacks — so a diagnostics line can never leak what the operator was
 * doing. Runs in the :android:testReleaseUnitTest gate.
 */
class WidgetPickerDiagnosticsTest {
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
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        WidgetPickerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "WidgetPicker"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesOnlyTheSurfaceField() {
        val logger = RecordingLogger()

        WidgetPickerDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.contains("@") || it.contains("/") })
    }
}
