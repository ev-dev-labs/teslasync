// Verifies the PII-safe diagnostics (P1/S11): the one-shot `view.opened` emits the surface slug and nothing
// else — no error status, no message, no connectivity payload — so a diagnostics line can never leak which
// query failed or why. Runs in the :app:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.queryerror

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QueryErrorDiagnosticsTest {
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
        assertEquals("QueryError", QueryErrorRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordQueryErrorOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "QueryError"), opened.single().second)
    }

    @Test
    fun diagnosticsCarryNoErrorOrConnectivityPayload() {
        val logger = RecordingLogger()

        recordQueryErrorOpened(logger)

        logger.events.forEach { (_, fields) ->
            assertEquals(setOf("surface"), fields.keys)
            assertTrue("the slug carries no path separator", fields.values.none { it.contains('/') })
        }
    }
}
