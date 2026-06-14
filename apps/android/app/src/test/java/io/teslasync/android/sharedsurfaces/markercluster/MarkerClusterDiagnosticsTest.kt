package io.teslasync.android.sharedsurfaces.markercluster

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — no
 * coordinate, label, or count — so a diagnostics line can never leak where a vehicle has been. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class MarkerClusterDiagnosticsTest {
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
        assertEquals("MarkerCluster", MarkerClusterDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsThePiiSafeSlugOnly() {
        val logger = RecordingLogger()

        MarkerClusterDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.events.size)
        val (level, event, fields) = logger.events.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "MarkerCluster"), fields)
    }

    @Test
    fun diagnosticCarriesNoCoordinateOrLabelPayload() {
        val logger = RecordingLogger()

        MarkerClusterDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        // No coordinate digit, comma-separated pair, or path separator can have leaked through the slug.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) || value.contains(',') || value.contains('/') })
    }
}
