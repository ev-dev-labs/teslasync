package io.teslasync.android.featureviews.drivehighlightslide

import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the DriveHighlightSlide's pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/analytics/components/review/DriveHighlightSlide.tsx): the SI →
 * display distance conversion (`convertDistanceFromSI(distance_km * 1000, unit)`), the Wh/km → Wh/mi
 * efficiency scaling (`* KM_PER_MILE` only for miles), the `Math.round` display rounding, the `Hh Mm` / `Mm`
 * duration split (`Math.floor(duration_min / 60)` + `duration_min % 60`), the `start/end_address || '—'`
 * fallback, and the `efficiency_wh_km > 0 ? value : '—'` guard. Because the surface is purely presentational,
 * each [DriveHighlightDisplay] field is exactly what the thin composable renders, so these assertions double
 * as the per-state "snapshot" of the populated branch. Runs in the :android:testReleaseUnitTest gate.
 */
class DriveHighlightSlideProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    private val baseDrive =
        DriveHighlight(
            driveId = 1,
            date = "2026-03-14",
            distanceKm = 100.0,
            durationMin = 90.0,
            startAddress = "San Francisco, CA",
            endAddress = "Los Angeles, CA",
            efficiencyWhKm = 150.0,
        )

    // ── Distance: SI km → display unit, rounded, un-grouped (web `{Math.round(distDisplay)}`) ──────

    @Test
    fun distanceInKilometresConvertsAndRoundsToAnUngroupedInteger() {
        val display = DriveHighlightSlideProjection.project(baseDrive.copy(distanceKm = 100.0), DistanceUnitPref.KM)
        assertEquals("100", display.distanceValue)
        assertEquals("km", display.distanceUnit)
    }

    @Test
    fun distanceInMilesConvertsFromSiAndRounds() {
        // 100 km = 100000 m -> 62.137... mi -> Math.round -> 62.
        val display = DriveHighlightSlideProjection.project(baseDrive.copy(distanceKm = 100.0), DistanceUnitPref.MI)
        assertEquals("62", display.distanceValue)
        assertEquals("mi", display.distanceUnit)
    }

    @Test
    fun largeDistanceRendersWithoutThousandsGrouping() {
        // Web interpolates the raw rounded number (no Intl grouping): 1234 km, not "1,234".
        val display = DriveHighlightSlideProjection.project(baseDrive.copy(distanceKm = 1234.0), DistanceUnitPref.KM)
        assertEquals("1234", display.distanceValue)
    }

    // ── Efficiency: Wh/km source, scaled to Wh/mi only for miles, or '—' when non-positive ─────────

    @Test
    fun efficiencyInKilometresIsTheSiValueRounded() {
        val display = DriveHighlightSlideProjection.project(baseDrive.copy(efficiencyWhKm = 150.0), DistanceUnitPref.KM)
        assertEquals("150", display.efficiencyValue)
        assertEquals("Wh/km", display.efficiencyUnit)
    }

    @Test
    fun efficiencyInMilesScalesByKilometresPerMile() {
        // 150 Wh/km * 1.609344 = 241.4016 Wh/mi -> Math.round -> 241.
        val display = DriveHighlightSlideProjection.project(baseDrive.copy(efficiencyWhKm = 150.0), DistanceUnitPref.MI)
        assertEquals("241", display.efficiencyValue)
        assertEquals("Wh/mi", display.efficiencyUnit)
    }

    @Test
    fun nonPositiveEfficiencyFallsBackToAnEmDash() {
        // Web `efficiency_wh_km > 0 ? Math.round(effDisplay) : '—'`.
        val zero = DriveHighlightSlideProjection.project(baseDrive.copy(efficiencyWhKm = 0.0), DistanceUnitPref.KM)
        assertEquals(DRIVE_HIGHLIGHT_EM_DASH, zero.efficiencyValue)
        // The unit label is still shown (web always renders the `{efficiencyUnit}` caption).
        assertEquals("Wh/km", zero.efficiencyUnit)

        val negative = DriveHighlightSlideProjection.project(baseDrive.copy(efficiencyWhKm = -5.0), DistanceUnitPref.MI)
        assertEquals(DRIVE_HIGHLIGHT_EM_DASH, negative.efficiencyValue)
    }

    @Test
    fun efficiencyUnitLabelTracksTheDistancePreference() {
        assertEquals("Wh/mi", DriveHighlightSlideProjection.efficiencyUnitLabel(DistanceUnitPref.MI))
        assertEquals("Wh/km", DriveHighlightSlideProjection.efficiencyUnitLabel(DistanceUnitPref.KM))
    }

    // ── Duration: web `hours > 0 ? '{h}h {m}m' : '{m}m'` over floor/remainder of duration_min ───────

    @Test
    fun durationUnderOneHourOmitsTheHourSegment() {
        assertEquals("45m", DriveHighlightSlideProjection.durationString(45.0))
        assertEquals("0m", DriveHighlightSlideProjection.durationString(0.0))
        assertEquals("59m", DriveHighlightSlideProjection.durationString(59.0))
    }

    @Test
    fun durationOfAnHourOrMoreShowsBothSegments() {
        assertEquals("1h 0m", DriveHighlightSlideProjection.durationString(60.0))
        assertEquals("1h 30m", DriveHighlightSlideProjection.durationString(90.0))
        assertEquals("2h 5m", DriveHighlightSlideProjection.durationString(125.0))
        assertEquals("4h 5m", DriveHighlightSlideProjection.durationString(245.0))
    }

    @Test
    fun wholeMinuteDurationNeverGainsATrailingDecimal() {
        // JavaScript `${30}` renders "30", not "30.0" — the duration string must match.
        assertEquals("1h 30m", DriveHighlightSlideProjection.durationString(90.0))
        assertEquals(false, DriveHighlightSlideProjection.durationString(90.0).contains(".0"))
    }

    // ── Route fallback (web `address || '—'`) + raw date passthrough ────────────────────────────────

    @Test
    fun blankRouteEndpointsFallBackToAnEmDash() {
        val display =
            DriveHighlightSlideProjection.project(
                baseDrive.copy(startAddress = "", endAddress = ""),
                DistanceUnitPref.KM,
            )
        assertEquals(DRIVE_HIGHLIGHT_EM_DASH, display.routeStart)
        assertEquals(DRIVE_HIGHLIGHT_EM_DASH, display.routeEnd)
    }

    @Test
    fun presentRouteEndpointsAndDatePassThroughUnchanged() {
        val display =
            DriveHighlightSlideProjection.project(
                baseDrive.copy(startAddress = "Reno, NV", endAddress = "Tahoe, CA", date = "2026-12-31"),
                DistanceUnitPref.KM,
            )
        assertEquals("Reno, NV", display.routeStart)
        assertEquals("Tahoe, CA", display.routeEnd)
        assertEquals("2026-12-31", display.date)
    }

    // ── Rounding parity with JavaScript Math.round (ties towards positive infinity) ─────────────────

    @Test
    fun roundedDisplayRoundsHalvesUpLikeMathRound() {
        assertEquals("1", DriveHighlightSlideProjection.roundedDisplay(0.5))
        assertEquals("2", DriveHighlightSlideProjection.roundedDisplay(1.5))
        assertEquals("3", DriveHighlightSlideProjection.roundedDisplay(2.5))
        assertEquals("2", DriveHighlightSlideProjection.roundedDisplay(2.4))
        assertEquals("3", DriveHighlightSlideProjection.roundedDisplay(2.6))
    }

    // ── Data adapter: decode the cached snake_case API row (extra columns ignored) and project ──────

    @Test
    fun projectsStraightOffTheCachedApiJsonIgnoringUnknownColumns() {
        val json =
            """
            {
              "drive_id": 99,
              "date": "2026-07-04",
              "distance_km": 100,
              "duration_min": 90,
              "start_address": "A",
              "end_address": "B",
              "efficiency_wh_km": 150,
              "max_speed_kmh": 120,
              "temperature_c": 21
            }
            """.trimIndent()
        val decoded = lenientJson.decodeFromString<DriveHighlight>(json)

        assertEquals(99L, decoded.driveId)
        assertEquals(100.0, decoded.distanceKm, 0.0)
        assertEquals("A", decoded.startAddress)

        val display = DriveHighlightSlideProjection.project(decoded, DistanceUnitPref.KM)
        assertEquals("100", display.distanceValue)
        assertEquals("km", display.distanceUnit)
        assertEquals("1h 30m", display.durationValue)
        assertEquals("150", display.efficiencyValue)
        assertEquals("Wh/km", display.efficiencyUnit)
        assertEquals("A", display.routeStart)
        assertEquals("B", display.routeEnd)
        assertEquals("2026-07-04", display.date)
    }
}
