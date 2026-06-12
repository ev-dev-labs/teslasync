package io.teslasync.android.featureviews.addressinput

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * typed query text and no resolved address/coordinate — so a diagnostics line can never leak where the user
 * is searching for or routing to.
 */
class AddressInputDiagnosticsTest {
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
        assertEquals("AddressInput", AddressInputDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        AddressInputDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "AddressInput"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoQueryOrLocationFields() {
        val logger = RecordingLogger()

        AddressInputDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // No coordinate/query payload — the only value is the static slug, which carries no digits.
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
