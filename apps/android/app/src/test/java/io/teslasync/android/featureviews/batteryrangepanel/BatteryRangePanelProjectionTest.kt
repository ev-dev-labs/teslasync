package io.teslasync.android.featureviews.batteryrangepanel

import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.VehicleState
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the BatteryRangePanel's pure logic — the native analogue of every derivation the
 * web component performs (web/src/features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx): the
 * `batteryColor` tone thresholds, the SI-floored `formatDistance(rated/ideal, 0)` metric values, the
 * `is_charging ? "{dist}/h" : "Not Charging"` value ternary, the
 * `is_charging && time_to_full_charge > 0 → "Full in {x}h"` subtitle guard, and the `state` → field adapter.
 * Runs in the :app:testReleaseUnitTest gate; Locale.US fixes the number formatting so the assertions are
 * deterministic and the conversion factors stay owned by the shared units lib (never re-implemented here).
 */
class BatteryRangePanelProjectionTest {
    private val us = Locale.US
    private val metric = UnitFormatter(UnitPreferences.fromSettings(null))
    private val imperial = UnitFormatter(UnitPreferences.fromSettings(buildJsonObject { put("unit_of_length", "mi") }))

    private val strings =
        BatteryRangeStrings(
            battery = "Battery",
            ratedRange = "Rated Range",
            idealRange = "Ideal Range",
            charging = "Charging",
            notCharging = "Not Charging",
            fullIn = "Full in",
        )

    /** A not-charging baseline at 72% (386 km rated / 402 km ideal); tests derive variants via [copy]. */
    private val base =
        BatteryRangeData(
            batteryLevel = 72.0,
            ratedRangeMeters = 386_000.0,
            idealRangeMeters = 402_000.0,
            isCharging = false,
            chargeRateMeters = 0.0,
            timeToFullChargeHours = 0.0,
        )

    // ── Tone (web `batteryColor`: > 60 green, > 25 amber, else red) ──────────────────────────────────

    @Test
    fun toneFollowsTheWebBatteryColorThresholds() {
        assertEquals(BatteryTone.Good, BatteryRangeProjection.tone(100.0))
        assertEquals(BatteryTone.Good, BatteryRangeProjection.tone(61.0))
        // 60 is NOT > 60, so it falls to the amber band (web `level > 60` is false at exactly 60).
        assertEquals(BatteryTone.Warn, BatteryRangeProjection.tone(60.0))
        assertEquals(BatteryTone.Warn, BatteryRangeProjection.tone(26.0))
        // 25 is NOT > 25, so it falls to the red band.
        assertEquals(BatteryTone.Critical, BatteryRangeProjection.tone(25.0))
        assertEquals(BatteryTone.Critical, BatteryRangeProjection.tone(0.0))
    }

    // ── Metric projection (SI metres → km at precision 0; charge rate at the default precision) ──────

    @Test
    fun projectFormatsRangesInTheUserUnitAndPassesThroughTheGauge() {
        val display = BatteryRangeProjection.project(base, metric, strings, us)

        assertEquals(72.0, display.batteryLevel, 0.0)
        assertEquals("%", display.batteryUnit)
        assertEquals("Battery", display.batteryLabel)
        assertEquals(BatteryTone.Good, display.tone)
        assertEquals("Rated Range", display.ratedRangeLabel)
        assertEquals("386 km", display.ratedRangeValue)
        assertEquals("Ideal Range", display.idealRangeLabel)
        assertEquals("402 km", display.idealRangeValue)
        assertEquals("Charging", display.chargingLabel)
    }

    @Test
    fun chargingValueAndSubtitleRenderWhileCharging() {
        val display =
            BatteryRangeProjection.project(
                base.copy(isCharging = true, chargeRateMeters = 48_000.0, timeToFullChargeHours = 2.5),
                metric,
                strings,
                us,
            )

        assertEquals(true, display.chargingActive)
        // Web `${formatDistance(charge_rate)}/h` — the default distance precision (1) plus the `/h` suffix.
        assertEquals("48.0 km/h", display.chargingValue)
        // Web `Full in {fmtNumber(time_to_full_charge, 1)}h`.
        assertEquals("Full in 2.5h", display.chargingSubtitle)
    }

    @Test
    fun notChargingShowsTheLocalizedLabelAndNoSubtitle() {
        val display = BatteryRangeProjection.project(base, metric, strings, us)

        assertEquals(false, display.chargingActive)
        assertEquals("Not Charging", display.chargingValue)
        assertNull(display.chargingSubtitle)
    }

    @Test
    fun chargingWithNoEstimateHidesTheSubtitle() {
        // Web `is_charging && time_to_full_charge > 0` — charging but a zero estimate ⇒ no subtitle.
        val display =
            BatteryRangeProjection.project(
                base.copy(isCharging = true, chargeRateMeters = 20_000.0, timeToFullChargeHours = 0.0),
                metric,
                strings,
                us,
            )

        assertEquals("20.0 km/h", display.chargingValue)
        assertNull(display.chargingSubtitle)
    }

    // ── Imperial: the projection delegates unit math to the shared formatter (no re-implementation) ───

    @Test
    fun projectHonoursTheImperialUnitPreferenceViaTheFormatter() {
        val input = base.copy(isCharging = true, chargeRateMeters = 48_000.0)
        val display = BatteryRangeProjection.project(input, imperial, strings, us)

        assertEquals(imperial.distance(386_000.0, 0), display.ratedRangeValue)
        assertEquals(imperial.distance(402_000.0, 0), display.idealRangeValue)
        assertEquals(imperial.distance(48_000.0) + "/h", display.chargingValue)
    }

    // ── Adapter: VehicleState → BatteryRangeData (cached payload → projection input) ─────────────────

    @Test
    fun fromMapsTheSixReadFieldsOffTheVehicleState() {
        val state =
            VehicleState(
                batteryLevel = 47L,
                chargeRate = 33_000.0,
                chargerPower = 11.0,
                idealRange = 410_000.0,
                insideTemp = 20.0,
                isCharging = true,
                isClimateOn = false,
                isLocked = true,
                latitude = 37.0,
                longitude = -122.0,
                odometer = 1_000_000.0,
                outsideTemp = 12.0,
                power = 5.0,
                ratedRange = 390_000.0,
                sentryMode = false,
                softwareVersion = "2024.20",
                speed = 0.0,
                state = "online",
                timeToFullCharge = 3.5,
                vehicleId = 9L,
            )

        val adapted = BatteryRangeData.from(state)

        assertEquals(47.0, adapted.batteryLevel, 0.0)
        assertEquals(390_000.0, adapted.ratedRangeMeters, 0.0)
        assertEquals(410_000.0, adapted.idealRangeMeters, 0.0)
        assertEquals(true, adapted.isCharging)
        assertEquals(33_000.0, adapted.chargeRateMeters, 0.0)
        assertEquals(3.5, adapted.timeToFullChargeHours, 0.0)
    }
}
