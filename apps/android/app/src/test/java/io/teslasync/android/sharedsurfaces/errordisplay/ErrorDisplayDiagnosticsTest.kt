// Verifies the PII-safe diagnostics (P1/S11): both the one-shot `view.opened` and the per-interaction
// `errorDisplay.retry` emit the surface slug and nothing else — no vehicle id and no failure payload — so a
// diagnostics line can never leak what the user was viewing or why a request failed. Runs in the
// :android:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.errordisplay

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorDisplayDiagnosticsTest {
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
        assertEquals("ErrorDisplay", ErrorDisplayRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordErrorDisplayOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ErrorDisplay"), opened.single().second)
    }

    @Test
    fun recordRetryEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordErrorDisplayRetry(logger)

        val retried = logger.events.filter { it.first == "errorDisplay.retry" }
        assertEquals(1, retried.size)
        assertEquals(mapOf("surface" to "ErrorDisplay"), retried.single().second)
    }

    @Test
    fun diagnosticsCarryNoVehicleOrFailurePayload() {
        val logger = RecordingLogger()

        recordErrorDisplayOpened(logger)
        recordErrorDisplayRetry(logger)

        logger.events.forEach { (_, fields) ->
            assertEquals(setOf("surface"), fields.keys)
            assertTrue("the slug carries no path separator", fields.values.none { it.contains('/') })
        }
    }
}
