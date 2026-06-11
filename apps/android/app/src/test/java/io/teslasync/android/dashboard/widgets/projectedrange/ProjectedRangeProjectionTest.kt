package io.teslasync.android.dashboard.widgets.projectedrange

import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the ProjectedRangeWidget's pure logic — the raw kilometre-JSON decode, the
 * SI-kilometre → display-unit distance conversion (web `toDistanceDisplay` = `convertDistanceFromSI`), the
 * health-band badge heuristic, the projected-vs-EPA comparison ratio + band, the range-factors list, the
 * compact hero + TalkBack content description, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/ProjectedRangeWidget.tsx).
 */
class ProjectedRangeProjectionTest {
    private val strings =
        ProjectedRangeStrings(
            title = "Projected Range",
            projected = "Projected",
            epa = "EPA",
            ofEpa = "of EPA rated",
            factors = "Range Factors",
            degradation = "Battery Degradation",
            avgDaily = "Avg Daily Usage",
            capacity = "Current Capacity",
            cycles = "Battery Cycles",
            excellent = "Excellent",
            good = "Good",
            fair = "Fair",
            poor = "Poor",
            noData = "No projected range data",
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

    private fun sampleJson() =
        buildJsonObject {
            put("current_range_km", 300.0)
            put("new_range_km", 400.0)
            put("avg_daily_km", 50.0)
            put("health_score", 85.0)
            put("degradation_pct", 8.5)
            put("current_capacity_pct", 91.5)
            put("total_cycles", 412.0)
        }

    private fun project(
        size: ProjectedRangeSize = ProjectedRangeRegistration.defaultSize,
        distance: DistanceUnitPref = DistanceUnitPref.KM,
    ): ProjectedRangeDisplay =
        ProjectedRangeProjection.project(parseProjectedRange(sampleJson()), size, strings, prefs(distance), Locale.US)

    @Test
    fun parseNullPayloadIsEmpty() {
        val data = parseProjectedRange(null)
        assertFalse(data.hasData)
        assertNull(data.currentRangeKm)
    }

    @Test
    fun parseEmptyObjectIsEmpty() {
        assertFalse(parseProjectedRange(buildJsonObject { }).hasData)
    }

    @Test
    fun parseReadsSnakeCaseFields() {
        val data = parseProjectedRange(sampleJson())
        assertTrue(data.hasData)
        assertEquals(300.0, data.currentRangeKm!!, 0.0)
        assertEquals(400.0, data.newRangeKm!!, 0.0)
        assertEquals(50.0, data.avgDailyKm!!, 0.0)
        assertEquals(85.0, data.healthScore!!, 0.0)
        assertEquals(8.5, data.degradationPct, 0.0)
        assertEquals(91.5, data.currentCapacityPct, 0.0)
        assertEquals(412.0, data.totalCycles, 0.0)
    }

    @Test
    fun parseKeepsWebNullablesNullButPercentsZero() {
        val data = parseProjectedRange(buildJsonObject { put("vehicle_id", 7) })
        assertTrue(data.hasData)
        assertNull(data.currentRangeKm)
        assertNull(data.newRangeKm)
        assertNull(data.avgDailyKm)
        assertNull(data.healthScore)
        assertEquals(0.0, data.degradationPct, 0.0)
        assertEquals(0.0, data.currentCapacityPct, 0.0)
        assertEquals(0.0, data.totalCycles, 0.0)
    }

    @Test
    fun standardProjectionRendersRangeComparisonAndBadge() {
        val display = project(ProjectedRangeRegistration.defaultSize)
        assertTrue(display.hasData)
        assertFalse(display.isCompact)
        assertFalse(display.isWide)
        assertEquals(300.0, display.projectedRangeValue!!, 0.0)
        assertEquals("300", display.projectedRangeText)
        assertEquals("km", display.distanceUnitLabel)
        assertEquals("400 km", display.epaText)
        assertEquals(75, display.rangePct)
        assertEquals(ComparisonBand.Fair, display.comparisonBand)
        assertEquals(0.75f, display.comparisonFraction, 1e-6f)
        assertEquals("75% of EPA rated", display.ofEpaText)
        val badge = display.badge!!
        assertEquals(HealthBand.Good, badge.band)
        assertEquals("Good", badge.compactText)
        assertEquals("Good \u00B7 85%", badge.standardText)
    }

    @Test
    fun milesConvertDistanceForRangeEpaAndAvgDaily() {
        val display = project(ProjectedRangeRegistration.maxSize, distance = DistanceUnitPref.MI)
        // 300 km → 186 mi, 400 km → 249 mi (rounded), ratio unchanged at 75%.
        assertEquals("186", display.projectedRangeText)
        assertEquals("249 mi", display.epaText)
        assertEquals(75, display.rangePct)
        assertEquals("31 mi", display.factors[1].value)
        assertEquals("mi", display.distanceUnitLabel)
    }

    @Test
    fun wideProjectionListsAllFourFactors() {
        val display = project(ProjectedRangeRegistration.maxSize)
        assertTrue(display.isWide)
        assertEquals(
            listOf(
                ProjectedRangeFactor("Battery Degradation", "8.5%", ProjectedRangeFactorIcon.Degradation),
                ProjectedRangeFactor("Avg Daily Usage", "50 km", ProjectedRangeFactorIcon.AvgDaily),
                ProjectedRangeFactor("Current Capacity", "91.5%", ProjectedRangeFactorIcon.Capacity),
                ProjectedRangeFactor("Battery Cycles", "412", ProjectedRangeFactorIcon.Cycles),
            ),
            display.factors,
        )
    }

    @Test
    fun compactHeroSurfacesTalkBackDescription() {
        val display = project(ProjectedRangeRegistration.minSize)
        assertTrue(display.isCompact)
        assertEquals("300 km, Projected, Good", display.compactContentDescription)
    }

    @Test
    fun missingRangesRenderEmDashAndNoComparison() {
        val display =
            ProjectedRangeProjection.project(
                parseProjectedRange(buildJsonObject { put("vehicle_id", 7) }),
                ProjectedRangeRegistration.defaultSize,
                strings,
                prefs(),
                Locale.US,
            )
        assertTrue(display.hasData)
        assertNull(display.projectedRangeValue)
        assertEquals("\u2014", display.projectedRangeText)
        assertEquals("\u2014", display.epaText)
        assertNull(display.rangePct)
        assertNull(display.ofEpaText)
        assertNull(display.badge)
        assertEquals(ComparisonBand.Poor, display.comparisonBand)
    }

    @Test
    fun emptyDataProjectsNoFactorsAndEmptyMessage() {
        val display =
            ProjectedRangeProjection.project(
                ProjectedRangeData.EMPTY,
                ProjectedRangeRegistration.defaultSize,
                strings,
                prefs(),
                Locale.US,
            )
        assertFalse(display.hasData)
        assertTrue(display.factors.isEmpty())
        assertNull(display.badge)
        assertEquals("No projected range data", display.emptyMessage)
    }

    @Test
    fun healthBandThresholdsMatchWeb() {
        assertEquals(HealthBand.Excellent, ProjectedRangeProjection.healthBandFor(90.0))
        assertEquals(HealthBand.Good, ProjectedRangeProjection.healthBandFor(89.9))
        assertEquals(HealthBand.Good, ProjectedRangeProjection.healthBandFor(70.0))
        assertEquals(HealthBand.Fair, ProjectedRangeProjection.healthBandFor(69.9))
        assertEquals(HealthBand.Fair, ProjectedRangeProjection.healthBandFor(50.0))
        assertEquals(HealthBand.Poor, ProjectedRangeProjection.healthBandFor(49.9))
    }

    @Test
    fun comparisonBandThresholdsMatchWeb() {
        assertEquals(ComparisonBand.Good, ProjectedRangeProjection.comparisonBandFor(100))
        assertEquals(ComparisonBand.Good, ProjectedRangeProjection.comparisonBandFor(80))
        assertEquals(ComparisonBand.Fair, ProjectedRangeProjection.comparisonBandFor(79))
        assertEquals(ComparisonBand.Fair, ProjectedRangeProjection.comparisonBandFor(60))
        assertEquals(ComparisonBand.Poor, ProjectedRangeProjection.comparisonBandFor(59))
        assertEquals(ComparisonBand.Poor, ProjectedRangeProjection.comparisonBandFor(null))
    }

    @Test
    fun rangePctClampsGuardsAndRounds() {
        assertEquals(75, ProjectedRangeProjection.rangePct(300.0, 400.0))
        assertEquals(100, ProjectedRangeProjection.rangePct(400.0, 400.0))
        // Web `Math.min(100, …)`: a projected range above EPA clamps to 100%.
        assertEquals(100, ProjectedRangeProjection.rangePct(500.0, 400.0))
        // Web guards: a missing range or a non-positive EPA yields no ratio.
        assertNull(ProjectedRangeProjection.rangePct(null, 400.0))
        assertNull(ProjectedRangeProjection.rangePct(300.0, null))
        assertNull(ProjectedRangeProjection.rangePct(300.0, 0.0))
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("projected-range", ProjectedRangeRegistration.ID)
        assertEquals("battery", ProjectedRangeRegistration.CATEGORY)
        assertEquals("ProjectedRangeWidget", ProjectedRangeRegistration.SLUG)
        assertEquals(ProjectedRangeSize(cols = 2, rows = 2), ProjectedRangeRegistration.defaultSize)
        assertEquals(ProjectedRangeSize(cols = 1, rows = 2), ProjectedRangeRegistration.minSize)
        assertEquals(ProjectedRangeSize(cols = 3, rows = 40), ProjectedRangeRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(ProjectedRangeSize(cols = 3, rows = 40), ProjectedRangeRegistration.clamp(ProjectedRangeSize(9, 99)))
        assertEquals(ProjectedRangeSize(cols = 1, rows = 2), ProjectedRangeRegistration.clamp(ProjectedRangeSize(0, 0)))
        assertTrue(ProjectedRangeRegistration.isWithinBounds(ProjectedRangeSize(2, 2)))
        assertFalse(ProjectedRangeRegistration.isWithinBounds(ProjectedRangeSize(4, 2)))
    }

    @Test
    fun compactAndWideBranchesFollowColumnCount() {
        assertTrue(ProjectedRangeSize(cols = 1, rows = 2).isCompact)
        assertFalse(ProjectedRangeSize(cols = 2, rows = 2).isCompact)
        assertFalse(ProjectedRangeSize(cols = 2, rows = 2).isWide)
        assertTrue(ProjectedRangeSize(cols = 3, rows = 4).isWide)
    }
}
