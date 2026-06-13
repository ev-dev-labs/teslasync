package io.teslasync.android.sharedsurfaces.breadcrumbs

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * label, no href — so a diagnostics line can never leak where the user is in the app. Runs in the
 * :app:testReleaseUnitTest gate.
 */
class BreadcrumbsDiagnosticsTest {
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
        assertEquals("Breadcrumbs", BreadcrumbsDiagnostics.SLUG)
        assertEquals(BREADCRUMBS_SLUG, BreadcrumbsDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        BreadcrumbsDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "Breadcrumbs"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoLabelOrHrefPayload() {
        val logger = RecordingLogger()

        BreadcrumbsDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace or slash, so no label/href could have leaked into it.
        assertTrue(fields.values.none { it.contains(' ') || it.contains('/') })
    }
}
