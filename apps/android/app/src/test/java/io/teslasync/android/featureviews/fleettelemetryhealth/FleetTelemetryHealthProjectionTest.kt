package io.teslasync.android.featureviews.fleettelemetryhealth

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device verification of FleetTelemetryHealth's pure projection — the native port of the web
 * component's `vinColumns`/`errorColumns` `render` callbacks, the `isRecent` 24-hour recency math that
 * recolors the Last Seen / Reported At cells, the `?? '—'` / `?? []` fallbacks, and the PII-safe
 * `view.opened` diagnostic. This is the mandated "adapter unit test (cached → projection)". Mirrors the
 * web spec (web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx).
 */
class FleetTelemetryHealthProjectionTest {
    private val now = 1_781_000_000_000L
    private val labels = FleetTelemetryHealthLabels(justNow = "just now", ago = "ago")

    private fun hoursAgo(hours: Long): String {
        val instant = Instant.ofEpochMilli(now - hours * HOUR_MS)
        return instant.toString()
    }

    private fun minutesAgo(minutes: Long): String {
        val instant = Instant.ofEpochMilli(now - minutes * MINUTE_MS)
        return instant.toString()
    }

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

    // ── VIN projection (web vinColumns) ───────────────────────────────────────────────────────────────

    @Test
    fun projectVinsKeepsVinAndMarksRecentLastSeen() {
        val vins =
            listOf(
                FleetTelemetryErrorVIN(
                    id = 1,
                    vin = "5YJ3E1EA1KF000001",
                    active = true,
                    firstSeenAt = hoursAgo(72),
                    lastSeenAt = hoursAgo(2),
                ),
            )
        val rows = FleetTelemetryHealthProjection.projectVins(vins, labels, now)
        assertEquals(1, rows.size)
        assertEquals("5YJ3E1EA1KF000001", rows[0].vin)
        assertEquals("2h ago", rows[0].lastSeenText)
        assertTrue("last seen 2h ago is within 24h", rows[0].lastSeenRecent)
        assertEquals("3d ago", rows[0].firstSeenText)
    }

    @Test
    fun projectVinsMarksOldLastSeenAsNotRecent() {
        val vins = listOf(FleetTelemetryErrorVIN(vin = "VIN", firstSeenAt = hoursAgo(100), lastSeenAt = hoursAgo(40)))
        val rows = FleetTelemetryHealthProjection.projectVins(vins, labels, now)
        assertFalse("last seen 40h ago is not within 24h", rows[0].lastSeenRecent)
        assertEquals("1d ago", rows[0].lastSeenText)
    }

    @Test
    fun projectVinsRendersEmDashForBlankTimestamps() {
        val rows = FleetTelemetryHealthProjection.projectVins(listOf(FleetTelemetryErrorVIN(vin = "VIN")), labels, now)
        assertEquals(FLEET_HEALTH_EM_DASH, rows[0].firstSeenText)
        assertEquals(FLEET_HEALTH_EM_DASH, rows[0].lastSeenText)
        assertFalse(rows[0].lastSeenRecent)
    }

    // ── Error projection (web errorColumns) ───────────────────────────────────────────────────────────

    @Test
    fun projectErrorsKeepsCodeAndKeyAndMarksRecent() {
        val errors =
            listOf(
                FleetTelemetryError(
                    id = 42,
                    vin = "5YJ3E1EA1KF000001",
                    errorCode = "STREAM_DISCONNECTED",
                    errorMessage = "Stream dropped",
                    reportedAt = minutesAgo(5),
                ),
            )
        val rows = FleetTelemetryHealthProjection.projectErrors(errors, labels, now)
        assertEquals("42", rows[0].key)
        assertEquals("STREAM_DISCONNECTED", rows[0].errorCode)
        assertEquals("Stream dropped", rows[0].errorMessage)
        assertEquals("5m ago", rows[0].reportedAtText)
        assertTrue(rows[0].reportedAtRecent)
    }

    @Test
    fun projectErrorsFallsBackToEmDashForNullCodeAndMessage() {
        val errors = listOf(FleetTelemetryError(id = 7, vin = "VIN", errorCode = null, errorMessage = null, reportedAt = null))
        val rows = FleetTelemetryHealthProjection.projectErrors(errors, labels, now)
        assertNull("a null error_code stays null so the cell shows a muted dash", rows[0].errorCode)
        assertEquals(FLEET_HEALTH_EM_DASH, rows[0].errorMessage)
        assertEquals(FLEET_HEALTH_EM_DASH, rows[0].reportedAtText)
        assertFalse("a missing reported_at is never recent (web `r.reported_at && isRecent`)", rows[0].reportedAtRecent)
    }

    // ── isRecent (web 24h window) ─────────────────────────────────────────────────────────────────────

    @Test
    fun isRecentBoundsAt24Hours() {
        assertTrue(FleetTelemetryHealthProjection.isRecent(now - (FLEET_HEALTH_RECENT_WINDOW_MS - 1), now))
        assertFalse(FleetTelemetryHealthProjection.isRecent(now - FLEET_HEALTH_RECENT_WINDOW_MS, now))
        assertFalse(FleetTelemetryHealthProjection.isRecent(null, now))
    }

    // ── relativeLabel (web TimeStamp cutoffs) ─────────────────────────────────────────────────────────

    @Test
    fun relativeLabelBucketsEachMagnitude() {
        assertEquals(FLEET_HEALTH_EM_DASH, FleetTelemetryHealthProjection.relativeLabel(null, now, labels))
        assertEquals("just now", FleetTelemetryHealthProjection.relativeLabel(now - 30L * 1000L, now, labels))
        assertEquals("5m ago", FleetTelemetryHealthProjection.relativeLabel(now - 5L * 60L * 1000L, now, labels))
        assertEquals("3h ago", FleetTelemetryHealthProjection.relativeLabel(now - 3L * HOUR_MS, now, labels))
        assertEquals("2d ago", FleetTelemetryHealthProjection.relativeLabel(now - 2L * 24L * HOUR_MS, now, labels))
        assertEquals("1w ago", FleetTelemetryHealthProjection.relativeLabel(now - 10L * 24L * HOUR_MS, now, labels))
    }

    // ── parseTimestampMillis (tolerant of Z / offset / zoneless / garbage) ────────────────────────────

    @Test
    fun parseTimestampAcceptsEquivalentZoneForms() {
        val z = FleetTelemetryHealthProjection.parseTimestampMillis("2026-06-11T12:00:00Z")
        val offset = FleetTelemetryHealthProjection.parseTimestampMillis("2026-06-11T12:00:00+00:00")
        val local = FleetTelemetryHealthProjection.parseTimestampMillis("2026-06-11T12:00:00")
        assertNotNull(z)
        assertEquals(z, offset)
        assertEquals(z, local)
    }

    @Test
    fun parseTimestampReturnsNullForBlankOrGarbage() {
        assertNull(FleetTelemetryHealthProjection.parseTimestampMillis(null))
        assertNull(FleetTelemetryHealthProjection.parseTimestampMillis(""))
        assertNull(FleetTelemetryHealthProjection.parseTimestampMillis("   "))
        assertNull(FleetTelemetryHealthProjection.parseTimestampMillis("not-a-timestamp"))
    }

    // ── Diagnostics (P1/S11 view.opened) ──────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordFleetTelemetryHealthOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "FleetTelemetryHealth"), opened.single().second)
    }

    private companion object {
        const val HOUR_MS = 3_600_000L
        const val MINUTE_MS = 60_000L
    }
}
