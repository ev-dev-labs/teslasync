package io.teslasync.android.sharedsurfaces.browsercompatbanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * capability list, no device model — so a diagnostics line can never leak which capabilities a device lacks.
 * Runs in the :android:testReleaseUnitTest gate.
 */
class BrowserCompatBannerDiagnosticsTest {
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
        assertEquals("BrowserCompatBanner", BrowserCompatBannerDiagnostics.SLUG)
        assertEquals(BROWSER_COMPAT_BANNER_SLUG, BrowserCompatBannerDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        BrowserCompatBannerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "BrowserCompatBanner"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoCapabilityOrDevicePayload() {
        val logger = RecordingLogger()

        BrowserCompatBannerDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The slug is a constant identifier — no whitespace, no device sentence could have leaked into it.
        assertTrue(fields.values.none { it.contains(' ') })
    }
}
