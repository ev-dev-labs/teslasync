// Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no route
// id and no crumb label — so a diagnostics line can never leak which screen a user is on. Runs in the
// :app:testReleaseUnitTest gate.
package io.teslasync.android.sharedsurfaces.layoutbreadcrumbs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LayoutBreadcrumbsDiagnosticsTest {
    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("LayoutBreadcrumbs", LayoutBreadcrumbsDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        LayoutBreadcrumbsDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "LayoutBreadcrumbs"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoRouteOrLabelPayload() {
        val logger = RecordingLogger()

        LayoutBreadcrumbsDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // No path separator can have leaked a route id, and the slug carries no digits.
        assertTrue(fields.values.none { it.contains('/') })
        assertTrue(fields.values.none { value -> value.any { it.isDigit() } })
    }
}
