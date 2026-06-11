package io.teslasync.android.featureviews.overviewtab

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the OverviewTab's pure logic — the native analogue of the web component's data
 * derivations (web/src/features/analytics/components/analytics/OverviewTab.tsx): the three chart
 * projections with their `safe(...)` zero-guard, preserved order, and empty guards; the SI→display distance
 * conversion the first chart applies; the locale-grouped axis formatting; the Quick Links list with its
 * `t(key, lastSegment)` fallback resolution; and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class OverviewTabProjectionTest {
    private val vehicles =
        listOf(
            OverviewVehicle(name = "Model 3", distanceKm = 1240.0),
            OverviewVehicle(name = "Model Y", distanceKm = 980.5),
        )

    // ── safe() zero-guard (web `Number.isFinite(v) ? v : 0`) ──────────────────────

    @Test
    fun safeCoercesNullAndNonFiniteToZeroAndPassesFiniteThrough() {
        assertEquals(0.0, OverviewTabProjection.safe(null), 0.0)
        assertEquals(0.0, OverviewTabProjection.safe(Double.NaN), 0.0)
        assertEquals(0.0, OverviewTabProjection.safe(Double.POSITIVE_INFINITY), 0.0)
        assertEquals(0.0, OverviewTabProjection.safe(Double.NEGATIVE_INFINITY), 0.0)
        assertEquals(42.5, OverviewTabProjection.safe(42.5), 0.0)
    }

    // ── Distance-by-vehicle projection + SI conversion ────────────────────────────

    @Test
    fun vehicleDistanceKeepsKilometresVerbatimAndPreservesOrder() {
        val result = OverviewTabProjection.vehicleDistance(vehicles, DistanceUnitPref.KM)

        assertFalse(result.isEmpty)
        assertEquals(listOf("Model 3", "Model Y"), result.xLabels)
        assertEquals(1240.0, result.values[0], 0.0001)
        assertEquals(980.5, result.values[1], 0.0001)
    }

    @Test
    fun vehicleDistanceConvertsToMilesWhenPreferred() {
        val result = OverviewTabProjection.vehicleDistance(vehicles, DistanceUnitPref.MI)

        // 1240 km and 980.5 km via convertDistanceFromSI(km * 1000, MI).
        assertEquals(770.50, result.values[0], 0.01)
        assertEquals(609.25, result.values[1], 0.01)
    }

    @Test
    fun vehicleDistanceReportsEmptyForNoVehicles() {
        val result = OverviewTabProjection.vehicleDistance(emptyList(), DistanceUnitPref.KM)

        assertTrue(result.isEmpty)
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.values.isEmpty())
    }

    // ── Day-of-week projection ────────────────────────────────────────────────────

    @Test
    fun dayOfWeekWidensDrivesGuardsAvgDistanceAndPreservesOrder() {
        val points =
            listOf(
                DayOfWeekPoint(day = "Mon", drives = 8, avgDistanceKm = 24.0),
                DayOfWeekPoint(day = "Tue", drives = 0, avgDistanceKm = Double.NaN),
            )

        val result = OverviewTabProjection.dayOfWeek(points)

        assertFalse(result.isEmpty)
        assertEquals(listOf("Mon", "Tue"), result.xLabels)
        assertEquals(listOf(8.0, 0.0), result.drives)
        assertEquals(listOf(24.0, 0.0), result.avgDistance)
    }

    @Test
    fun dayOfWeekReportsEmptyForNoPoints() {
        val result = OverviewTabProjection.dayOfWeek(emptyList())

        assertTrue(result.isEmpty)
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.drives.isEmpty())
        assertTrue(result.avgDistance.isEmpty())
    }

    // ── Monthly-cost projection ───────────────────────────────────────────────────

    @Test
    fun monthlyGuardsEachSeriesAndPreservesOrder() {
        val points =
            listOf(
                MonthlyCostPoint(month = "Jan", cost = 42.0, gasCost = 120.0, savings = 78.0),
                MonthlyCostPoint(month = "Feb", cost = Double.NaN, gasCost = 110.0, savings = 71.5),
            )

        val result = OverviewTabProjection.monthly(points)

        assertFalse(result.isEmpty)
        assertEquals(listOf("Jan", "Feb"), result.xLabels)
        assertEquals(listOf(42.0, 0.0), result.cost)
        assertEquals(listOf(120.0, 110.0), result.gasCost)
        assertEquals(listOf(78.0, 71.5), result.savings)
    }

    @Test
    fun monthlyReportsEmptyForNoPoints() {
        val result = OverviewTabProjection.monthly(emptyList())

        assertTrue(result.isEmpty)
        assertTrue(result.cost.isEmpty())
        assertTrue(result.gasCost.isEmpty())
        assertTrue(result.savings.isEmpty())
    }

    // ── Axis formatting (web Intl.NumberFormat default parity) ────────────────────

    @Test
    fun formatValueGroupsThousandsKeepsOneDecimalAndTrimsWhole() {
        assertEquals("1,234.6", OverviewTabProjection.formatValue(1234.56, Locale.US))
        assertEquals("42", OverviewTabProjection.formatValue(42.0, Locale.US))
        assertEquals("1,000,000", OverviewTabProjection.formatValue(1_000_000.0, Locale.US))
    }

    // ── Quick Links resolution (web t(key, lastSegment) fallback) ─────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresentElseDefault() {
        val present = resolveOptional({ "Statistics" }, "translation_analytics_links_statistics", "statistics")
        val absent = resolveOptional({ null }, "translation_analytics_links_statistics", "statistics")
        val blank = resolveOptional({ "   " }, "translation_analytics_links_statistics", "statistics")

        assertEquals("Statistics", present)
        assertEquals("statistics", absent)
        assertEquals("statistics", blank)
    }

    @Test
    fun quickLinkDefaultsAreTheWebLastSegmentFallback() {
        assertEquals("statistics", QuickLink.Statistics.defaultLabel)
        assertEquals("compare", QuickLink.Compare.defaultLabel)
        assertEquals("weeklyDigest", QuickLink.WeeklyDigest.defaultLabel)
        assertEquals("mileage", QuickLink.Mileage.defaultLabel)
        assertEquals("timeline", QuickLink.Timeline.defaultLabel)
    }

    @Test
    fun quickLinksBuildsFiveItemsInOrderWithRoutesGlyphsAndResolvedLabels() {
        val items = OverviewQuickLinks.items { link -> "label:${link.name}" }

        assertEquals(5, items.size)
        assertEquals(listOf("/statistics", "/period-compare", "/weekly-digest", "/mileage", "/timeline"), items.map { it.route })
        assertEquals(
            listOf(
                QuickLinkGlyph.BarChart,
                QuickLinkGlyph.Activity,
                QuickLinkGlyph.Calendar,
                QuickLinkGlyph.MapPin,
                QuickLinkGlyph.Clock,
            ),
            items.map { it.glyph },
        )
        assertEquals("label:Statistics", items.first().label)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordOverviewTabOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "OverviewTab"), fields)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
