// Off-device unit coverage for the VehicleHeroCard surface's pure model (P3 acceptance: adapter +
// per-state + a11y/diagnostics pieces). Exercises the prompt-mandated registration slug, the props →
// render-ready projection (the native "adapter": SI→display unit conversion for the gauges + stat grid,
// the web `Math.round` / `fmtInt` / `fmtNumber` parity, the battery color threshold, the FSM status
// normalization, and the `vehicleState == null` offline card), and the PII-safe `view.opened`
// diagnostic. No Compose / Android framework / HTTP — runs in :android:testReleaseUnitTest. Reference
// values are the strings + behaviour the web `VehicleHeroCard` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehicleherocard

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

class VehicleHeroCardModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("vehicle-hero-card", VehicleHeroCardRegistration.ID)
        assertEquals("VehicleHeroCard", VehicleHeroCardRegistration.SLUG)
    }

    // ── identity passthrough ──────────────────────────────────────────────────────────

    @Test
    fun identityPassesThroughNameVinModel() {
        val display = VehicleHeroCardProjection.project(vehicle(), state(), metric())
        assertEquals("Model 3", display.name)
        assertEquals("VIN5", display.vin)
        assertEquals("Model 3", display.model)
    }

    @Test
    fun nameFallsBackToVinWhenDisplayNameBlank() {
        val display = VehicleHeroCardProjection.project(vehicle(displayName = "  "), state(), metric())
        assertEquals("VIN5", display.name)
    }

    @Test
    fun modelIsTrimmedAndBlankModelIsEmpty() {
        assertEquals("Model Y", VehicleHeroCardProjection.project(vehicle(model = "  Model Y  "), state(), metric()).model)
        assertEquals("", VehicleHeroCardProjection.project(vehicle(model = null), state(), metric()).model)
    }

    // ── gauges + stats: metric (SI defaults) ──────────────────────────────────────────

    @Test
    fun metricProjectionConvertsGaugesAndStats() {
        val display =
            VehicleHeroCardProjection.project(
                vehicle(),
                state(
                    batteryLevel = 72,
                    ratedRange = 402_336.0,
                    insideTemp = 21.0,
                    outsideTemp = 9.0,
                    odometer = 50_000_000.0,
                ),
                metric(),
            )
        assertTrue(display.hasState)
        // battery gauge: raw level, max 100, %, cyan (> 20)
        assertEquals(72.0, display.batteryGauge.value, 0.0)
        assertEquals(VEHICLE_HERO_BATTERY_MAX, display.batteryGauge.max, 0.0)
        assertEquals(VEHICLE_HERO_PERCENT, display.batteryGauge.unit)
        assertEquals(VehicleHeroAccent.Cyan, display.batteryGauge.accent)
        // range gauge: 402,336 m → 402 km, max 644, green
        assertEquals(402.0, display.rangeGauge.value, 0.0)
        assertEquals(VEHICLE_HERO_RANGE_MAX_KM, display.rangeGauge.max, 0.0)
        assertEquals("km", display.rangeGauge.unit)
        assertEquals(VehicleHeroAccent.Green, display.rangeGauge.accent)
        // temperature gauges: °C passthrough, max 50, amber / purple
        assertEquals(21.0, display.insideGauge.value, 0.0)
        assertEquals(VehicleHeroAccent.Amber, display.insideGauge.accent)
        assertEquals(VEHICLE_HERO_TEMP_MAX_C, display.insideGauge.max, 0.0)
        assertEquals(9.0, display.outsideGauge.value, 0.0)
        assertEquals(VehicleHeroAccent.Purple, display.outsideGauge.accent)
        // stat strings
        assertEquals("21", display.insideTempText)
        assertEquals("9", display.outsideTempText)
        assertEquals("50,000", display.odometerText)
        assertEquals("402", display.rangeText)
        assertEquals("km", display.distanceUnit)
        assertEquals("\u00B0C", display.temperatureUnit)
    }

    // ── gauges + stats: imperial (mi / °F) ─────────────────────────────────────────────

    @Test
    fun imperialProjectionConvertsToMilesAndFahrenheit() {
        val display =
            VehicleHeroCardProjection.project(
                vehicle(),
                state(
                    ratedRange = 402_336.0,
                    insideTemp = 21.0,
                    outsideTemp = 9.0,
                    odometer = 50_000_000.0,
                ),
                imperial(),
            )
        // 402,336 m = 250 mi exactly; gauge max 400
        assertEquals(250.0, display.rangeGauge.value, 0.0)
        assertEquals(VEHICLE_HERO_RANGE_MAX_MI, display.rangeGauge.max, 0.0)
        assertEquals("mi", display.rangeGauge.unit)
        assertEquals("250", display.rangeText)
        // 21 °C → 70 °F, 9 °C → 48 °F; gauge max 122
        assertEquals(70.0, display.insideGauge.value, 0.0)
        assertEquals(VEHICLE_HERO_TEMP_MAX_F, display.insideGauge.max, 0.0)
        assertEquals("70", display.insideTempText)
        assertEquals("48", display.outsideTempText)
        // 50,000,000 m → 31,069 mi (grouped)
        assertEquals("31,069", display.odometerText)
        assertEquals("mi", display.distanceUnit)
        assertEquals("\u00B0F", display.temperatureUnit)
    }

    // ── battery color threshold (web `level > 20 ? cyan : red`) ─────────────────────────

    @Test
    fun batteryAccentSwitchesAtTwentyPercent() {
        assertEquals(VehicleHeroAccent.Red, batteryAccentFor(20))
        assertEquals(VehicleHeroAccent.Cyan, batteryAccentFor(21))
        assertEquals(VehicleHeroAccent.Red, batteryAccentFor(5))
        assertEquals(VehicleHeroAccent.Cyan, batteryAccentFor(100))
    }

    private fun batteryAccentFor(level: Long): VehicleHeroAccent =
        VehicleHeroCardProjection.project(vehicle(), state(batteryLevel = level), metric()).batteryGauge.accent

    // ── lock / sentry / firmware stats ─────────────────────────────────────────────────

    @Test
    fun lockSentryFirmwarePassThrough() {
        val locked =
            VehicleHeroCardProjection.project(
                vehicle(),
                state(isLocked = true, sentryMode = true, softwareVersion = "2025.20.6"),
                metric(),
            )
        assertTrue(locked.isLocked)
        assertTrue(locked.sentryOn)
        assertEquals("2025.20.6", locked.firmware)

        val unlocked =
            VehicleHeroCardProjection.project(
                vehicle(),
                state(isLocked = false, sentryMode = false, softwareVersion = "  "),
                metric(),
            )
        assertFalse(unlocked.isLocked)
        assertFalse(unlocked.sentryOn)
        assertEquals(VEHICLE_HERO_EM_DASH, unlocked.firmware)
    }

    // ── power: web `fmtNumber(power)` (kW on the wire, not converted from watts) ─────────

    @Test
    fun powerFormatsWithUserPrecisionAndGrouping() {
        assertEquals("0.00", VehicleHeroCardProjection.project(vehicle(), state(power = 0.0), metric()).powerText)
        assertEquals("1,234.5", VehicleHeroCardProjection.project(vehicle(), state(power = 1234.5), metricPrecision(1)).powerText)
        // regen (negative) keeps its sign
        assertEquals("-45.00", VehicleHeroCardProjection.project(vehicle(), state(power = -45.0), metric()).powerText)
    }

    // ── status normalization (web `toStatus`) ──────────────────────────────────────────

    @Test
    fun statusKeepsKnownFsmStatesAndNormalizesUnknownToOffline() {
        assertEquals("online", statusFor("online"))
        assertEquals("driving", statusFor("driving"))
        assertEquals("charging", statusFor("charging"))
        assertEquals("asleep", statusFor("asleep"))
        // unknown / blank → offline (web fallback)
        assertEquals(VEHICLE_HERO_OFFLINE, statusFor("teleporting"))
        assertEquals(VEHICLE_HERO_OFFLINE, statusFor("   "))
    }

    private fun statusFor(state: String): String = VehicleHeroCardProjection.project(vehicle(), state(state = state), metric()).status

    // ── offline card: `vehicleState == null` (web `{vs && (...)}`) ───────────────────────

    @Test
    fun nullStateProducesOfflineCardWithoutMetrics() {
        val display = VehicleHeroCardProjection.project(vehicle(), null, metric())
        assertFalse(display.hasState)
        assertEquals(VEHICLE_HERO_OFFLINE, display.status)
        // identity still present
        assertEquals("Model 3", display.name)
        assertEquals("VIN5", display.vin)
        // metrics fall back to em dash; gauges carry no value
        assertEquals(VEHICLE_HERO_EM_DASH, display.odometerText)
        assertEquals(VEHICLE_HERO_EM_DASH, display.rangeText)
        assertEquals(VEHICLE_HERO_EM_DASH, display.insideTempText)
        assertEquals(VEHICLE_HERO_EM_DASH, display.outsideTempText)
        assertEquals(VEHICLE_HERO_EM_DASH, display.firmware)
        assertEquals(VEHICLE_HERO_EM_DASH, display.powerText)
        assertEquals(0.0, display.batteryGauge.value, 0.0)
        assertFalse(display.isLocked)
        assertFalse(display.sentryOn)
        // unit labels still reflect the user's preference
        assertEquals("km", display.distanceUnit)
        assertEquals("\u00B0C", display.temperatureUnit)
    }

    // ── diagnostics: PII-safe view.opened ──────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSlugOnlyDiagnostic() {
        val logger = RecordingLogger()
        VehicleHeroCardDiagnostics.recordViewOpened(logger)
        val record = logger.records.single { it.event == "view.opened" }
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "VehicleHeroCard"), record.fields)
        // no VIN / name / battery / range leaks into the diagnostic
        assertTrue(record.fields.values.none { it.contains("VIN") || it.contains("Model") })
    }

    private companion object {
        fun metric(): UnitPref =
            UnitPref(
                distance = DistanceUnitPref.KM,
                speed = SpeedUnitPref.KMH,
                temperature = TemperatureUnitPref.CELSIUS,
                pressure = PressureUnitPref.BAR,
                energy = EnergyUnitPref.KWH,
                duration = DurationUnitPref.HOURS,
                power = PowerUnitPref.KW,
                locale = "en-US",
                precision = null,
            )

        fun metricPrecision(precision: Int): UnitPref = metric().copy(precision = precision)

        fun imperial(): UnitPref =
            metric().copy(
                distance = DistanceUnitPref.MI,
                speed = SpeedUnitPref.MPH,
                temperature = TemperatureUnitPref.FAHRENHEIT,
                pressure = PressureUnitPref.PSI,
            )

        fun vehicle(
            displayName: String = "Model 3",
            model: String? = "Model 3",
        ): Vehicle =
            Vehicle(
                createdAt = Instant.fromEpochSeconds(0),
                displayName = displayName,
                enrolledAt = Instant.fromEpochSeconds(0),
                id = 5,
                teslaId = 5,
                timezone = "UTC",
                updatedAt = Instant.fromEpochSeconds(0),
                vin = "VIN5",
                model = model,
                trimLevel = "Long Range",
            )

        @Suppress("LongParameterList")
        fun state(
            batteryLevel: Long = 72,
            ratedRange: Double = 402_336.0,
            insideTemp: Double = 21.0,
            outsideTemp: Double = 9.0,
            odometer: Double = 0.0,
            isLocked: Boolean = true,
            sentryMode: Boolean = false,
            softwareVersion: String = "2025.1.0",
            power: Double = 0.0,
            state: String = "online",
        ): VehicleState =
            VehicleState(
                batteryLevel = batteryLevel,
                chargeRate = 0.0,
                chargerPower = 0.0,
                idealRange = ratedRange,
                insideTemp = insideTemp,
                isCharging = false,
                isClimateOn = false,
                isLocked = isLocked,
                latitude = 0.0,
                longitude = 0.0,
                odometer = odometer,
                outsideTemp = outsideTemp,
                power = power,
                ratedRange = ratedRange,
                sentryMode = sentryMode,
                softwareVersion = softwareVersion,
                speed = 0.0,
                state = state,
                timeToFullCharge = 0.0,
                vehicleId = 5,
            )
    }
}
