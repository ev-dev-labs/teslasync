// Off-device unit coverage for the Vehicle Gauges feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-label tests). Exercises the four gauge specs (battery / range / speed / power) including
// the SI -> display unit boundary (metric + imperial) and the `Math.round`-ed range/speed pairs, the battery-
// color thresholds (web `batteryColor`), the metric bars (idle two vs charging three), the four quick-info
// chips (lock / sentry / climate / firmware with the blank-firmware fallback), the car-viz projection, the
// accessible summary (label presence), the lifecycle surface classifier (per-state coverage), the web-parity
// state builder, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclegauges

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class VehicleGaugesModelTest {
    private val metric = UnitFormatter.default()
    private val imperial =
        UnitFormatter(UnitPreferences.fromSettings(Json.parseToJsonElement("""{"unit_of_length":"mi"}""")))

    private val strings =
        VehicleGaugesStrings(
            battery = "Battery",
            range = "Range",
            speed = "Speed",
            power = "Power",
            batteryLevel = "Battery Level",
            estimatedRange = "Estimated Range",
            chargeRate = "Charge Rate",
            locked = "Locked",
            unlocked = "Unlocked",
            sentryOn = "Sentry ON",
            sentryOff = "Sentry OFF",
            climateOn = "Climate ON",
            climateOff = "Climate OFF",
            unknown = "Unknown",
        )

    private val vehicle: Vehicle =
        Json.decodeFromString(
            Vehicle.serializer(),
            """
            {"id":7,"tesla_id":42,"vin":"5YJ3VIN000007","display_name":"My Model 3","model":"Model 3",
             "trim_level":"Long Range","timezone":"UTC","created_at":"2026-01-01T00:00:00Z",
             "enrolled_at":"2026-01-01T00:00:00Z","updated_at":"2026-06-01T00:00:00Z"}
            """.trimIndent(),
        )

    @Suppress("LongParameterList")
    private fun state(
        batteryLevel: Long = 72,
        speed: Double = 0.0,
        isCharging: Boolean = false,
        chargerPower: Double = 0.0,
        chargeRate: Double = 0.0,
        isLocked: Boolean = true,
        sentryMode: Boolean = false,
        isClimateOn: Boolean = false,
        softwareVersion: String = "2026.20.1",
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = chargeRate,
            chargerPower = chargerPower,
            idealRange = 380_000.0,
            insideTemp = 21.5,
            isCharging = isCharging,
            isClimateOn = isClimateOn,
            isLocked = isLocked,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 42_000_000.0,
            outsideTemp = 12.0,
            power = 0.0,
            ratedRange = 350_000.0,
            sentryMode = sentryMode,
            softwareVersion = softwareVersion,
            speed = speed,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 7L,
        )

    private fun project(
        vehicleState: VehicleState = state(),
        formatter: UnitFormatter = metric,
    ): VehicleGaugesDisplay =
        VehicleGaugesProjection.project(
            vehicle = vehicle,
            state = vehicleState,
            formatter = formatter,
            strings = strings,
            locale = Locale.US,
        )

    private fun gaugesByKey(display: VehicleGaugesDisplay) = display.gauges.associateBy { it.key }

    private fun chipsByKey(display: VehicleGaugesDisplay) = display.chips.associateBy { it.key }

    // ── Gauges (web four `<RadialGauge>`: battery / range / speed / power) ────────────────────────────

    @Test
    fun gaugesAreTheFourWebGaugesInOrder() {
        val keys = project().gauges.map { it.key }
        assertEquals(listOf("battery", "range", "speed", "power"), keys)
    }

    @Test
    fun batteryGaugeIsPercentOutOfOneHundred() {
        val battery = gaugesByKey(project()).getValue("battery")
        assertEquals(72.0, battery.value, EPSILON)
        assertEquals(BATTERY_MAX, battery.max, EPSILON)
        assertEquals(GAUGE_PERCENT, battery.unit)
        assertEquals(strings.battery, battery.label)
    }

    @Test
    fun rangeGaugeConvertsAndRoundsPerUnitPreference() {
        val km = gaugesByKey(project(formatter = metric)).getValue("range")
        assertEquals(350.0, km.value, EPSILON)
        assertEquals(966.0, km.max, EPSILON)
        assertEquals("km", km.unit)
        assertEquals(GaugeAccent.Info, km.accent)

        val mi = gaugesByKey(project(formatter = imperial)).getValue("range")
        assertEquals(217.0, mi.value, EPSILON)
        assertEquals(600.0, mi.max, EPSILON)
        assertEquals("mi", mi.unit)
    }

    @Test
    fun speedGaugeConvertsItsCeilingAndSignalsDrivingWithTheAccent() {
        val idle = gaugesByKey(project(state(speed = 0.0))).getValue("speed")
        assertEquals(0.0, idle.value, EPSILON)
        assertEquals(402.0, idle.max, EPSILON)
        assertEquals("km/h", idle.unit)
        assertEquals(GaugeAccent.Neutral, idle.accent)

        val driving = gaugesByKey(project(state(speed = 30.0))).getValue("speed")
        assertEquals(GaugeAccent.Power, driving.accent)

        val mph = gaugesByKey(project(state(speed = 0.0), formatter = imperial)).getValue("speed")
        assertEquals(250.0, mph.max, EPSILON)
        assertEquals("mph", mph.unit)
    }

    @Test
    fun powerGaugeIsKilowattsAndTracksChargingAccent() {
        val idle = gaugesByKey(project(state(isCharging = false, chargerPower = 0.0))).getValue("power")
        assertEquals(0.0, idle.value, EPSILON)
        assertEquals(POWER_MAX, idle.max, EPSILON)
        assertEquals(GAUGE_KW, idle.unit)
        assertEquals(GaugeAccent.Neutral, idle.accent)

        val charging = gaugesByKey(project(state(isCharging = true, chargerPower = 48.4))).getValue("power")
        assertEquals(48.4, charging.value, EPSILON)
        assertEquals(GaugeAccent.Success, charging.accent)
    }

    @Test
    fun batteryAccentMatchesTheWebThresholds() {
        assertEquals(GaugeAccent.Success, batteryAccent(61))
        assertEquals(GaugeAccent.Warning, batteryAccent(60))
        assertEquals(GaugeAccent.Warning, batteryAccent(26))
        assertEquals(GaugeAccent.Danger, batteryAccent(25))
        assertEquals(GaugeAccent.Danger, batteryAccent(0))
    }

    @Test
    fun roundWholeRoundsTowardPositiveInfinityLikeTheWeb() {
        assertEquals(3.0, roundWhole(2.5), EPSILON)
        assertEquals(2.0, roundWhole(2.4), EPSILON)
    }

    // ── Metric bars (web `space-y-3`: battery level + estimated range + charge rate while charging) ───

    @Test
    fun idleShowsTwoBarsAndChargingAddsTheChargeRateBar() {
        assertEquals(listOf("batteryLevel", "estimatedRange"), project(state()).bars.map { it.key })
        assertEquals(
            listOf("batteryLevel", "estimatedRange", "chargeRate"),
            project(state(isCharging = true, chargeRate = 48_000.0)).bars.map { it.key },
        )
    }

    @Test
    fun batteryBarShowsAWholePercentSublabel() {
        val bar = project().bars.first { it.key == "batteryLevel" }
        assertEquals("72%", bar.valueText)
        assertEquals(72.0, bar.value, EPSILON)
        assertEquals(BATTERY_MAX, bar.max, EPSILON)
        assertEquals(strings.batteryLevel, bar.label)
    }

    @Test
    fun rangeBarCarriesAFormattedDistanceSublabel() {
        val bar = project().bars.first { it.key == "estimatedRange" }
        assertEquals(strings.estimatedRange, bar.label)
        assertTrue(bar.valueText.isNotBlank())
        assertEquals(GaugeAccent.Info, bar.accent)
    }

    @Test
    fun chargeRateBarSublabelEndsInPerHour() {
        val bar =
            project(state(isCharging = true, chargeRate = 48_000.0)).bars.first { it.key == "chargeRate" }
        assertTrue(bar.valueText.endsWith("/h"))
        assertEquals(GaugeAccent.Success, bar.accent)
    }

    // ── Quick-info chips (web lock / sentry / climate / firmware spans) ───────────────────────────────

    @Test
    fun chipsAreTheFourWebChipsInOrder() {
        assertEquals(listOf("lock", "sentry", "climate", "firmware"), project().chips.map { it.key })
    }

    @Test
    fun lockChipReflectsLockState() {
        val locked = chipsByKey(project(state(isLocked = true))).getValue("lock")
        assertEquals(strings.locked, locked.label)
        assertEquals(GaugeChipGlyph.Lock, locked.glyph)
        assertEquals(GaugeAccent.Success, locked.accent)

        val unlocked = chipsByKey(project(state(isLocked = false))).getValue("lock")
        assertEquals(strings.unlocked, unlocked.label)
        assertEquals(GaugeChipGlyph.Unlock, unlocked.glyph)
        assertEquals(GaugeAccent.Danger, unlocked.accent)
    }

    @Test
    fun sentryAndClimateChipsReflectTheirState() {
        val on = chipsByKey(project(state(sentryMode = true, isClimateOn = true)))
        assertEquals(strings.sentryOn, on.getValue("sentry").label)
        assertEquals(GaugeAccent.Danger, on.getValue("sentry").accent)
        assertEquals(strings.climateOn, on.getValue("climate").label)
        assertEquals(GaugeAccent.Info, on.getValue("climate").accent)

        val off = chipsByKey(project(state(sentryMode = false, isClimateOn = false)))
        assertEquals(strings.sentryOff, off.getValue("sentry").label)
        assertEquals(GaugeAccent.Neutral, off.getValue("sentry").accent)
        assertEquals(strings.climateOff, off.getValue("climate").label)
        assertEquals(GaugeAccent.Neutral, off.getValue("climate").accent)
    }

    @Test
    fun firmwareChipShowsTheVersionElseTheLocalizedFallback() {
        val present = chipsByKey(project(state(softwareVersion = "2026.20.1"))).getValue("firmware")
        assertEquals("2026.20.1", present.label)
        assertEquals(GaugeChipGlyph.Cpu, present.glyph)
        assertEquals(GaugeAccent.Power, present.accent)

        val blank = chipsByKey(project(state(softwareVersion = "  "))).getValue("firmware")
        assertEquals(strings.unknown, blank.label)
    }

    // ── Car visualization (web `<TeslaCarViz>`) ──────────────────────────────────────────────────────

    @Test
    fun carVizMirrorsStateAndShowsSpeedOnlyWhileDriving() {
        val idle = project(state(speed = 0.0)).carViz
        assertNull(idle.speedText)
        assertEquals("Model 3", idle.model)
        assertEquals(72.0, idle.batteryLevelPct, EPSILON)

        val driving = project(state(speed = 30.0)).carViz
        assertNotNull(driving.speedText)
    }

    // ── Accessible summary (a11y label presence) ─────────────────────────────────────────────────────

    @Test
    fun accessibleSummaryNamesEveryVisibleCueAndChip() {
        val summary = project(state(isLocked = true, sentryMode = false, isClimateOn = false)).accessibleSummary
        assertTrue(summary.contains(strings.battery))
        assertTrue(summary.contains("72%"))
        assertTrue(summary.contains(strings.estimatedRange))
        assertTrue(summary.contains(strings.locked))
        assertTrue(summary.contains(strings.sentryOff))
        assertTrue(summary.contains(strings.climateOff))
    }

    @Test
    fun accessibleSummaryAddsSpeedDrivingAndChargingCues() {
        val driving = project(state(speed = 30.0)).accessibleSummary
        assertTrue(driving.contains(strings.speed))

        val charging = project(state(isCharging = true, chargerPower = 48.4, chargeRate = 48_000.0)).accessibleSummary
        assertTrue(charging.contains(strings.power))
        assertTrue(charging.contains(strings.chargeRate))
    }

    @Test
    fun everyGaugeBarAndChipCarriesANonBlankLabel() {
        val display = project(state(isCharging = true, chargeRate = 48_000.0))
        assertTrue(display.gauges.all { it.label.isNotBlank() })
        assertTrue(display.bars.all { it.label.isNotBlank() })
        assertTrue(display.chips.all { it.label.isNotBlank() })
    }

    // ── Lifecycle surface classifier (per-state) ─────────────────────────────────────────────────────

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(VehicleGaugesSurface.Loading, vehicleGaugesSurface(UiState.loading<VehicleGaugesData>()))
        assertEquals(
            VehicleGaugesSurface.Error,
            vehicleGaugesSurface(UiState<VehicleGaugesData>(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(
            VehicleGaugesSurface.Empty,
            vehicleGaugesSurface(UiState(UiPhase.Empty, data = VehicleGaugesData(null, null))),
        )
        assertEquals(
            VehicleGaugesSurface.Content,
            vehicleGaugesSurface(UiState(UiPhase.Content, data = VehicleGaugesData(vehicle, state()))),
        )
    }

    @Test
    fun stateBuilderRequiresBothVehicleAndStateForContent() {
        assertEquals(UiPhase.Loading, vehicleGaugesStateOf(null, loading = true).phase)
        assertEquals(UiPhase.Empty, vehicleGaugesStateOf(null, loading = false).phase)
        assertEquals(
            UiPhase.Empty,
            vehicleGaugesStateOf(VehicleGaugesData(vehicle, null), loading = false).phase,
        )
        val error = vehicleGaugesStateOf(null, loading = false, isError = true)
        assertEquals(UiPhase.Error, error.phase)
        assertEquals(ErrorKind.Unknown, error.errorKind)
        val content = vehicleGaugesStateOf(VehicleGaugesData(vehicle, state()), loading = false)
        assertEquals(UiPhase.Content, content.phase)
        assertFalse(content.stale)
    }

    @Test
    fun stateBuilderKeepsCachedContentVisibleWhileStaleRefreshingOrErrored() {
        val refreshing = vehicleGaugesStateOf(VehicleGaugesData(vehicle, state()), loading = true)
        assertEquals(UiPhase.Content, refreshing.phase)
        assertTrue(refreshing.refreshing)

        val offline =
            vehicleGaugesStateOf(VehicleGaugesData(vehicle, state()), loading = false, isError = true)
        assertEquals(UiPhase.Content, offline.phase)
        assertTrue(offline.stale)
        assertEquals(ErrorKind.Unknown, offline.errorKind)
    }

    // ── Diagnostics (P1/S11 `view.opened`) + registry ────────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordVehicleGaugesOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "VehicleGauges"), record.fields)
    }

    @Test
    fun registrationSlugMatchesTheSurfaceContract() {
        assertEquals("VehicleGauges", VehicleGaugesRegistration.SLUG)
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertion. */
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

    private companion object {
        private const val EPSILON = 0.001
    }
}
