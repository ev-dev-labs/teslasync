// Verifies the PII-safe `view.opened` diagnostic (P1/S11) for the BreadcrumbOverridesContext surface: it emits
// the surface slug and nothing else — never a route pattern, nor an override label (which may be derived from a
// location) — so a diagnostics line can never leak which page a user is on or the friendly label resolved for
// it. Runs in the :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.breadcrumboverridescontext

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BreadcrumbOverridesContextDiagnosticsTest {
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
        assertEquals("BreadcrumbOverridesContext", BreadcrumbOverridesContextRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordBreadcrumbOverridesContextOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "BreadcrumbOverridesContext"), opened.single().third)
    }

    @Test
    fun diagnosticCarriesNoRouteOrLabelPayload() {
        val logger = RecordingLogger()

        recordBreadcrumbOverridesContextOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no route pattern (which would contain '/') or label could have
        // leaked into it.
        assertTrue(fields.values.none { value -> value.contains('/') })
    }
}
