package io.teslasync.android.dashboard.widgets.telemetryerrors

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the TelemetryErrorsWidget's pure logic — the `vin::error_code`
 * aggregation (count, most-recent `last_seen`, newest-first sort, localized "Unknown" fallback), the
 * recent/relative-time helpers, the registry metadata + footprint clamp, the status derivation, the
 * combined cache-then-network `Resource` fold, and the row TalkBack description. Mirrors the web spec
 * (web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx) and the WinUI parity tests.
 */
class TelemetryErrorsProjectionTest {
    private val labels = TelemetryErrorsLabels(unknown = "Unknown", justNow = "just now", ago = "ago")

    private val baseMillis: Long = requireNotNull(TelemetryErrorsProjection.parseTimestampMillis(NEWEST_ISO))

    private fun vin(
        vin: String,
        active: Boolean,
    ): FleetTelemetryErrorVIN = FleetTelemetryErrorVIN(vin = vin, active = active)

    private fun error(
        vin: String,
        code: String?,
        at: String,
    ): FleetTelemetryError = FleetTelemetryError(vin = vin, errorCode = code, reportedAt = at, fetchedAt = at)

    // ── Aggregation (web `aggregated` useMemo) ──────────────────────────────────────────────

    @Test
    fun aggregatesByVinAndCodeCountingOccurrences() {
        val rows =
            TelemetryErrorsProjection.aggregate(
                errors =
                    listOf(
                        error(VIN_A, "STREAM_DISCONNECTED", NEWEST_ISO),
                        error(VIN_A, "STREAM_DISCONNECTED", OLDER_ISO),
                        error(VIN_B, null, OLD_ISO),
                    ),
                labels = labels,
                nowMillis = baseMillis,
            )
        assertEquals(2, rows.size)
        val first = rows.first { it.vin == VIN_A }
        assertEquals(2, first.count)
        assertEquals("\u00d72", first.countText)
        assertEquals("STREAM_DISCONNECTED", first.errorCode)
    }

    @Test
    fun sortsNewestFirst() {
        val rows =
            TelemetryErrorsProjection.aggregate(
                errors = listOf(error(VIN_B, "OLD", OLD_ISO), error(VIN_A, "NEW", NEWEST_ISO)),
                labels = labels,
                nowMillis = baseMillis,
            )
        assertEquals(VIN_A, rows[0].vin)
        assertEquals(VIN_B, rows[1].vin)
    }

    @Test
    fun rowsWithoutTimestampSortLast() {
        val noStamp = FleetTelemetryError(vin = VIN_B, errorCode = "X", reportedAt = null, fetchedAt = "")
        val rows =
            TelemetryErrorsProjection.aggregate(
                errors = listOf(noStamp, error(VIN_A, "Y", NEWEST_ISO)),
                labels = labels,
                nowMillis = baseMillis,
            )
        assertEquals(VIN_A, rows.first().vin)
        assertEquals(VIN_B, rows.last().vin)
        assertNull(rows.last().lastSeenMillis)
    }

    @Test
    fun missingErrorCodeUsesUnknownDisplayAndKey() {
        val rows =
            TelemetryErrorsProjection.aggregate(
                errors = listOf(error(VIN_A, null, NEWEST_ISO)),
                labels = labels,
                nowMillis = baseMillis,
            )
        val row = rows.single()
        assertEquals("Unknown", row.errorCode)
        assertEquals("$VIN_A::unknown", row.key)
    }

    @Test
    fun recentRowWithinTheHourIsFlaggedAndLabeled() {
        val rows =
            TelemetryErrorsProjection.aggregate(
                errors = listOf(error(VIN_A, "C", NEWEST_ISO)),
                labels = labels,
                nowMillis = baseMillis + TEN_MINUTES_MS,
            )
        val row = rows.single()
        assertTrue(row.isRecent)
        assertEquals("10m ago", row.lastSeenText)
    }

    @Test
    fun oldRowIsNotRecent() {
        val rows =
            TelemetryErrorsProjection.aggregate(
                errors = listOf(error(VIN_B, "C", OLD_ISO)),
                labels = labels,
                nowMillis = baseMillis,
            )
        val row = rows.single()
        assertFalse(row.isRecent)
        assertEquals("1d ago", row.lastSeenText)
    }

    // ── Recent / relative-time / parsing helpers ────────────────────────────────────────────

    @Test
    fun isRecentRespectsTheOneHourWindow() {
        assertTrue(TelemetryErrorsProjection.isRecent(baseMillis, baseMillis + TEN_MINUTES_MS))
        assertFalse(TelemetryErrorsProjection.isRecent(baseMillis, baseMillis + TWO_HOURS_MS))
        assertFalse(TelemetryErrorsProjection.isRecent(null, baseMillis))
    }

    @Test
    fun relativeLabelHandlesUnknownTimestamp() {
        assertEquals("\u2014", TelemetryErrorsProjection.relativeLabel(null, baseMillis, labels))
    }

    @Test
    fun parsesTimestampVariantsAndRejectsGarbage() {
        assertNull(TelemetryErrorsProjection.parseTimestampMillis(null))
        assertNull(TelemetryErrorsProjection.parseTimestampMillis(""))
        assertNull(TelemetryErrorsProjection.parseTimestampMillis("not-a-date"))
        assertEquals(baseMillis, TelemetryErrorsProjection.parseTimestampMillis(NEWEST_ISO))
        assertNotNull(TelemetryErrorsProjection.parseTimestampMillis("2026-06-11T12:00:00+02:00"))
        assertNotNull(TelemetryErrorsProjection.parseTimestampMillis("2026-06-11T12:00:00"))
    }

    @Test
    fun formatIntGroupsThousands() {
        assertEquals("1,000", TelemetryErrorsProjection.formatInt(1000))
        assertEquals("0", TelemetryErrorsProjection.formatInt(0))
    }

    // ── Projection / status (web `activeVINCount` / `statusBadge` / `statusLabel`) ───────────

    @Test
    fun statusIsErrorsWhenAnyVinActive() {
        val display =
            TelemetryErrorsProjection.project(
                data = TelemetryErrorsData(listOf(vin(VIN_A, active = true)), emptyList()),
                size = TelemetryErrorsSize(cols = 2, rows = 4),
                labels = labels,
                nowMillis = baseMillis,
            )
        assertEquals(TelemetryErrorsStatus.Errors, display.status)
        assertEquals(1, display.activeVinCount)
        assertEquals("1", display.activeVinCountText)
        assertTrue(display.hasData)
        assertFalse(display.isCompact)
    }

    @Test
    fun statusIsHealthyWhenNoVinActive() {
        val display =
            TelemetryErrorsProjection.project(
                data =
                    TelemetryErrorsData(
                        errorVins = listOf(vin(VIN_A, active = false)),
                        errors = listOf(error(VIN_A, "C", NEWEST_ISO)),
                    ),
                size = TelemetryErrorsSize(cols = 1, rows = 2),
                labels = labels,
                nowMillis = baseMillis,
            )
        assertEquals(TelemetryErrorsStatus.Healthy, display.status)
        assertEquals(0, display.activeVinCount)
        assertTrue(display.hasData)
        assertTrue(display.isCompact)
    }

    @Test
    fun emptyDataHasNoRowsAndIsHealthy() {
        val display =
            TelemetryErrorsProjection.project(
                data = TelemetryErrorsData.EMPTY,
                size = TelemetryErrorsSize(cols = 2, rows = 4),
                labels = labels,
                nowMillis = baseMillis,
            )
        assertFalse(display.hasData)
        assertTrue(display.rows.isEmpty())
        assertEquals(TelemetryErrorsStatus.Healthy, display.status)
    }

    // ── Registry metadata + footprint ───────────────────────────────────────────────────────

    @Test
    fun registrationMatchesTheWebRegistry() {
        assertEquals("telemetry-errors", TelemetryErrorsRegistration.ID)
        assertEquals("system", TelemetryErrorsRegistration.CATEGORY)
        assertEquals("TelemetryErrorsWidget", TelemetryErrorsRegistration.SLUG)
        assertEquals(TelemetryErrorsSize(cols = 2, rows = 4), TelemetryErrorsRegistration.defaultSize)
        assertEquals(TelemetryErrorsSize(cols = 1, rows = 2), TelemetryErrorsRegistration.minSize)
        assertEquals(TelemetryErrorsSize(cols = 4, rows = 40), TelemetryErrorsRegistration.maxSize)
    }

    @Test
    fun withinBoundsAndClampHonourTheFootprint() {
        assertTrue(TelemetryErrorsRegistration.withinBounds(TelemetryErrorsSize(cols = 2, rows = 4)))
        assertFalse(TelemetryErrorsRegistration.withinBounds(TelemetryErrorsSize(cols = 5, rows = 4)))
        assertEquals(
            TelemetryErrorsSize(cols = 4, rows = 40),
            TelemetryErrorsRegistration.clamp(TelemetryErrorsSize(cols = 9, rows = 99)),
        )
        assertEquals(
            TelemetryErrorsSize(cols = 1, rows = 2),
            TelemetryErrorsRegistration.clamp(TelemetryErrorsSize(cols = 0, rows = 1)),
        )
    }

    // ── Combined cache-then-network Resource fold ───────────────────────────────────────────

    @Test
    fun foldLoadingWhenBothLoadingWithNoCache() {
        val folded =
            foldTelemetryErrors(
                Resource.Loading(cached = null, fetchedAt = null, stale = false),
                Resource.Loading(cached = null, fetchedAt = null, stale = false),
            )
        assertTrue(folded is Resource.Loading)
        assertNull(folded.cached)
    }

    @Test
    fun foldSuccessUsesLaterStampAndMergesBothFeeds() {
        val folded =
            foldTelemetryErrors(
                Resource.Success(listOf(vin(VIN_A, active = true)), fetchedAt = 100L, stale = false),
                Resource.Success(listOf(error(VIN_A, "C", NEWEST_ISO)), fetchedAt = 200L, stale = false),
            )
        assertTrue(folded is Resource.Success)
        val success = folded as Resource.Success
        assertEquals(200L, success.fetchedAt)
        assertTrue(success.data.hasData)
        assertEquals(1, success.data.errorVins.size)
        assertEquals(1, success.data.errors.size)
    }

    @Test
    fun foldEmptyWhenBothResolvedEmpty() {
        val folded =
            foldTelemetryErrors(
                Resource.Success(emptyList(), fetchedAt = 100L, stale = false),
                Resource.Success(emptyList(), fetchedAt = 100L, stale = false),
            )
        assertTrue(folded is Resource.Success)
        assertFalse((folded as Resource.Success).data.hasData)
    }

    @Test
    fun foldKeepsCacheVisibleOnErrorAsOffline() {
        val folded =
            foldTelemetryErrors(
                Resource.Error(listOf(vin(VIN_A, active = true)), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                Resource.Success(emptyList(), fetchedAt = 100L, stale = false),
            )
        assertTrue(folded is Resource.Error)
        val errorRes = folded as Resource.Error
        assertTrue(requireNotNull(errorRes.cached).hasData)
        assertTrue(errorRes.stale)
    }

    @Test
    fun foldHardErrorWhenNothingCached() {
        val folded =
            foldTelemetryErrors(
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
            )
        assertTrue(folded is Resource.Error)
        assertNull((folded as Resource.Error).cached)
    }

    @Test
    fun foldRefreshingKeepsCachedRows() {
        val folded =
            foldTelemetryErrors(
                Resource.Loading(listOf(vin(VIN_A, active = true)), fetchedAt = 100L, stale = false),
                Resource.Success(emptyList(), fetchedAt = 100L, stale = false),
            )
        assertTrue(folded is Resource.Loading)
        assertTrue(requireNotNull((folded as Resource.Loading).cached).hasData)
    }

    // ── Accessibility description ────────────────────────────────────────────────────────────

    @Test
    fun rowDescriptionIncludesAllFieldsAndRecentWhenRecent() {
        val rows =
            TelemetryErrorsProjection.aggregate(
                errors = listOf(error(VIN_A, "STREAM_DISCONNECTED", NEWEST_ISO)),
                labels = labels,
                nowMillis = baseMillis + TEN_MINUTES_MS,
            )
        val description = telemetryErrorRowDescription(rows.single(), "recent")
        assertTrue(description.contains(VIN_A))
        assertTrue(description.contains("STREAM_DISCONNECTED"))
        assertTrue(description.contains("\u00d71"))
        assertTrue(description.contains("recent"))
        assertTrue(description.contains("10m ago"))
    }

    @Test
    fun rowDescriptionOmitsRecentWhenStale() {
        val rows =
            TelemetryErrorsProjection.aggregate(
                errors = listOf(error(VIN_B, "C", OLD_ISO)),
                labels = labels,
                nowMillis = baseMillis,
            )
        val description = telemetryErrorRowDescription(rows.single(), "recent")
        assertFalse(description.contains("recent"))
    }

    private companion object {
        const val VIN_A = "5YJ3E1EA1KF000001"
        const val VIN_B = "5YJ3E1EA1KF000002"
        const val NEWEST_ISO = "2026-06-11T12:00:00Z"
        const val OLDER_ISO = "2026-06-11T11:30:00Z"
        const val OLD_ISO = "2026-06-10T12:00:00Z"
        const val TEN_MINUTES_MS = 10L * 60L * 1000L
        const val TWO_HOURS_MS = 2L * 60L * 60L * 1000L
    }
}
