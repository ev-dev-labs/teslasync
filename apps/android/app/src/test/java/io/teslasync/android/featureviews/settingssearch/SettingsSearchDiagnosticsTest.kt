package io.teslasync.android.featureviews.settingssearch

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * typed query text and no matched setting route — so a diagnostics line can never leak what the user is
 * searching for or where they are navigating to. Runs in the offline `:app:testReleaseUnitTest` gate.
 */
class SettingsSearchDiagnosticsTest {
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
    fun slugAndIdMatchTheSurfaceContract() {
        assertEquals("SettingsSearch", SettingsSearchDiagnostics.SLUG)
        assertEquals("settings-search", SettingsSearchDiagnostics.ID)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        SettingsSearchDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.events.size)
        val (level, event, fields) = logger.events.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SettingsSearch"), fields)
    }

    @Test
    fun diagnosticCarriesNoQueryOrRouteFields() {
        val logger = RecordingLogger()

        SettingsSearchDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        // The only value is the static slug — it carries no path separators or query payload.
        assertTrue(fields.values.none { it.contains('/') })
    }
}
