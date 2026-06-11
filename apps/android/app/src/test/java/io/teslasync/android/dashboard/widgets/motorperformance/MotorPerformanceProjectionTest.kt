package io.teslasync.android.dashboard.widgets.motorperformance

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the MotorPerformanceWidget's pure logic — the web `di_torque ?? 0` /
 * `di_stator_temp ?? motor_temp_c_front` / `gear ?? shift_state ?? '—'` field reads, the `torqueColor`
 * band thresholds, the SI→display stator-temperature conversion, the g-force formatting, the
 * cache-then-network parse, and the registry/footprint metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/MotorPerformanceWidget.tsx).
 */
class MotorPerformanceProjectionTest {
    private val strings =
        MotorPerformanceStrings(
            title = "Motor Performance",
            gear = "Gear",
            torque = "Torque",
            nm = "Nm",
            statorTemp = "Stator Temp",
            gearState = "Gear State",
            lateralG = "Lateral G",
            longitudinalG = "Longitudinal G",
            noData = "No motor data",
        )

    private fun prefs(temperature: TemperatureUnitPref = TemperatureUnitPref.CELSIUS): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = temperature,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
        )

    private fun motor(): JsonElement =
        buildJsonObject {
            put("di_torque", 342.0)
            put("di_stator_temp", 64.0)
            put("gear", "D")
            put("lateral_accel", 0.18)
            put("longitudinal_accel", 0.42)
        }

    private fun project(
        snapshot: MotorSnapshot,
        prefs: UnitPref = prefs(),
    ): MotorPerformanceDisplay = MotorPerformanceProjection.project(snapshot, prefs, strings)

    @Test
    fun fromJsonReturnsNullForNonObjectBody() {
        // /motor/latest returns `MotorSnapshot | null`; a JSON null (or non-object) ⇒ the empty state.
        assertNull(MotorSnapshot.fromJson(JsonNull))
        assertNull(MotorSnapshot.fromJson(JsonPrimitive(5)))
        assertNull(MotorSnapshot.fromJson(null))
    }

    @Test
    fun fromJsonDecodesEveryRenderedField() {
        val snapshot = requireNotNull(MotorSnapshot.fromJson(motor()))
        assertEquals(342.0, snapshot.torque)
        assertEquals(64.0, snapshot.statorTempC)
        assertEquals("D", snapshot.gear)
        assertEquals(0.18, snapshot.lateralG)
        assertEquals(0.42, snapshot.longitudinalG)
    }

    @Test
    fun fromJsonAppliesWebFallbackChains() {
        // di_stator_temp absent ⇒ motor_temp_c_front; gear absent ⇒ shift_state.
        val snapshot =
            requireNotNull(
                MotorSnapshot.fromJson(
                    buildJsonObject {
                        put("motor_temp_c_front", 48.0)
                        put("shift_state", "R")
                    },
                ),
            )
        assertEquals(48.0, snapshot.statorTempC)
        assertEquals("R", snapshot.gear)
        assertNull(snapshot.torque)
        assertNull(snapshot.lateralG)
    }

    @Test
    fun fromJsonKeepsEmptyObjectAsPresentSnapshot() {
        // A present-but-empty object is still "has data" in the web (`!!data`); fields fall back at render.
        val snapshot = requireNotNull(MotorSnapshot.fromJson(buildJsonObject {}))
        assertNull(snapshot.torque)
        assertNull(snapshot.gear)
    }

    @Test
    fun projectRendersGaugeAndStatsInWebOrder() {
        val display = project(requireNotNull(MotorSnapshot.fromJson(motor())))
        assertEquals(342.0, display.gaugeValue, 0.0)
        assertEquals("342", display.torqueText)
        assertEquals("D", display.gearText)
        assertEquals(TorqueBand.Medium, display.band)
        assertEquals(MotorStat("Stator Temp", "64", "\u00B0C"), display.stats[0])
        assertEquals(MotorStat("Gear State", "D", null), display.stats[1])
        assertEquals(MotorStat("Lateral G", "0.18", "g"), display.stats[2])
        assertEquals(MotorStat("Longitudinal G", "0.42", "g"), display.stats[3])
    }

    @Test
    fun projectDefaultsTorqueToZeroAndGearToEmDash() {
        val display = project(MotorSnapshot(torque = null, statorTempC = null, gear = null, lateralG = null, longitudinalG = null))
        assertEquals(0.0, display.gaugeValue, 0.0)
        assertEquals("0", display.torqueText)
        assertEquals(EM_DASH, display.gearText)
        assertEquals(TorqueBand.Low, display.band)
    }

    @Test
    fun projectAbsoluteValueDrivesGaugeForRegenTorque() {
        // web `value={Math.abs(torque)}` + `torqueColor(Math.abs(torque))`; the label keeps the sign.
        val display = project(MotorSnapshot(torque = -450.0, statorTempC = null, gear = "R", lateralG = null, longitudinalG = null))
        assertEquals(450.0, display.gaugeValue, 0.0)
        assertEquals("-450", display.torqueText)
        assertEquals(TorqueBand.High, display.band)
    }

    @Test
    fun projectEmDashesAbsentStatorTempAndGForces() {
        val display = project(MotorSnapshot(torque = 10.0, statorTempC = null, gear = "P", lateralG = null, longitudinalG = null))
        assertEquals(MotorStat("Stator Temp", EM_DASH, null), display.stats[0])
        assertEquals(MotorStat("Lateral G", EM_DASH, null), display.stats[2])
        assertEquals(MotorStat("Longitudinal G", EM_DASH, null), display.stats[3])
    }

    @Test
    fun projectConvertsStatorTempToFahrenheitAtRenderBoundary() {
        val display = project(requireNotNull(MotorSnapshot.fromJson(motor())), prefs(TemperatureUnitPref.FAHRENHEIT))
        // 64°C → 147.2°F → fmtNumber(_, 0) → "147".
        assertEquals(MotorStat("Stator Temp", "147", "\u00B0F"), display.stats[0])
    }

    @Test
    fun bandThresholdsMirrorWebTorqueColor() {
        assertEquals(TorqueBand.Low, MotorPerformanceProjection.bandFor(0.0))
        assertEquals(TorqueBand.Low, MotorPerformanceProjection.bandFor(199.9))
        assertEquals(TorqueBand.Medium, MotorPerformanceProjection.bandFor(200.0))
        assertEquals(TorqueBand.Medium, MotorPerformanceProjection.bandFor(399.9))
        assertEquals(TorqueBand.High, MotorPerformanceProjection.bandFor(400.0))
        assertEquals(TorqueBand.High, MotorPerformanceProjection.bandFor(600.0))
    }

    @Test
    fun formattersReproduceWebEnUsHalfExpandContract() {
        assertEquals("1,234.50", MotorPerformanceProjection.formatNumber(1234.5, decimals = 2))
        assertEquals("1,235", MotorPerformanceProjection.formatInt(1234.5))
        assertEquals("-120", MotorPerformanceProjection.formatInt(-120.0))
    }

    @Test
    fun toMotorSnapshotPreservesFreshnessAcrossResourceVariants() {
        val success = Resource.Success<JsonElement>(motor(), fetchedAt = 100L, stale = false).toMotorSnapshot()
        assertTrue(success is Resource.Success)
        assertEquals("D", (success as Resource.Success).data?.gear)

        val loading = Resource.Loading<JsonElement>(cached = motor(), fetchedAt = 90L, stale = true).toMotorSnapshot()
        assertTrue(loading is Resource.Loading)
        assertEquals(342.0, (loading as Resource.Loading).cached?.torque)
        assertTrue(loading.stale)

        val error =
            Resource
                .Error<JsonElement>(cached = motor(), fetchedAt = 80L, stale = true, error = ApiError.Timeout())
                .toMotorSnapshot()
        assertTrue(error is Resource.Error)
        assertEquals("D", (error as Resource.Error).cached?.gear)
    }

    @Test
    fun emptyMotorSnapshotResolvesToEmptyPhase() {
        // The view-model marks a `null` snapshot as empty (web `hasData = !!data`).
        val state = Resource.Success<MotorSnapshot?>(data = null, fetchedAt = 100L, stale = false).toUiState { it == null }
        assertEquals(UiPhase.Empty, state.phase)
    }

    @Test
    fun cachedErrorResolvesToOfflineContent() {
        val state =
            Resource
                .Error<MotorSnapshot?>(
                    cached = MotorSnapshot(torque = 10.0, statorTempC = null, gear = "D", lateralG = null, longitudinalG = null),
                    fetchedAt = 100L,
                    stale = true,
                    error = ApiError.Network(),
                ).toUiState { it == null }
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.isOffline)
        assertEquals(ErrorKind.Network, state.errorKind)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("motor-performance", MotorPerformanceRegistration.ID)
        assertEquals("vehicle", MotorPerformanceRegistration.CATEGORY)
        assertEquals("MotorPerformanceWidget", MotorPerformanceRegistration.SLUG)
        assertEquals(MotorPerformanceSize(cols = 2, rows = 4), MotorPerformanceRegistration.defaultSize)
        assertEquals(MotorPerformanceSize(cols = 1, rows = 2), MotorPerformanceRegistration.minSize)
        assertEquals(MotorPerformanceSize(cols = 4, rows = 40), MotorPerformanceRegistration.maxSize)
    }

    @Test
    fun registrationClampsBoundsAndDetectsCompact() {
        assertEquals(MotorPerformanceSize(4, 40), MotorPerformanceRegistration.clamp(MotorPerformanceSize(9, 99)))
        assertEquals(MotorPerformanceSize(1, 2), MotorPerformanceRegistration.clamp(MotorPerformanceSize(0, 0)))
        assertTrue(MotorPerformanceRegistration.withinBounds(MotorPerformanceSize(2, 4)))
        assertFalse(MotorPerformanceRegistration.withinBounds(MotorPerformanceSize(5, 4)))
        assertTrue(MotorPerformanceRegistration.isCompact(MotorPerformanceSize(1, 2)))
        assertFalse(MotorPerformanceRegistration.isCompact(MotorPerformanceSize(2, 4)))
    }
}
