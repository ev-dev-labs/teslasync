package io.teslasync.android.sharedsurfaces.datafreshness

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): both the one-shot `view.opened` and the per-interaction
 * `dataFreshness.refresh` emit the surface slug and nothing else — no vehicle id and no freshness payload —
 * so a diagnostics line can never leak which feed a user was viewing or refreshing. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class DataFreshnessDiagnosticsTest {
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
        assertEquals("DataFreshness", DataFreshnessRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordDataFreshnessOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "DataFreshness"), opened.single().second)
    }

    @Test
    fun recordRefreshEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordDataFreshnessRefresh(logger)

        val refreshed = logger.events.filter { it.first == "dataFreshness.refresh" }
        assertEquals(1, refreshed.size)
        assertEquals(mapOf("surface" to "DataFreshness"), refreshed.single().second)
    }

    @Test
    fun diagnosticsCarryNoVehicleOrFreshnessPayload() {
        val logger = RecordingLogger()

        recordDataFreshnessOpened(logger)
        recordDataFreshnessRefresh(logger)

        logger.events.forEach { (_, fields) ->
            assertEquals(setOf("surface"), fields.keys)
            assertTrue("the slug carries no path separator", fields.values.none { it.contains('/') })
        }
    }
}
