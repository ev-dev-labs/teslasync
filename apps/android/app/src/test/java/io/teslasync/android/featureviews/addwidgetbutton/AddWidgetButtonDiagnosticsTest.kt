package io.teslasync.android.featureviews.addwidgetbutton

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * dashboard state, no click handler — so a diagnostics line can never leak what the operator was viewing.
 * Runs in the :android:testReleaseUnitTest gate.
 */
class AddWidgetButtonDiagnosticsTest {
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

        AddWidgetButtonDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "AddWidgetButton"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesOnlyTheSurfaceField() {
        val logger = RecordingLogger()

        AddWidgetButtonDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.contains("@") || it.contains("/") })
    }
}
