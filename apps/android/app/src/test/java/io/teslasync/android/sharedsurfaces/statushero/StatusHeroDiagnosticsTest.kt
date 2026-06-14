package io.teslasync.android.sharedsurfaces.statushero

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — never
 * the status, headline, or subline — so a diagnostics line can never leak a vehicle's instance health. Runs in
 * the :android:testReleaseUnitTest gate.
 */
class StatusHeroDiagnosticsTest {
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
        assertEquals("StatusHero", StatusHeroDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAtInfoAndNothingElse() {
        val logger = RecordingLogger()

        StatusHeroDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        val (level, _, fields) = opened.single()
        assertEquals(LogLevel.Info, level)
        assertEquals(mapOf("surface" to "StatusHero"), fields)
    }

    @Test
    fun diagnosticCarriesNoStatusPayload() {
        val logger = RecordingLogger()

        StatusHeroDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no status word or digit could have leaked through it.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
