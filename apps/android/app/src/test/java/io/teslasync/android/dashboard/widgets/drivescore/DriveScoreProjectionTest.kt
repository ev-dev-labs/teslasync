package io.teslasync.android.dashboard.widgets.drivescore

import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the DriveScoreWidget's pure logic — the raw-SI-JSON decode, the
 * efficiency→score derivation (web `Math.round((250 / efficiency) * 100)` capped at 100, with
 * JavaScript half-away-from-zero rounding), the score colour-band thresholds, the SI Wh/km→Wh/mi
 * efficiency conversion + zero-decimal formatting, the settings-derived display preferences, and the
 * registry metadata. Mirrors the web spec (web/src/features/dashboard/widgets/DriveScoreWidget.tsx).
 */
class DriveScoreProjectionTest {
    private val strings =
        DriveScoreStrings(
            score = "Score",
            efficiency = "Efficiency",
            noData = "No data yet",
        )

    private fun analyticsJson(efficiency: Double) =
        buildJsonObject {
            put("period_days", 7)
            put("total_vehicles", 1)
            put("avg_efficiency_wh_km", efficiency)
        }

    private fun project(
        data: DriveScoreData,
        unit: DistanceUnitPref = DistanceUnitPref.KM,
    ): DriveScoreDisplay = DriveScoreProjection.project(data, DriveScoreDisplayPrefs(unit), strings, Locale.US)

    @Test
    fun parseNullPayloadIsEmpty() {
        val data = parseDriveScore(null)
        assertFalse(data.hasData)
        assertEquals(0.0, data.efficiencyWhKm, 0.0)
    }

    @Test
    fun parseEmptyObjectIsEmpty() {
        val data = parseDriveScore(buildJsonObject { })
        assertFalse(data.hasData)
    }

    @Test
    fun parseReadsSnakeCaseSiEfficiency() {
        val data = parseDriveScore(analyticsJson(312.5))
        assertTrue(data.hasData)
        assertEquals(312.5, data.efficiencyWhKm, 0.0)
    }

    @Test
    fun parseTreatsMissingEfficiencyAsZeroButPresent() {
        val data = parseDriveScore(buildJsonObject { put("period_days", 7) })
        assertTrue(data.hasData)
        assertEquals(0.0, data.efficiencyWhKm, 0.0)
    }

    @Test
    fun scoreForReproducesWebFormulaAndCap() {
        // 250 / eff * 100, capped at 100.
        assertEquals(100, DriveScoreProjection.scoreFor(250.0)) // exactly 100
        assertEquals(100, DriveScoreProjection.scoreFor(200.0)) // 125 → capped
        assertEquals(50, DriveScoreProjection.scoreFor(500.0)) // 50
        assertEquals(25, DriveScoreProjection.scoreFor(1000.0)) // 25
        assertEquals(83, DriveScoreProjection.scoreFor(300.0)) // 83.33 → 83
    }

    @Test
    fun scoreForUsesJavaScriptHalfAwayRounding() {
        // 250 / 400 * 100 = 62.5. JS Math.round → 63; Kotlin banker's round() would give 62.
        assertEquals(63, DriveScoreProjection.scoreFor(400.0))
    }

    @Test
    fun scoreForZeroOrNegativeEfficiencyIsZero() {
        assertEquals(0, DriveScoreProjection.scoreFor(0.0))
        assertEquals(0, DriveScoreProjection.scoreFor(-10.0))
    }

    @Test
    fun bandForFollowsWebThresholds() {
        assertEquals(ScoreBand.Good, DriveScoreProjection.bandFor(100))
        assertEquals(ScoreBand.Good, DriveScoreProjection.bandFor(76))
        assertEquals(ScoreBand.Fair, DriveScoreProjection.bandFor(75)) // > 75 is false → Fair
        assertEquals(ScoreBand.Fair, DriveScoreProjection.bandFor(51))
        assertEquals(ScoreBand.Poor, DriveScoreProjection.bandFor(50)) // > 50 is false → Poor
        assertEquals(ScoreBand.Poor, DriveScoreProjection.bandFor(0))
    }

    @Test
    fun efficiencyConversionMatchesWebConstant() {
        assertEquals(200.0, DriveScoreProjection.toEfficiencyDisplay(200.0, DistanceUnitPref.KM), 0.0)
        assertEquals(200.0 * DriveScoreProjection.KM_PER_MILE, DriveScoreProjection.toEfficiencyDisplay(200.0, DistanceUnitPref.MI), 1e-9)
        assertEquals(1.609344, DriveScoreProjection.KM_PER_MILE, 0.0)
    }

    @Test
    fun efficiencyUnitFollowsDistancePreference() {
        assertEquals("Wh/km", DriveScoreProjection.efficiencyUnit(DistanceUnitPref.KM))
        assertEquals("Wh/mi", DriveScoreProjection.efficiencyUnit(DistanceUnitPref.MI))
    }

    @Test
    fun projectMetricBuildsGaugeAndEfficiencyStat() {
        val display = project(parseDriveScore(analyticsJson(500.0)), DistanceUnitPref.KM)
        assertTrue(display.hasData)
        assertEquals(50, display.score)
        assertEquals(50.0, display.gaugeValue, 0.0)
        assertEquals(100.0, display.gaugeMax, 0.0)
        assertEquals(ScoreBand.Poor, display.scoreBand)
        assertEquals("Score", display.scoreLabel)
        assertEquals("500", display.efficiencyValue)
        assertEquals("Wh/km", display.efficiencyUnit)
        assertEquals("Efficiency", display.efficiencyLabel)
        assertEquals("Score: 50", display.gaugeContentDescription)
    }

    @Test
    fun projectImperialConvertsAndFormatsEfficiency() {
        // 200 Wh/km → 321.8688 Wh/mi → "322" at zero decimals; score 100 (125 capped) → Good.
        val display = project(parseDriveScore(analyticsJson(200.0)), DistanceUnitPref.MI)
        assertEquals(100, display.score)
        assertEquals(ScoreBand.Good, display.scoreBand)
        assertEquals("322", display.efficiencyValue)
        assertEquals("Wh/mi", display.efficiencyUnit)
        assertEquals("Score: 100", display.gaugeContentDescription)
    }

    @Test
    fun projectEmptyShowsZeroScoreAndNoDataMessage() {
        val display = project(DriveScoreData.EMPTY)
        assertFalse(display.hasData)
        assertEquals(0, display.score)
        assertEquals(0.0, display.gaugeValue, 0.0)
        assertEquals(100.0, display.gaugeMax, 0.0)
        assertEquals(ScoreBand.Poor, display.scoreBand)
        assertEquals("0", display.efficiencyValue)
        assertEquals("No data yet", display.emptyMessage)
    }

    @Test
    fun displayPrefsResolveFromSettings() {
        assertEquals(DriveScoreDisplayPrefs.METRIC_DEFAULT, DriveScoreDisplayPrefs.fromSettings(null))
        assertEquals(DistanceUnitPref.KM, DriveScoreDisplayPrefs.METRIC_DEFAULT.distanceUnit)

        val imperial = DriveScoreDisplayPrefs.fromSettings(buildJsonObject { put("unit_of_length", "mi") })
        assertEquals(DistanceUnitPref.MI, imperial.distanceUnit)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("drive-score", DriveScoreRegistration.ID)
        assertEquals("driving", DriveScoreRegistration.CATEGORY)
        assertEquals("DriveScoreWidget", DriveScoreRegistration.SLUG)
        assertEquals(7, DriveScoreRegistration.WINDOW_DAYS)
        assertEquals(DriveScoreSize(cols = 1, rows = 2), DriveScoreRegistration.defaultSize)
        assertEquals(DriveScoreSize(cols = 1, rows = 2), DriveScoreRegistration.minSize)
        assertEquals(DriveScoreSize(cols = 2, rows = 40), DriveScoreRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(DriveScoreSize(cols = 2, rows = 40), DriveScoreRegistration.clamp(DriveScoreSize(9, 99)))
        assertEquals(DriveScoreSize(cols = 1, rows = 2), DriveScoreRegistration.clamp(DriveScoreSize(0, 0)))
        assertTrue(DriveScoreRegistration.isWithinBounds(DriveScoreSize(1, 2)))
        assertTrue(DriveScoreRegistration.isWithinBounds(DriveScoreSize(2, 10)))
        assertFalse(DriveScoreRegistration.isWithinBounds(DriveScoreSize(3, 10)))
    }

    @Test
    fun compactBranchFollowsOneByOneFootprint() {
        assertTrue(DriveScoreSize(cols = 1, rows = 1).isCompact)
        assertFalse(DriveScoreSize(cols = 1, rows = 2).isCompact)
        assertFalse(DriveScoreSize(cols = 2, rows = 2).isCompact)
    }
}
