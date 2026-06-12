package io.teslasync.android.featureviews.activesessionssection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Active-sessions section's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/settings/components/ActiveSessionsSection.tsx): the
 * open-mode vs forward-auth branch, the per-row projection (the `describeDevice` user-agent heuristic, the IP
 * `'—'` fallback, the formatted timestamps via the render seam, the current-device flag), the
 * "has other devices" footer guard (web `rows.some(r => !r.current)`), the empty guard, and the PII-safe
 * `view.opened` diagnostic. The `formatTimestamp` seam is a deterministic stub so the assertions are exactly
 * what the thin composable renders. Runs in the :android:testReleaseUnitTest gate.
 */
class ActiveSessionsSectionProjectionTest {
    private val stampFormat: (String) -> String = { raw -> "fmt:$raw" }

    private val currentSession =
        ActiveSession(
            id = "sess-1",
            userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
            ip = "203.0.113.7",
            createdAt = "2026-04-04T18:30:00Z",
            lastSeenAt = "2026-04-05T09:12:00Z",
            current = true,
        )

    private val otherSession =
        ActiveSession(
            id = "sess-2",
            userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
            ip = "198.51.100.22",
            createdAt = "2026-04-01T08:00:00Z",
            lastSeenAt = "2026-04-03T22:45:00Z",
            current = false,
        )

    // ── Branch selection (web `!data || mode === 'open'`) ───────────────────────────────────────────

    @Test
    fun projectNullDataIsOpenModeAdvisory() {
        val result = ActiveSessionsProjection.project(null, stampFormat)

        assertTrue(result.isOpenMode)
        assertTrue(result.rows.isEmpty())
        assertFalse(result.hasOtherDevices)
        assertFalse(result.isEmpty)
    }

    @Test
    fun projectOpenModeIsAdvisoryEvenWithStraySessions() {
        val data = ActiveSessionsData(mode = SessionMode.Open, sessions = listOf(currentSession))
        val result = ActiveSessionsProjection.project(data, stampFormat)

        assertTrue(result.isOpenMode)
        assertTrue(result.rows.isEmpty())
    }

    // ── Forward-auth row projection (cached → projection) ───────────────────────────────────────────

    @Test
    fun projectSessionModeMapsRowsLabelsFlagsAndTimestamps() {
        val data = ActiveSessionsData(mode = SessionMode.Session, sessions = listOf(currentSession, otherSession))
        val result = ActiveSessionsProjection.project(data, stampFormat)

        assertFalse(result.isOpenMode)
        assertFalse(result.isEmpty)
        assertTrue(result.hasOtherDevices)
        assertEquals(listOf("sess-1", "sess-2"), result.rows.map { it.id })
        assertEquals(listOf("Firefox on Windows", "Chrome on macOS"), result.rows.map { it.deviceLabel })
        assertEquals(listOf(true, false), result.rows.map { it.isCurrent })
        assertEquals(listOf("203.0.113.7", "198.51.100.22"), result.rows.map { it.ipLabel })
        assertEquals(listOf("fmt:2026-04-04T18:30:00Z", "fmt:2026-04-01T08:00:00Z"), result.rows.map { it.createdAtLabel })
        assertEquals(listOf("fmt:2026-04-05T09:12:00Z", "fmt:2026-04-03T22:45:00Z"), result.rows.map { it.lastSeenAtLabel })
    }

    @Test
    fun projectBlankIpFallsBackToEmDash() {
        val data = ActiveSessionsData(mode = SessionMode.Session, sessions = listOf(otherSession.copy(ip = "   ")))
        val result = ActiveSessionsProjection.project(data, stampFormat)

        assertEquals(EM_DASH, result.rows.single().ipLabel)
    }

    @Test
    fun projectEmptySessionModeIsEmptyWithNoOtherDevices() {
        val data = ActiveSessionsData(mode = SessionMode.Session, sessions = emptyList())
        val result = ActiveSessionsProjection.project(data, stampFormat)

        assertFalse(result.isOpenMode)
        assertTrue(result.isEmpty)
        assertFalse(result.hasOtherDevices)
    }

    @Test
    fun projectOnlyCurrentSessionHasNoOtherDevices() {
        val data = ActiveSessionsData(mode = SessionMode.Session, sessions = listOf(currentSession))
        val result = ActiveSessionsProjection.project(data, stampFormat)

        assertFalse(result.isEmpty)
        assertFalse(result.hasOtherDevices)
    }

    // ── describeDevice (web parity) ─────────────────────────────────────────────────────────────────

    @Test
    fun describeDeviceMapsKnownBrowserOsCombinations() {
        assertEquals("Firefox on Windows", ActiveSessionsProjection.describeDevice(currentSession.userAgent))
        assertEquals("Chrome on macOS", ActiveSessionsProjection.describeDevice(otherSession.userAgent))
        // A real iPhone Safari UA contains "like Mac OS X", so the OS ladder resolves it to macOS — the web
        // source checks `Mac OS X` before `iPhone`, and this port reproduces that exact precedence.
        assertEquals(
            "Safari on macOS",
            ActiveSessionsProjection.describeDevice(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1",
            ),
        )
        // The web `else if (/iPhone|iPad|iPod/)` iOS arm is only reached when no "Mac OS X" marker precedes it.
        assertEquals(
            "Safari on iOS",
            ActiveSessionsProjection.describeDevice("TeslaSyncApp/1.0 (iPhone) Safari/604.1"),
        )
        assertEquals(
            "Edge on Windows",
            ActiveSessionsProjection.describeDevice(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 Edg/124.0",
            ),
        )
        assertEquals(
            "Chrome on Android",
            ActiveSessionsProjection.describeDevice(
                "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36",
            ),
        )
    }

    @Test
    fun describeDeviceFallsBackForBlankAndUnknown() {
        assertEquals("Unknown device", ActiveSessionsProjection.describeDevice("   "))
        assertEquals("Browser on Unknown OS", ActiveSessionsProjection.describeDevice("CustomFetchClient/1.0"))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ───────────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordActiveSessionsSectionOpened(logger)

        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "ActiveSessionsSection"), record.fields)
    }

    @Test
    fun diagnosticCarriesNoNumericOrIdentifyingPayload() {
        val logger = RecordingLogger()

        recordActiveSessionsSectionOpened(logger)

        val fields = logger.records.single().fields
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("active-sessions-section", ActiveSessionsSectionRegistration.ID)
        assertEquals("ActiveSessionsSection", ActiveSessionsSectionRegistration.SLUG)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
