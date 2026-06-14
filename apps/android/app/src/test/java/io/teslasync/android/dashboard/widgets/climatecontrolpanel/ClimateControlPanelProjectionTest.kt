package io.teslasync.android.dashboard.widgets.climatecontrolpanel

import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * JVM unit tests for the framework-free Climate Control Panel surface logic: the climate-snapshot → display
 * projection (the "data adapter"), the SI→display temperature boundary (Celsius + Fahrenheit), the
 * null/`Off`/`> 0`/non-number field guards reproduced from the web source, the HVAC on/off + power rules,
 * the seat-heater rows, the fan-speed / steering-wheel level formatting, the Defrost/Bat-Heater chip rules,
 * the empty-snapshot predicate, the active-vehicle resolution, and the registry footprint constraints.
 * These run in the `:android:testReleaseUnitTest` gate with no device.
 */
class ClimateControlPanelProjectionTest {
    private val celsius = UnitFormatter.default()
    private val fahrenheit = UnitFormatter(UnitPreferences.fromSettings(buildJsonObject { put("unit_of_temp", "F") }))

    private fun strings(): ClimateControlPanelStrings =
        ClimateControlPanelStrings(
            title = "Climate Control",
            noData = "No climate data",
            hvacOn = "HVAC On",
            hvacOff = "HVAC Off",
            cabin = "Cabin",
            outside = "Outside",
            fanSpeed = "Fan Speed",
            steeringHeat = "Wheel Heat",
            off = "Off",
            seatFL = "FL",
            seatFR = "FR",
            seatRL = "RL",
            seatRC = "RC",
            seatRR = "RR",
            noSeatHeat = "No seat heaters active",
            defrost = "Defrost",
            batHeater = "Bat Heater",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading...",
            offlineLabel = "Offline",
            loadingLabel = "Loading",
            formatRelative = { "" },
        )

    // ── empty / no-snapshot ─────────────────────────────────────────────────────
    @Test
    fun nullSnapshotIsEmpty() {
        val display = ClimateControlPanelProjection.project(null, strings(), celsius)
        assertFalse(display.hasData)
        assertEquals(EM_DASH, display.cabinTempText)
        assertEquals(EM_DASH, display.outsideTempText)
        assertNull(display.hvacPowerText)
        assertTrue(display.seatHeaters.isEmpty())
        assertTrue(display.chips.isEmpty())
    }

    @Test
    fun jsonNullSnapshotIsEmpty() {
        assertFalse(ClimateControlPanelProjection.project(JsonNull, strings(), celsius).hasData)
        assertTrue(ClimateControlPanelProjection.isEmptySnapshot(JsonNull))
    }

    @Test
    fun nonObjectSnapshotIsEmpty() {
        assertTrue(ClimateControlPanelProjection.isEmptySnapshot(JsonPrimitive(5)))
        assertTrue(ClimateControlPanelProjection.isEmptySnapshot(null))
    }

    @Test
    fun objectSnapshotIsNotEmpty() {
        assertFalse(ClimateControlPanelProjection.isEmptySnapshot(buildJsonObject { put("inside_temp", 1.0) }))
    }

    // ── temperatures ────────────────────────────────────────────────────────────
    @Test
    fun projectsCelsiusReadings() {
        val snapshot =
            buildJsonObject {
                put("inside_temp", 21.0)
                put("outside_temp", 14.0)
            }
        val display = ClimateControlPanelProjection.project(snapshot, strings(), celsius)
        assertTrue(display.hasData)
        assertEquals("21\u00B0C", display.cabinTempText)
        assertEquals("14\u00B0C", display.outsideTempText)
    }

    @Test
    fun convertsTemperatureToFahrenheitAtDisplayBoundary() {
        val snapshot = buildJsonObject { put("inside_temp", 20.0) }
        // 20°C → 68°F, rendered as a whole degree (web fmtInt).
        assertEquals("68\u00B0F", ClimateControlPanelProjection.project(snapshot, strings(), fahrenheit).cabinTempText)
    }

    @Test
    fun missingTemperaturesRenderEmDash() {
        val snapshot = buildJsonObject { put("vehicle_id", 1) }
        val display = ClimateControlPanelProjection.project(snapshot, strings(), celsius)
        assertEquals(EM_DASH, display.cabinTempText)
        assertEquals(EM_DASH, display.outsideTempText)
    }

    // ── HVAC status / power ──────────────────────────────────────────────────────
    @Test
    fun hvacOnWhenPowerPositive() {
        val snapshot = buildJsonObject { put("hvac_power", 2.4) }
        val display = ClimateControlPanelProjection.project(snapshot, strings(), celsius)
        assertTrue(display.hvacOn)
        assertEquals("HVAC On", display.hvacStatusText)
        assertEquals("2.4 kW", display.hvacPowerText)
    }

    @Test
    fun hvacOnWhenAcEnabledEvenWithoutPower() {
        val snapshot = buildJsonObject { put("hvac_ac_enabled", true) }
        val display = ClimateControlPanelProjection.project(snapshot, strings(), celsius)
        assertTrue(display.hvacOn)
        assertEquals("HVAC On", display.hvacStatusText)
        // No power reading → no kW text (web hides it unless hvac_power > 0).
        assertNull(display.hvacPowerText)
    }

    @Test
    fun hvacOffWhenNoPowerAndAcDisabled() {
        val snapshot =
            buildJsonObject {
                put("hvac_power", 0.0)
                put("hvac_ac_enabled", false)
            }
        val display = ClimateControlPanelProjection.project(snapshot, strings(), celsius)
        assertFalse(display.hvacOn)
        assertEquals("HVAC Off", display.hvacStatusText)
        assertNull(display.hvacPowerText)
    }

    @Test
    fun isHvacOnHelperMatchesWebRule() {
        assertTrue(ClimateControlPanelProjection.isHvacOn(1.0, false))
        assertTrue(ClimateControlPanelProjection.isHvacOn(null, true))
        assertFalse(ClimateControlPanelProjection.isHvacOn(0.0, false))
        assertFalse(ClimateControlPanelProjection.isHvacOn(null, false))
    }

    // ── fan speed / steering wheel ───────────────────────────────────────────────
    @Test
    fun fanSpeedRendersPlainNumberOrEmDash() {
        val present = buildJsonObject { put("hvac_fan_speed", 4) }
        assertEquals("4", ClimateControlPanelProjection.project(present, strings(), celsius).fanSpeedText)
        val absent = buildJsonObject { put("vehicle_id", 1) }
        assertEquals(EM_DASH, ClimateControlPanelProjection.project(absent, strings(), celsius).fanSpeedText)
    }

    @Test
    fun steeringWheelHeatRendersLevelOrOff() {
        val on = buildJsonObject { put("hvac_steering_wheel_heat_level", 2) }
        assertEquals("2/3", ClimateControlPanelProjection.project(on, strings(), celsius).wheelHeatText)
        val zero = buildJsonObject { put("hvac_steering_wheel_heat_level", 0) }
        assertEquals("Off", ClimateControlPanelProjection.project(zero, strings(), celsius).wheelHeatText)
        val absent = buildJsonObject { put("vehicle_id", 1) }
        assertEquals("Off", ClimateControlPanelProjection.project(absent, strings(), celsius).wheelHeatText)
    }

    // ── seat heaters ─────────────────────────────────────────────────────────────
    @Test
    fun seatHeatersIncludeOnlyActiveSeatsInOrder() {
        val snapshot =
            buildJsonObject {
                put("seat_heater_left", 3)
                put("seat_heater_right", 0)
                put("seat_heater_rear_left", 1)
                put("seat_heater_rear_center", 2)
                put("seat_heater_rear_right", 0)
            }
        val seats = ClimateControlPanelProjection.project(snapshot, strings(), celsius).seatHeaters
        assertEquals(
            listOf(
                SeatHeaterChip("FL", "3/3"),
                SeatHeaterChip("RL", "1/3"),
                SeatHeaterChip("RC", "2/3"),
            ),
            seats,
        )
    }

    @Test
    fun noSeatHeatersWhenAllZeroOrAbsent() {
        val snapshot =
            buildJsonObject {
                put("seat_heater_left", 0)
                put("seat_heater_right", 0)
            }
        val display = ClimateControlPanelProjection.project(snapshot, strings(), celsius)
        assertTrue(display.seatHeaters.isEmpty())
        assertFalse(display.hasSeatHeaters)
    }

    // ── status chips ─────────────────────────────────────────────────────────────
    @Test
    fun bothChipsWhenDefrostActiveAndBatteryHeaterOn() {
        val snapshot =
            buildJsonObject {
                put("defrost_mode", "Front")
                put("battery_heater_on", true)
            }
        assertEquals(
            listOf(ClimateChipKind.Defrost, ClimateChipKind.BatHeater),
            ClimateControlPanelProjection.project(snapshot, strings(), celsius).chips,
        )
    }

    @Test
    fun defrostOffHidesDefrostChip() {
        assertFalse(ClimateControlPanelProjection.showsDefrost("Off"))
        assertFalse(ClimateControlPanelProjection.showsDefrost(""))
        assertFalse(ClimateControlPanelProjection.showsDefrost(null))
        assertTrue(ClimateControlPanelProjection.showsDefrost("Front"))
    }

    @Test
    fun onlyBatHeaterChipWhenDefrostOff() {
        val snapshot =
            buildJsonObject {
                put("defrost_mode", "Off")
                put("battery_heater_on", true)
            }
        assertEquals(listOf(ClimateChipKind.BatHeater), ClimateControlPanelProjection.project(snapshot, strings(), celsius).chips)
    }

    @Test
    fun onlyDefrostChipWhenBatteryHeaterOff() {
        val snapshot =
            buildJsonObject {
                put("defrost_mode", "Rear")
                put("battery_heater_on", false)
            }
        assertEquals(listOf(ClimateChipKind.Defrost), ClimateControlPanelProjection.project(snapshot, strings(), celsius).chips)
    }

    // ── registry / footprint ─────────────────────────────────────────────────────
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("climate-control-panel", ClimateControlPanelRegistration.ID)
        assertEquals("climate", ClimateControlPanelRegistration.CATEGORY)
        assertEquals("ClimateControlPanelWidget", ClimateControlPanelRegistration.SLUG)
        assertEquals(ClimateControlPanelSize(2, 4), ClimateControlPanelRegistration.DEFAULT_SIZE)
        assertEquals(ClimateControlPanelSize(1, 2), ClimateControlPanelRegistration.MIN_SIZE)
        assertEquals(ClimateControlPanelSize(4, 40), ClimateControlPanelRegistration.MAX_SIZE)
    }

    @Test
    fun footprintBoundsAndClamp() {
        assertTrue(ClimateControlPanelRegistration.isWithinBounds(ClimateControlPanelSize(1, 2)))
        assertTrue(ClimateControlPanelRegistration.isWithinBounds(ClimateControlPanelSize(4, 40)))
        assertFalse(ClimateControlPanelRegistration.isWithinBounds(ClimateControlPanelSize(5, 4)))
        assertFalse(ClimateControlPanelRegistration.isWithinBounds(ClimateControlPanelSize(1, 1)))
        assertEquals(ClimateControlPanelSize(4, 40), ClimateControlPanelRegistration.clamp(ClimateControlPanelSize(9, 99)))
        assertEquals(ClimateControlPanelSize(1, 2), ClimateControlPanelRegistration.clamp(ClimateControlPanelSize(0, 0)))
    }

    @Test
    fun compactFootprintOnlyAtOneByOne() {
        assertTrue(ClimateControlPanelSize(1, 1).isCompact)
        assertFalse(ClimateControlPanelSize(2, 4).isCompact)
        assertFalse(ClimateControlPanelSize(1, 2).isCompact)
    }

    // ── active-vehicle resolution ────────────────────────────────────────────────
    @Test
    fun resolvesPreferredThenFirstThenNull() {
        assertEquals(7L, resolveVehicleId(7L, listOf(vehicle(3))))
        assertEquals(3L, resolveVehicleId(null, listOf(vehicle(3), vehicle(4))))
        assertEquals(3L, resolveVehicleId(0L, listOf(vehicle(3))))
        assertNull(resolveVehicleId(null, emptyList()))
        assertNull(resolveVehicleId(null, null))
    }

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )
}
