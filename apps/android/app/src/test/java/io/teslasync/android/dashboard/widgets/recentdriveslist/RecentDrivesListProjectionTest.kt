package io.teslasync.android.dashboard.widgets.recentdriveslist

import io.teslasync.shared.core.api.generated.Drive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the RecentDrivesListWidget's pure logic — the `driveLimit` footprint
 * derivation, the `truncateAddress` port, the `formatDurationMinutes` port, the SoC / battery-used
 * rollups, the per-row projection (distance/date formatter delegation, folded TalkBack description),
 * and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx). Runs in the
 * `:android:testReleaseUnitTest` gate.
 */
class RecentDrivesListProjectionTest {
    private val fakeDistance: (Double) -> String = { meters -> "dist:${meters.toLong()}" }
    private val fakeDate: (Instant) -> String = { instant -> "date:${instant.toEpochMilliseconds()}" }

    // ---- Footprint derivation (web isWide / isTall / driveLimit) --------------------

    @Test
    fun footprintDerivesWideTallAndLimit() {
        // Base (web !isWide && !isTall): five rows.
        RecentDrivesSize(cols = 1, rows = 1).let {
            assertFalse(it.isWide)
            assertFalse(it.isTall)
            assertEquals(5, it.driveLimit)
        }
        // Tall only (web size.rows >= 2): seven rows.
        RecentDrivesSize(cols = 2, rows = 4).let {
            assertFalse(it.isWide)
            assertTrue(it.isTall)
            assertEquals(7, it.driveLimit)
        }
        // Wide (web size.cols >= 3): ten rows, address column shown.
        RecentDrivesSize(cols = 3, rows = 1).let {
            assertTrue(it.isWide)
            assertEquals(10, it.driveLimit)
        }
    }

    // ---- Registry metadata (web registry/driving.ts) --------------------------------

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("recent-drives-list", RecentDrivesListRegistration.ID)
        assertEquals("driving", RecentDrivesListRegistration.CATEGORY)
        assertEquals("RecentDrivesListWidget", RecentDrivesListRegistration.SLUG)
        assertEquals(RecentDrivesSize(2, 4), RecentDrivesListRegistration.defaultSize)
        assertEquals(RecentDrivesSize(1, 4), RecentDrivesListRegistration.minSize)
        assertEquals(RecentDrivesSize(4, 40), RecentDrivesListRegistration.maxSize)
    }

    @Test
    fun registrationBoundsAndClamp() {
        assertTrue(RecentDrivesListRegistration.isWithinBounds(RecentDrivesSize(2, 4)))
        assertFalse(RecentDrivesListRegistration.isWithinBounds(RecentDrivesSize(5, 4)))
        assertFalse(RecentDrivesListRegistration.isWithinBounds(RecentDrivesSize(1, 2)))
        assertEquals(RecentDrivesSize(4, 40), RecentDrivesListRegistration.clamp(RecentDrivesSize(9, 99)))
        assertEquals(RecentDrivesSize(1, 4), RecentDrivesListRegistration.clamp(RecentDrivesSize(0, 1)))
    }

    // ---- truncateAddress (web truncateAddress) --------------------------------------

    @Test
    fun truncateAddressNullOrBlankIsEmDash() {
        assertEquals("\u2014", RecentDrivesListProjection.truncateAddress(null, 30))
        assertEquals("\u2014", RecentDrivesListProjection.truncateAddress("", 30))
    }

    @Test
    fun truncateAddressShortIsUnchanged() {
        assertEquals("Home", RecentDrivesListProjection.truncateAddress("Home", 30))
    }

    @Test
    fun truncateAddressAtLimitIsUnchanged() {
        val exact = "x".repeat(30)
        assertEquals(exact, RecentDrivesListProjection.truncateAddress(exact, 30))
    }

    @Test
    fun truncateAddressOverLimitIsSlicedWithEllipsis() {
        val long = "x".repeat(40)
        val result = RecentDrivesListProjection.truncateAddress(long, 30)
        assertEquals("x".repeat(30) + "\u2026", result)
    }

    // ---- formatDurationMinutes (web formatDurationMinutes) --------------------------

    @Test
    fun durationNegativeOrNonFiniteIsEmDash() {
        assertEquals("\u2014", RecentDrivesListProjection.formatDurationMinutes(-1.0, "<1m"))
        assertEquals("\u2014", RecentDrivesListProjection.formatDurationMinutes(Double.NaN, "<1m"))
    }

    @Test
    fun durationSubMinuteUsesLabel() {
        assertEquals("<1m", RecentDrivesListProjection.formatDurationMinutes(0.5, "<1m"))
    }

    @Test
    fun durationMinutesOnlyUnderAnHour() {
        assertEquals("5m", RecentDrivesListProjection.formatDurationMinutes(5.0, "<1m"))
        assertEquals("59m", RecentDrivesListProjection.formatDurationMinutes(59.0, "<1m"))
    }

    @Test
    fun durationHoursAndMinutes() {
        assertEquals("1h 5m", RecentDrivesListProjection.formatDurationMinutes(65.0, "<1m"))
        assertEquals("2h 0m", RecentDrivesListProjection.formatDurationMinutes(120.0, "<1m"))
    }

    @Test
    fun durationRoundsRemainderMinutesHalfUp() {
        // 90.6 min -> 1h, 30.6 -> rounds to 31m (web formatRoundedInt half-expand).
        assertEquals("1h 31m", RecentDrivesListProjection.formatDurationMinutes(90.6, "<1m"))
    }

    // ---- project: slicing + row mapping ---------------------------------------------

    @Test
    fun projectTakesDriveLimitRows() {
        val drives = (1..20L).map { drive(id = it) }
        assertEquals(5, project(drives, RecentDrivesSize(1, 1)).rows.size)
        assertEquals(7, project(drives, RecentDrivesSize(1, 2)).rows.size)
        assertEquals(10, project(drives, RecentDrivesSize(3, 1)).rows.size)
    }

    @Test
    fun projectPreservesFeedOrder() {
        val drives = listOf(drive(id = 3), drive(id = 1), drive(id = 2))
        assertEquals(listOf(3L, 1L, 2L), project(drives, RecentDrivesSize(2, 4)).rows.map { it.id })
    }

    @Test
    fun projectMapsRowDisplayFields() {
        val row =
            project(
                listOf(drive(distanceM = 12_345.0, durationS = 3_900L, startTsMillis = 1_700L, startBatteryPct = 80, endBatteryPct = 70)),
                RecentDrivesSize(2, 4),
            ).rows.single()
        assertEquals("dist:12345", row.distanceText)
        assertEquals("1h 5m", row.durationText)
        assertEquals("80% \u2192 70%", row.socText)
        assertEquals("date:1700", row.dateText)
    }

    @Test
    fun projectBatteryUsedPresentWhenSocKnownAndMoved() {
        val row =
            project(
                listOf(drive(distanceM = 1_000.0, startBatteryPct = 80, endBatteryPct = 70)),
                RecentDrivesSize(2, 4),
            ).rows.single()
        assertEquals("10%", row.batteryUsedText)
    }

    @Test
    fun projectBatteryUsedNullWhenSocMissing() {
        val row = project(listOf(drive(startBatteryPct = null, endBatteryPct = 70)), RecentDrivesSize(2, 4)).rows.single()
        assertNull(row.batteryUsedText)
        assertEquals("?% \u2192 70%", row.socText)
    }

    @Test
    fun projectBatteryUsedNullWhenNotMoved() {
        val row = project(listOf(drive(distanceM = 0.0, startBatteryPct = 80, endBatteryPct = 70)), RecentDrivesSize(2, 4)).rows.single()
        assertNull(row.batteryUsedText)
    }

    @Test
    fun projectTruncatesAddressesAndFoldsContentDescription() {
        val drives =
            listOf(
                drive(
                    distanceM = 12_345.0,
                    durationS = 3_900L,
                    startBatteryPct = 80,
                    endBatteryPct = 70,
                    startAddress = "y".repeat(40),
                    endAddress = "Work",
                ),
            )
        // Wide: addresses are part of the row + the folded a11y phrase.
        val wide = project(drives, RecentDrivesSize(3, 4)).rows.single()
        assertEquals("y".repeat(30) + "\u2026", wide.startAddress)
        assertEquals("Work", wide.endAddress)
        assertEquals("dist:12345, 1h 5m, ${"y".repeat(30)}\u2026, Work, 80% \u2192 70%, 10%, date:1700", wide.contentDescription)
        // Narrow: the address column is hidden, so the phrase omits the addresses (web parity).
        val narrow = project(drives, RecentDrivesSize(1, 1)).rows.single()
        assertEquals("dist:12345, 1h 5m, 80% \u2192 70%, 10%, date:1700", narrow.contentDescription)
    }

    @Test
    fun projectHasItemsAndIsWidePassthrough() {
        assertFalse(project(emptyList(), RecentDrivesSize(3, 4)).hasItems)
        val display = project(listOf(drive()), RecentDrivesSize(3, 4))
        assertTrue(display.hasItems)
        assertTrue(display.isWide)
        assertFalse(project(listOf(drive()), RecentDrivesSize(2, 4)).isWide)
    }

    private fun project(
        drives: List<Drive>,
        size: RecentDrivesSize,
    ): RecentDrivesDisplay = RecentDrivesListProjection.project(drives, size, fakeDistance, fakeDate)

    @Suppress("LongParameterList")
    private fun drive(
        id: Long = 1L,
        distanceM: Double = 12_345.0,
        durationS: Long = 3_900L,
        startTsMillis: Long = 1_700L,
        startBatteryPct: Long? = 80,
        endBatteryPct: Long? = 70,
        startAddress: String? = "123 Main Street",
        endAddress: String? = "456 Oak Avenue",
    ): Drive =
        Drive(
            createdAt = Instant.fromEpochMilliseconds(startTsMillis),
            distanceM = distanceM,
            durationS = durationS,
            id = id,
            startTs = Instant.fromEpochMilliseconds(startTsMillis),
            updatedAt = Instant.fromEpochMilliseconds(startTsMillis),
            vehicleId = 1L,
            startAddress = startAddress,
            endAddress = endAddress,
            startBatteryPct = startBatteryPct,
            endBatteryPct = endBatteryPct,
        )
}
