package io.teslasync.android.sharedsurfaces.pageheadersticky

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no page
 * content, no target id, no scroll position — so a diagnostics line can never leak which page a user was on. Runs
 * in the :android:testReleaseUnitTest gate.
 */
class PageHeaderStickyDiagnosticsTest {
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
        assertEquals("PageHeaderSticky", PageHeaderStickyDiagnostics.SLUG)
        assertEquals(PageHeaderStickyRegistration.SLUG, PageHeaderStickyDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        PageHeaderStickyDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "PageHeaderSticky"), opened.single().third)
    }

    @Test
    fun diagnosticCarriesNoPageContentPayload() {
        val logger = RecordingLogger()

        PageHeaderStickyDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, so no summary sentence could have leaked into it.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
