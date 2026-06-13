// Verifies the PII-safe `view.opened` diagnostic (P1/S11) for the NavigationGuardProvider surface: it emits the
// surface slug and nothing else — never a guard id, a form's dirty state, nor a prompt message — so a diagnostics
// line can never leak what the user was editing or where they were navigating. Runs in the
// :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.navigationguardprovider

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationGuardProviderDiagnosticsTest {
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
        assertEquals("NavigationGuardProvider", NavigationGuardProviderRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordNavigationGuardProviderOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "NavigationGuardProvider"), opened.single().third)
    }

    @Test
    fun diagnosticCarriesNoGuardOrFormPayload() {
        val logger = RecordingLogger()

        recordNavigationGuardProviderOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no guard id, dirty flag, or prompt message could have leaked into it.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
