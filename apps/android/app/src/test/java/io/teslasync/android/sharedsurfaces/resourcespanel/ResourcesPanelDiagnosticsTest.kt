package io.teslasync.android.sharedsurfaces.resourcespanel

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — never a
 * row label, value, percent, or the footnote (which can name a host's memory/threads/pool) — so a diagnostics
 * line can never leak what the panel shows. Runs in the :android:testReleaseUnitTest gate.
 */
class ResourcesPanelDiagnosticsTest {
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
        assertEquals("ResourcesPanel", ResourcesPanelDiagnostics.SLUG)
        assertEquals(ResourcesPanelDiagnostics.SLUG, ResourcesPanelRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAtInfoAndNothingElse() {
        val logger = RecordingLogger()

        ResourcesPanelDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        val (level, _, fields) = opened.single()
        assertEquals(LogLevel.Info, level)
        assertEquals(mapOf("surface" to "ResourcesPanel"), fields)
    }

    @Test
    fun diagnosticCarriesNoRowOrPercentPayload() {
        val logger = RecordingLogger()

        ResourcesPanelDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no percent digit or value could have leaked through it.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
