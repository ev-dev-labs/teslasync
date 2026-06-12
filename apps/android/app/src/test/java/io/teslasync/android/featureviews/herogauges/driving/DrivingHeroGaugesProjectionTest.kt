package io.teslasync.android.featureviews.herogauges.driving

import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the drive-detail HeroGauges' pure logic — the native mirror of every derivation
 * the web component performs (web/src/features/driving/components/drive-detail/HeroGauges.tsx): the SI distance
 * conversion + 1.5×-or-floor axis, the pre-converted max-speed value over a `convertSpeedFromSI(250)` axis, the
 * seconds→minutes duration, the Wh/km→Wh/mi consumption branch, the conditional efficiency gauge, the
 * `Math.round`/`Number(fmtNumber(...))` value rounding, the `[0, max]` clamp, and the web RadialGauge
 * `isInteger(clamped) ? 0 : precision` decimal rule. Because the surface is purely presentational, each
 * [DriveGauge] is exactly what the thin composable hands the shared RadialGauge, so these assertions double as
 * the per-state "snapshot"; the non-blank label + finite value checks additionally verify every gauge stays
 * accessible (TalkBack-readable) in every state.
 */
class DrivingHeroGaugesProjectionTest {
    private val strings =
        DrivingHeroGaugesStrings(
            distance = "Distance",
            maxSpeed = "Max Speed",
            duration = "Duration",
            consumption = "Consumption",
            efficiency = "Efficiency",
        )

    private val metricPrefs = DrivingHeroGaugesDisplayPrefs(DistanceUnitPref.KM, SpeedUnitPref.KMH, 2)
    private val imperialPrefs = DrivingHeroGaugesDisplayPrefs(DistanceUnitPref.MI, SpeedUnitPref.MPH, 2)

    // 84.5 km over 72 min, 118 km/h peak, 168 Wh/km, 14.3 %/100km.
    private val sample =
        DriveGaugesInput(
            distanceM = 84_500.0,
            durationS = 4_320.0,
            maxSpeedDisplay = 118.0,
            consumptionWhKm = 168.0,
            efficiencyPctPer100 = 14.3,
        )

    // ── Surface contract constants ────────────────────────────────────────────────

    @Test
    fun projectionContractMatchesTheWebComposition() {
        assertEquals(4, DrivingHeroGaugesProjection.MANDATORY_GAUGE_COUNT)
        assertEquals(5, DrivingHeroGaugesProjection.MAX_GAUGE_COUNT)
    }

    // ── project(): per-state ──────────────────────────────────────────────────────

    @Test
    fun resolvedMetricPayloadProjectsEveryGaugeInWebOrder() {
        val gauges = DrivingHeroGaugesProjection.project(sample, metricPrefs, strings).gauges

        assertEquals(DrivingHeroGaugesProjection.MAX_GAUGE_COUNT, gauges.size)
        // 84.5 km -> Math.round 85; max = max(84.5*1.5, 100) = 126.75.
        assertEquals(DriveGauge("Distance", 85.0, 126.75, "km", 0, DriveGaugeAccent.Distance), gauges[0])
        // maxSpd arrives pre-converted (118 km/h); max = convertSpeedFromSI(250, km/h) = 900.
        assertEquals(DriveGauge("Max Speed", 118.0, 900.0, "km/h", 0, DriveGaugeAccent.MaxSpeed), gauges[1])
        // 4320 s / 60 = 72 min; max = max(72*1.5, 60) = 108.
        assertEquals(DriveGauge("Duration", 72.0, 108.0, "min", 0, DriveGaugeAccent.Duration), gauges[2])
        // 168 Wh/km (metric, no scale); max = max(168*1.5, 300) = 300.
        assertEquals(DriveGauge("Consumption", 168.0, 300.0, "Wh/km", 0, DriveGaugeAccent.Consumption), gauges[3])
        // efficiency 14.3 -> two-dp value (fractional -> precision decimals); max fixed at 30.
        assertEquals(DriveGauge("Efficiency", 14.3, 30.0, "%/100km", 2, DriveGaugeAccent.Efficiency), gauges[4])
    }

    @Test
    fun resolvedImperialPayloadConvertsDistanceSpeedAxisConsumptionAndUnits() {
        val gauges = DrivingHeroGaugesProjection.project(sample, imperialPrefs, strings).gauges

        // 84500 m / 1609.344 = 52.5059 -> Math.round 53 "mi".
        assertEquals(53.0, gauges[0].value, 0.0)
        assertEquals("mi", gauges[0].unit)
        // Max-speed axis converts the 250 m/s ceiling to mph; the value itself is the pre-converted scalar.
        assertEquals("mph", gauges[1].unit)
        assertEquals(convertSpeedFromSI(250.0, SpeedUnitPref.MPH), gauges[1].max, 0.0)
        // 168 Wh/km * 1.609344 = 270.37 -> Math.round 270 "Wh/mi".
        assertEquals(270.0, gauges[3].value, 0.0)
        assertEquals("Wh/mi", gauges[3].unit)
        // Efficiency unit follows isMiles.
        assertEquals("%/100mi", gauges[4].unit)
    }

    @Test
    fun nullInputProjectsTheFourZeroGaugesNeverBlankAndNoEfficiency() {
        // Web parity: a present-but-empty drive renders the four gauges with `?? 0` zeros (never a blank box);
        // the projection treats a `null` prop the same way, and the absent efficiency hides the fifth gauge.
        val gauges = DrivingHeroGaugesProjection.project(input = null, prefs = metricPrefs, strings = strings).gauges

        assertEquals(DrivingHeroGaugesProjection.MANDATORY_GAUGE_COUNT, gauges.size)
        assertEquals(0.0, gauges[0].value, 0.0)
        assertEquals(0.0, gauges[1].value, 0.0)
        assertEquals(0.0, gauges[2].value, 0.0)
        assertEquals(0.0, gauges[3].value, 0.0)
        // Floors still apply so the arc denominators are never zero.
        assertEquals(100.0, gauges[0].max, 0.0)
        assertEquals(convertSpeedFromSI(250.0, SpeedUnitPref.KMH), gauges[1].max, 0.0)
        assertEquals(60.0, gauges[2].max, 0.0)
        assertEquals(300.0, gauges[3].max, 0.0)
    }

    @Test
    fun efficiencyGaugeOmittedWhenNullAndShownWhenPresentEvenAtZero() {
        // Web `stats.efficiencyPctPer100 != null && <RadialGauge/>`: null hides it, a present 0 still renders it.
        val without = DrivingHeroGaugesProjection.project(sample.copy(efficiencyPctPer100 = null), metricPrefs, strings)
        assertEquals(DrivingHeroGaugesProjection.MANDATORY_GAUGE_COUNT, without.gauges.size)

        val withZero = DrivingHeroGaugesProjection.project(sample.copy(efficiencyPctPer100 = 0.0), metricPrefs, strings)
        assertEquals(DrivingHeroGaugesProjection.MAX_GAUGE_COUNT, withZero.gauges.size)
        assertEquals(0.0, withZero.gauges[4].value, 0.0)
        assertEquals(0, withZero.gauges[4].decimals)
    }

    @Test
    fun wholeNumberGaugesRoundHalfUpLikeMathRound() {
        // Math.round(2.5) = 3, Math.round(2.4) = 2 — the four whole-number gauges round half away from zero.
        val up = DrivingHeroGaugesProjection.project(DriveGaugesInput.ZERO.copy(distanceM = 2_500.0), metricPrefs, strings)
        assertEquals(3.0, up.gauges[0].value, 0.0)
        val down = DrivingHeroGaugesProjection.project(DriveGaugesInput.ZERO.copy(distanceM = 2_400.0), metricPrefs, strings)
        assertEquals(2.0, down.gauges[0].value, 0.0)
    }

    @Test
    fun efficiencyValueRoundsToUserPrecisionAndDerivesItsDecimals() {
        // Fractional efficiency -> precision decimals (web getGlobalPrecision); a value that rounds to a whole
        // number -> 0 decimals (web Number.isInteger(clamped)).
        val fractional = DrivingHeroGaugesProjection.project(sample.copy(efficiencyPctPer100 = 14.356), metricPrefs, strings)
        assertEquals(14.36, fractional.gauges[4].value, 0.0)
        assertEquals(2, fractional.gauges[4].decimals)

        val roundsToWhole = DrivingHeroGaugesProjection.project(sample.copy(efficiencyPctPer100 = 11.997), metricPrefs, strings)
        assertEquals(12.0, roundsToWhole.gauges[4].value, 0.0)
        assertEquals(0, roundsToWhole.gauges[4].decimals)
    }

    @Test
    fun efficiencyValueClampsToTheZeroThirtyTrack() {
        // Web RadialGauge `Math.max(0, Math.min(value, 30))`: above-30 clamps to 30, negative clamps to 0.
        val high = DrivingHeroGaugesProjection.project(sample.copy(efficiencyPctPer100 = 45.6), metricPrefs, strings)
        assertEquals(30.0, high.gauges[4].value, 0.0)

        val negative = DrivingHeroGaugesProjection.project(sample.copy(efficiencyPctPer100 = -5.2), metricPrefs, strings)
        assertEquals(0.0, negative.gauges[4].value, 0.0)
    }

    @Test
    fun everyGaugeCarriesANonBlankLabelAndFiniteRenderableValueInEveryState() {
        // Accessibility: each RadialGauge exposes a label + value to TalkBack; none may be blank/NaN in any state.
        listOf(
            DrivingHeroGaugesProjection.project(sample, metricPrefs, strings),
            DrivingHeroGaugesProjection.project(sample, imperialPrefs, strings),
            DrivingHeroGaugesProjection.project(input = null, prefs = metricPrefs, strings = strings),
            DrivingHeroGaugesProjection.project(sample.copy(efficiencyPctPer100 = null), metricPrefs, strings),
        ).forEach { display ->
            assertTrue(
                "at least the four mandatory gauges render",
                display.gauges.size >= DrivingHeroGaugesProjection.MANDATORY_GAUGE_COUNT,
            )
            display.gauges.forEach { gauge ->
                assertTrue("label must not be blank", gauge.label.isNotBlank())
                assertTrue("unit must not be blank", gauge.unit.isNotBlank())
                assertTrue("value must be finite", gauge.value.isFinite())
                assertTrue("max must be a positive denominator", gauge.max > 0.0)
                assertTrue("decimals must be non-negative", gauge.decimals >= 0)
            }
        }
    }

    // ── DriveGaugesInput.fromJson(): web `?? 0` + `!= null` parity ─────────────────

    @Test
    fun fromJsonTreatsNullAndJsonNullAsTheAbsentBranch() {
        assertNull(DriveGaugesInput.fromJson(null))
        assertNull(DriveGaugesInput.fromJson(JsonNull))
    }

    @Test
    fun fromJsonTreatsAnEmptyObjectAsResolvedZerosWithNoEfficiency() {
        val input = DriveGaugesInput.fromJson(buildJsonObject {})

        assertNotNull(input)
        assertEquals(0.0, input!!.distanceM, 0.0)
        assertEquals(0.0, input.durationS, 0.0)
        assertEquals(0.0, input.maxSpeedDisplay, 0.0)
        assertEquals(0.0, input.consumptionWhKm, 0.0)
        // Absent efficiency stays null so the fifth gauge is hidden (web `!= null`).
        assertNull(input.efficiencyPctPer100)
    }

    @Test
    fun fromJsonParsesEverySnakeCaseField() {
        val input =
            DriveGaugesInput.fromJson(
                buildJsonObject {
                    put("distance_m", 84_500.0)
                    put("duration_s", 4_320.0)
                    put("max_speed", 118.0)
                    put("consumption_wh_km", 168.0)
                    put("efficiency_pct_per_100", 14.3)
                },
            )

        assertNotNull(input)
        assertEquals(84_500.0, input!!.distanceM, 0.0)
        assertEquals(4_320.0, input.durationS, 0.0)
        assertEquals(118.0, input.maxSpeedDisplay, 0.0)
        assertEquals(168.0, input.consumptionWhKm, 0.0)
        assertEquals(14.3, input.efficiencyPctPer100!!, 0.0)
    }

    @Test
    fun fromJsonKeepsAPresentZeroEfficiencyDistinctFromAbsent() {
        // A present `0.0` is not the absent branch — it renders the gauge (web truthiness of `!= null`).
        val withZero = DriveGaugesInput.fromJson(buildJsonObject { put("efficiency_pct_per_100", 0.0) })
        assertNotNull(withZero)
        assertEquals(0.0, withZero!!.efficiencyPctPer100!!, 0.0)
    }

    @Test
    fun decodedDocumentProjectsTheGridLikeTheOwningPageThreadsIt() {
        // The cached "adapter -> projection" path: an empty cache document renders the four-gauge grid; a
        // document carrying an efficiency renders five.
        val fourGauges = DrivingHeroGaugesProjection.project(DriveGaugesInput.fromJson(buildJsonObject {}), metricPrefs, strings)
        assertEquals(DrivingHeroGaugesProjection.MANDATORY_GAUGE_COUNT, fourGauges.gauges.size)

        val fiveGauges =
            DrivingHeroGaugesProjection.project(
                DriveGaugesInput.fromJson(buildJsonObject { put("efficiency_pct_per_100", 9.0) }),
                metricPrefs,
                strings,
            )
        assertEquals(DrivingHeroGaugesProjection.MAX_GAUGE_COUNT, fiveGauges.gauges.size)
    }

    // ── DrivingHeroGaugesDisplayPrefs.from(): web useSettings + useUnits parity ────

    @Test
    fun prefsDefaultIsMetricKmhTwoDp() {
        val prefs = DrivingHeroGaugesDisplayPrefs.DEFAULT

        assertEquals(DistanceUnitPref.KM, prefs.distanceUnit)
        assertEquals(SpeedUnitPref.KMH, prefs.speedUnit)
        assertEquals(2, prefs.precision)
        assertFalse(prefs.isMiles)
    }

    @Test
    fun prefsFromSettingsDerivesImperialUnitsAndPrecision() {
        val prefs =
            DrivingHeroGaugesDisplayPrefs.from(
                buildJsonObject {
                    put("unit_of_length", "mi")
                    put("decimal_precision", 3.0)
                },
            )

        assertEquals(DistanceUnitPref.MI, prefs.distanceUnit)
        assertEquals(SpeedUnitPref.MPH, prefs.speedUnit)
        assertEquals(3, prefs.precision)
        assertTrue(prefs.isMiles)
    }

    @Test
    fun prefsFromNegativePrecisionFallsBackToTwoDp() {
        val prefs = DrivingHeroGaugesDisplayPrefs.from(buildJsonObject { put("decimal_precision", -1.0) })

        assertEquals(2, prefs.precision)
        assertFalse(prefs.isMiles)
    }
}
