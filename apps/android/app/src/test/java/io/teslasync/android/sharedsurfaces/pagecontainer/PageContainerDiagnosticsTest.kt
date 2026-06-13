package io.teslasync.android.sharedsurfaces.pagecontainer

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): the one-shot `view.opened` emits the surface slug and nothing
 * else — no page title, no error message, no breadcrumb label — so a diagnostics line can never leak what page
 * a user was on. Runs in the :android:testReleaseUnitTest gate.
 */
class PageContainerDiagnosticsTest {
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
        assertEquals("PageContainer", PageContainerRegistration.SLUG)
        assertEquals("PageContainer", PageContainerDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        PageContainerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "PageContainer"), opened.single().second)
    }

    @Test
    fun diagnosticsCarryNoPagePayload() {
        val logger = RecordingLogger()

        PageContainerDiagnostics.recordViewOpened(logger)

        logger.events.forEach { (_, fields) ->
            assertEquals(setOf("surface"), fields.keys)
            assertTrue("the slug carries no path separator", fields.values.none { it.contains('/') })
        }
    }
}
