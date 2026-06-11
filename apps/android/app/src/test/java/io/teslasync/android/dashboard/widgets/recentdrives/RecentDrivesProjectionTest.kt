package io.teslasync.android.dashboard.widgets.recentdrives

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the RecentDrivesWidget's pure logic — the SI-metre → display-unit distance
 * conversion (web `convertDistanceFromSI`), the `duration_s / 60` whole-minute projection (web `fmtInt`),
 * the start→end SoC line with the `?` fallback, the injected short-date label, the newest-first sort +
 * five-row cap (web `&limit=5`), the empty gate, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/RecentDrivesWidget.tsx).
 */
class RecentDrivesProjectionTest {
    private val strings = recentDrivesStrings()

    private fun project(
        drives: List<Drive>,
        distance: DistanceUnitPref = DistanceUnitPref.KM,
    ) = RecentDrivesProjection.project(drives, unitPref(distance), strings, Locale.US)

    @Test
    fun rowRendersDistanceDurationSocAndDate() {
        // drive(id = 1) defaults: 12 000 m, 1200 s, 80→65 %, start_ts = 1 000 ms → "d1000".
        val row = project(listOf(drive(id = 1))).items.single()
        assertEquals("12.0 km", row.primaryText)
        assertEquals("20 min \u00B7 80% \u2192 65%", row.subtitleText)
        assertEquals("d1000", row.dateLabel)
        assertEquals("12.0 km, 20 min \u00B7 80% \u2192 65%, d1000", row.contentDescription)
    }

    @Test
    fun distanceConvertsToTheUsersUnit() {
        // 12 000 m / 1609.344 = 7.456… mi → 1 dp.
        val miles = project(listOf(drive(id = 1)), DistanceUnitPref.MI).items.single()
        assertEquals("7.5 mi", miles.primaryText)
    }

    @Test
    fun missingSocRendersQuestionMarkFallback() {
        val drives = listOf(drive(id = 1, durationS = 1_500, startBatteryPct = null, endBatteryPct = null))
        assertEquals("25 min \u00B7 ?% \u2192 ?%", project(drives).items.single().subtitleText)
    }

    @Test
    fun sortsNewestFirstAndCapsAtFive() {
        val display = project((1..6).map { drive(id = it.toLong()) }.shuffled())
        assertEquals(RecentDrivesRegistration.DEFAULT_LIMIT, display.items.size)
        assertEquals(6L, display.items.first().id)
        assertEquals(2L, display.items.last().id)
        assertTrue(display.hasItems)
    }

    @Test
    fun emptyDriveListResolvesToEmptyState() {
        val display = project(emptyList())
        assertFalse(display.hasItems)
        assertTrue(display.items.isEmpty())
        assertEquals("No recent drives", display.emptyMessage)
    }

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("recent-drives", RecentDrivesRegistration.ID)
        assertEquals("driving", RecentDrivesRegistration.CATEGORY)
        assertEquals("RecentDrivesWidget", RecentDrivesRegistration.SLUG)
        assertEquals(5, RecentDrivesRegistration.DEFAULT_LIMIT)
        assertEquals(RecentDrivesSize(2, 4), RecentDrivesRegistration.defaultSize)
        assertEquals(RecentDrivesSize(2, 2), RecentDrivesRegistration.minSize)
        assertEquals(RecentDrivesSize(4, 40), RecentDrivesRegistration.maxSize)
    }

    @Test
    fun clampHonoursTheMinMaxFootprint() {
        assertTrue(RecentDrivesRegistration.isWithinBounds(RecentDrivesRegistration.defaultSize))
        assertFalse(RecentDrivesRegistration.isWithinBounds(RecentDrivesSize(1, 1)))
        assertEquals(RecentDrivesSize(2, 2), RecentDrivesRegistration.clamp(RecentDrivesSize(1, 1)))
        assertEquals(RecentDrivesSize(4, 40), RecentDrivesRegistration.clamp(RecentDrivesSize(9, 99)))
    }
}
