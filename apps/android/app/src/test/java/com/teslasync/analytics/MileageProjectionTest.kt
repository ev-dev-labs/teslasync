// Off-device verification of the analytics MileagePage's pure logic — the raw kilometre-JSON decode of all
// three feeds (`/mileage/stats`, `/mileage/daily`, `/mileage/monthly`), the SI-kilometre → display-unit
// distance conversion (web `fromKm` = `convertDistanceFromSI(km * 1000, unit)`), the four summary metric
// projections, the null-odometer filtering on the area series, the daily bar series, the per-drive monthly
// table rows, the date-label formatting, and the page-level empty (no-vehicle) gate. Mirrors the web spec
// (web/src/features/analytics/pages/MileagePage.tsx). No Compose / Android / HTTP — runs in
// :app:testDebugUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.mileage

import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class MileageProjectionTest {
    private val strings =
        MileageStrings(
            title = "Mileage",
            subtitle = "Daily and monthly distance tracking",
            totalDistance = "Total Distance",
            totalDrives = "Total Drives",
            dailyAvg = "Daily Avg",
            annualProjection = "Annual Projection",
            odometerOverTime = "Odometer Over Time",
            odometer = "Odometer",
            dailyDistance = "Daily Distance",
            distance = "Distance",
            monthlySummary = "Monthly Summary",
            month = "Month",
            drives = "Drives",
            distancePerDrive = "Distance per Drive",
            noEntries = "No Entries",
            loadFailed = "Failed to load data",
            retry = "Retry",
        )

    private fun prefs(distance: DistanceUnitPref = DistanceUnitPref.KM): UnitPref =
        UnitPref(
            distance = distance,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = null,
        )

    private fun statsJson(
        lifetimeKm: Double = 50_000.0,
        last30dKm: Double = 1_500.0,
        drives: Int = 100,
    ) = buildJsonObject {
        put("vehicle_id", 5)
        put("lifetime_km", lifetimeKm)
        put("last_7d_km", last30dKm / 4)
        put("last_30d_km", last30dKm)
        put("last_365d_km", lifetimeKm)
        put("drive_count_lifetime", drives)
        put("drive_count_30d", 12)
    }

    private val dailyJson =
        buildJsonArray {
            addJsonObject {
                put("date", "2026-04-01")
                put("drive_count", 3)
                put("total_km", 30.0)
                put("end_odometer_km", 12_000.0)
            }
            addJsonObject {
                put("date", "2026-04-02")
                put("drive_count", 0)
                put("total_km", 0.0)
                put("end_odometer_km", JsonNull)
            }
        }

    private val monthlyJson =
        buildJsonArray {
            addJsonObject {
                put("year_month", "2026-04")
                put("drive_count", 30)
                put("total_km", 900.0)
            }
        }

    private fun project(distance: DistanceUnitPref = DistanceUnitPref.KM): MileageDisplay =
        MileageProjection.project(
            MileageData.from(statsJson(), dailyJson, monthlyJson),
            prefs(distance),
            strings,
            Locale.US,
        )

    // ── decode ──────────────────────────────────────────────────────────────────────

    @Test
    fun parseStatsReadsSnakeCaseKilometreFields() {
        val stats = parseMileageStats(statsJson(lifetimeKm = 40_000.0, last30dKm = 600.0, drives = 88))
        assertEquals(40_000.0, stats.lifetimeKm, 0.0)
        assertEquals(600.0, stats.last30dKm, 0.0)
        assertEquals(88.0, stats.driveCountLifetime, 0.0)
    }

    @Test
    fun parseStatsNullPayloadIsZero() {
        val stats = parseMileageStats(null)
        assertEquals(0.0, stats.lifetimeKm, 0.0)
        assertEquals(0.0, stats.last30dKm, 0.0)
        assertEquals(0.0, stats.driveCountLifetime, 0.0)
    }

    @Test
    fun parseDailyKeepsNullOdometerForLaterFiltering() {
        val daily = parseDailyMileage(dailyJson)
        assertEquals(2, daily.size)
        assertEquals(12_000.0, daily[0].endOdometerKm!!, 0.0)
        assertEquals(null, daily[1].endOdometerKm)
    }

    @Test
    fun parseDailyNonArrayIsEmpty() {
        assertTrue(parseDailyMileage(null).isEmpty())
        assertTrue(parseDailyMileage(statsJson()).isEmpty())
    }

    @Test
    fun parseMonthlyReadsBuckets() {
        val monthly = parseMonthlyMileage(monthlyJson)
        assertEquals(1, monthly.size)
        assertEquals("2026-04", monthly[0].yearMonth)
        assertEquals(900.0, monthly[0].totalKm, 0.0)
        assertEquals(30.0, monthly[0].driveCount, 0.0)
    }

    // ── summary metrics (4) ───────────────────────────────────────────────────────────

    @Test
    fun fourSummaryMetricsInKilometres() {
        val metrics = project().metrics
        assertEquals(4, metrics.size)
        assertEquals(MileageMetric("Total Distance", "50,000 km", MileageMetricIcon.Gauge, MileageMetricAccent.Cyan), metrics[0])
        assertEquals(MileageMetric("Total Drives", "100", MileageMetricIcon.TrendingUp, MileageMetricAccent.Green), metrics[1])
        assertEquals(MileageMetric("Daily Avg", "50.0 km", MileageMetricIcon.Calendar, MileageMetricAccent.Purple), metrics[2])
        assertEquals(
            MileageMetric("Annual Projection", "18,250 km", MileageMetricIcon.BarChart, MileageMetricAccent.Cyan),
            metrics[3],
        )
    }

    @Test
    fun summaryMetricsConvertToMilesAtTheDisplayBoundary() {
        val metrics = project(DistanceUnitPref.MI).metrics
        // 1500 km / 30 days = 50 km/day -> 50 km = 31.0686 mi -> "31.1 mi" (one decimal).
        assertEquals("31.1 mi", metrics[2].value)
        // Drives are unitless and never converted.
        assertEquals("100", metrics[1].value)
    }

    // ── odometer area series + null filtering ──────────────────────────────────────────

    @Test
    fun odometerSeriesDropsNullOdometerDays() {
        val display = project()
        assertTrue(display.hasOdometer)
        assertEquals(1, display.odometer.size)
        assertEquals("Apr 1, 2026", display.odometer[0].label)
        assertEquals(12_000.0, display.odometer[0].value, 0.0)
        assertEquals("Odometer (km)", display.odometerSeriesLabel)
    }

    // ── daily distance bar series ──────────────────────────────────────────────────────

    @Test
    fun dailyBarsConvertEveryDay() {
        val display = project()
        assertTrue(display.hasDaily)
        assertEquals(2, display.daily.size)
        assertEquals("Apr 1, 2026", display.daily[0].label)
        assertEquals(30.0, display.daily[0].value, 0.0)
        assertEquals(0.0, display.daily[1].value, 0.0)
        assertEquals("Distance (km)", display.dailySeriesLabel)
    }

    // ── monthly summary table rows + per-drive ─────────────────────────────────────────

    @Test
    fun monthlyRowsFormatDistanceDrivesAndPerDrive() {
        val display = project()
        assertTrue(display.hasMonthly)
        assertEquals(1, display.monthly.size)
        val row = display.monthly[0]
        assertEquals("2026-04", row.month)
        assertEquals("900.0", row.distance)
        assertEquals("30", row.drives)
        // 900 km / 30 drives = 30 km/drive.
        assertEquals("30.0", row.distancePerDrive)
    }

    @Test
    fun monthlyPerDriveIsZeroWhenNoDrives() {
        val zeroDriveMonthly =
            buildJsonArray {
                addJsonObject {
                    put("year_month", "2026-05")
                    put("drive_count", 0)
                    put("total_km", 0.0)
                }
            }
        val display =
            MileageProjection.project(
                MileageData.from(statsJson(), dailyJson, zeroDriveMonthly),
                prefs(),
                strings,
                Locale.US,
            )
        assertEquals("0.0", display.monthly[0].distancePerDrive)
    }

    // ── states ──────────────────────────────────────────────────────────────────────

    @Test
    fun resolvedVehicleIsNotEmpty() {
        val data = MileageData.from(statsJson(), dailyJson, monthlyJson, vehicleResolved = true)
        assertFalse(data.isEmpty)
    }

    @Test
    fun noVehicleSnapshotIsEmpty() {
        assertTrue(MileageData.EMPTY.isEmpty)
        assertTrue(MileageData.EMPTY.daily.isEmpty())
        assertTrue(MileageData.EMPTY.monthly.isEmpty())
    }

    @Test
    fun emptyDailyAndMonthlyGateThePanels() {
        val display =
            MileageProjection.project(
                MileageData.from(statsJson(), null, null),
                prefs(),
                strings,
                Locale.US,
            )
        assertFalse(display.hasOdometer)
        assertFalse(display.hasDaily)
        assertFalse(display.hasMonthly)
        // Metrics still render from stats even with no daily/monthly data.
        assertEquals(4, display.metrics.size)
    }

    // ── date label ─────────────────────────────────────────────────────────────────

    @Test
    fun formatDayLabelFormatsIsoAndFallsBackOnGarbage() {
        assertEquals("Apr 4, 2026", formatDayLabel("2026-04-04", Locale.US))
        assertEquals("not-a-date", formatDayLabel("not-a-date", Locale.US))
    }
}
