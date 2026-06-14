package io.teslasync.android.sharedsurfaces.caranimation

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostic (P1/S11): the one-shot `view.opened` emits only the surface slug — no level,
 * size or label — so a diagnostics line can never leak what illustration was drawn into view. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class CarAnimationDiagnosticsTest {
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
        assertEquals("CarAnimation", CarAnimationDiagnostics.SLUG)
        assertEquals(CAR_ANIMATION_SLUG, CarAnimationDiagnostics.SLUG)
        assertEquals("CarAnimation", CarAnimationRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        CarAnimationDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "CarAnimation"), opened.single().third)
    }

    @Test
    fun diagnosticsCarryNoLevelOrLabelPayload() {
        val logger = RecordingLogger()

        CarAnimationDiagnostics.recordViewOpened(logger)

        logger.events.forEach { (_, _, fields) ->
            assertEquals(setOf("surface"), fields.keys)
            assertTrue("the slug carries no path separator", fields.values.none { it.contains('/') })
        }
    }
}
