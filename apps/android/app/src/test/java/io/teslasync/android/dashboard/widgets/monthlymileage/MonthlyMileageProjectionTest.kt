package io.teslasync.android.dashboard.widgets.monthlymileage

import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * Off-device verification of the MonthlyMileageWidget's pure logic — the raw-array decode, the
 * trailing-12-month slice, the km→display-unit conversion (metric + imperial), the current-month
 * highlight + per-month / 12-month totals, the grouped-integer stat formatting (web `fmtInt`), the
 * `hasData` empty gate, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/MonthlyMileageWidget.tsx).
 */
class MonthlyMileageProjectionTest {
    private val strings =
        MonthlyMileageStrings(
            title = "Monthly Mileage",
            noData = "No mileage data",
            thisMonth = "This Month",
            total12m = "12-Mo Total",
            distance = "Distance",
        )

    private fun prefs(distance: DistanceUnitPref = DistanceUnitPref.KM): MonthlyMileageDisplayPrefs = MonthlyMileageDisplayPrefs(distance)

    private fun monthsJson(months: List<Pair<String, Double>>) =
        buildJsonArray {
            months.forEach { (label, km) ->
                add(
                    buildJsonObject {
                        put("year_month", label)
                        put("total_km", km)
                    },
                )
            }
        }

    @Test
    fun parseDecodesArrayOfBuckets() {
        val data = parseMonthlyMileage(monthsJson(listOf("2025-01" to 120.0, "2025-02" to 80.5)))
        assertEquals(2, data.buckets.size)
        assertEquals("2025-01", data.buckets[0].yearMonth)
        assertEquals(120.0, data.buckets[0].totalKm, 0.0)
        assertEquals(80.5, data.buckets[1].totalKm, 0.0)
    }

    @Test
    fun parseNonArrayCollapsesToEmpty() {
        assertTrue(parseMonthlyMileage(null).buckets.isEmpty())
        assertTrue(parseMonthlyMileage(buildJsonObject { put("vehicle_id", 1) }).buckets.isEmpty())
    }

    @Test
    fun parseDefaultsMissingOrNullFields() {
        val json =
            buildJsonArray {
                add(buildJsonObject { put("year_month", "2025-03") })
                add(
                    buildJsonObject {
                        put("year_month", JsonNull)
                        put("total_km", JsonNull)
                    },
                )
            }
        val data = parseMonthlyMileage(json)
        assertEquals(0.0, data.buckets[0].totalKm, 0.0)
        assertEquals("", data.buckets[1].yearMonth)
        assertEquals(0.0, data.buckets[1].totalKm, 0.0)
    }

    @Test
    fun shortMonthFormatsKnownMonths() {
        assertEquals("Jan", shortMonth("2026-01"))
        assertEquals("Apr", shortMonth("2026-04"))
        assertEquals("Dec", shortMonth("2026-12"))
    }

    @Test
    fun shortMonthFallsBackOnMalformedInput() {
        assertEquals("2026", shortMonth("2026"))
        assertEquals("2026-13", shortMonth("2026-13"))
        assertEquals("bad", shortMonth("bad"))
    }

    @Test
    fun currentMonthKeyUsesClock() {
        val clock = Clock.fixed(Instant.parse("2025-07-15T08:30:00Z"), ZoneOffset.UTC)
        assertEquals("2025-07", currentMonthKey(clock))
    }

    @Test
    fun projectionSlicesToTrailingTwelveMonths() {
        val months = (1..14).map { "2025-%02d".format(it) to it.toDouble() }
        val display = MonthlyMileageProjection.project(parseMonthlyMileage(monthsJson(months)), prefs(), strings, "2099-01")
        assertEquals(MonthlyMileageRegistration.MAX_MONTHS, display.bars.size)
        // The first two months (1 + 2 km) are dropped; the window starts at month 3.
        assertEquals("Mar", display.bars.first().month)
    }

    @Test
    fun projectionConvertsKilometresToMetric() {
        val display =
            MonthlyMileageProjection.project(
                parseMonthlyMileage(monthsJson(listOf("2025-05" to 120.0))),
                prefs(),
                strings,
                "2025-05",
            )
        assertEquals(120.0, display.bars.single().distance, 0.001)
        assertEquals("km", display.distanceUnit)
        assertEquals("120", display.stats.first { it.label == "This Month" }.value)
    }

    @Test
    fun projectionConvertsKilometresToImperial() {
        val display =
            MonthlyMileageProjection.project(
                parseMonthlyMileage(monthsJson(listOf("2025-05" to 100.0, "2025-06" to 200.0))),
                prefs(DistanceUnitPref.MI),
                strings,
                "2025-06",
            )
        // 100 km → 62.14 mi, 200 km → 124.27 mi.
        assertEquals(62.137, display.bars.first().distance, 0.01)
        assertEquals("mi", display.distanceUnit)
        assertEquals("124", display.stats.first { it.label == "This Month" }.value)
        assertEquals("186", display.stats.first { it.label == "12-Mo Total" }.value)
    }

    @Test
    fun projectionFlagsCurrentMonthAndTotals() {
        val display =
            MonthlyMileageProjection.project(
                parseMonthlyMileage(monthsJson(listOf("2025-06" to 100.0, "2025-07" to 250.0))),
                prefs(),
                strings,
                "2025-07",
            )
        assertFalse(display.bars[0].isCurrent)
        assertTrue(display.bars[1].isCurrent)
        assertEquals(250.0, display.currentMonthDistance, 0.001)
        assertEquals(350.0, display.totalDistance, 0.001)
        assertEquals("350", display.stats.first { it.label == "12-Mo Total" }.value)
    }

    @Test
    fun projectionTreatsAbsentCurrentMonthAsZeroButStillHasData() {
        val display =
            MonthlyMileageProjection.project(
                parseMonthlyMileage(monthsJson(listOf("2025-01" to 120.0))),
                prefs(),
                strings,
                "2025-07",
            )
        assertTrue(display.hasData)
        assertEquals(0.0, display.currentMonthDistance, 0.0)
        assertEquals("0", display.stats.first { it.label == "This Month" }.value)
        assertEquals("120", display.stats.first { it.label == "12-Mo Total" }.value)
    }

    @Test
    fun emptyWhenNoBuckets() {
        val display = MonthlyMileageProjection.project(MonthlyMileageData.EMPTY, prefs(), strings, "2025-07")
        assertFalse(display.hasData)
        assertTrue(display.bars.isEmpty())
        assertTrue(display.stats.isEmpty())
        assertEquals("No mileage data", display.emptyMessage)
    }

    @Test
    fun emptyWhenEveryRecentMonthHasZeroDistance() {
        val data = parseMonthlyMileage(monthsJson(listOf("2025-05" to 0.0, "2025-06" to 0.0)))
        assertFalse(data.hasData)
        val display = MonthlyMileageProjection.project(data, prefs(), strings, "2025-06")
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
    }

    @Test
    fun registrationMatchesWebMetadata() {
        assertEquals("monthly-mileage", MonthlyMileageRegistration.ID)
        assertEquals("analytics", MonthlyMileageRegistration.CATEGORY)
        assertEquals("MonthlyMileageWidget", MonthlyMileageRegistration.SLUG)
        assertEquals(MonthlyMileageSize(2, 4), MonthlyMileageRegistration.defaultSize)
        assertEquals(MonthlyMileageSize(2, 4), MonthlyMileageRegistration.minSize)
        assertEquals(MonthlyMileageSize(4, 40), MonthlyMileageRegistration.maxSize)
    }

    @Test
    fun clampCoercesOutOfBoundsFootprints() {
        assertEquals(MonthlyMileageSize(2, 4), MonthlyMileageRegistration.clamp(MonthlyMileageSize(1, 1)))
        assertEquals(MonthlyMileageSize(4, 40), MonthlyMileageRegistration.clamp(MonthlyMileageSize(9, 99)))
        assertTrue(MonthlyMileageRegistration.isWithinBounds(MonthlyMileageSize(3, 10)))
        assertFalse(MonthlyMileageRegistration.isWithinBounds(MonthlyMileageSize(1, 1)))
    }

    @Test
    fun sizeFlagsMirrorWebBreakpoints() {
        assertTrue(MonthlyMileageSize(1, 4).isCompact)
        assertFalse(MonthlyMileageSize(2, 4).isCompact)
        assertTrue(MonthlyMileageSize(3, 4).isWide)
        assertFalse(MonthlyMileageSize(2, 4).isWide)
    }
}
