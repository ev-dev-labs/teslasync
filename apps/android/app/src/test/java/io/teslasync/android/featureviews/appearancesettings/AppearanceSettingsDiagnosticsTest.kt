package io.teslasync.android.featureviews.appearancesettings

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * density / time-format / palette / toggle value — so a diagnostics line can never leak what a user configured.
 */
class AppearanceSettingsDiagnosticsTest {
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
        assertEquals("AppearanceSettings", AppearanceSettingsRegistration.SLUG)
        assertEquals("appearance-settings", AppearanceSettingsRegistration.ID)
    }

    @Test
    fun recordViewOpenedEmitsTheSurfaceSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordAppearanceSettingsViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "AppearanceSettings"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoPreferenceFields() {
        val logger = RecordingLogger()

        recordAppearanceSettingsViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
