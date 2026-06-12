// Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — never
// the typed query text — so a diagnostics line can never leak what the user is searching for. No Compose /
// Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.commandsearch

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandSearchDiagnosticsTest {
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
        assertEquals("CommandSearch", CommandSearchDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        CommandSearchDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "CommandSearch"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoQueryField() {
        val logger = RecordingLogger()

        CommandSearchDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The only value is the static slug — it carries no typed query text and no digits.
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
