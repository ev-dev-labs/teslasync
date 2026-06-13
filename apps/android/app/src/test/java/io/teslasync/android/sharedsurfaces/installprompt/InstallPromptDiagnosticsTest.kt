package io.teslasync.android.sharedsurfaces.installprompt

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * install-path state, no device model — so a diagnostics line can never leak whether a device can install shortcuts.
 * Runs in the :app:testReleaseUnitTest gate.
 */
class InstallPromptDiagnosticsTest {
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
        assertEquals("InstallPrompt", InstallPromptDiagnostics.SLUG)
        assertEquals(INSTALL_PROMPT_SLUG, InstallPromptDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        InstallPromptDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "InstallPrompt"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoInstallOrDevicePayload() {
        val logger = RecordingLogger()

        InstallPromptDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, no device sentence could have leaked into it.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
