package io.teslasync.android.dashboard.widgets.climatestatus

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
 * JVM unit tests for the framework-free Climate Status surface logic: the climate-snapshot → display
 * projection (the "data adapter"), the SI→display temperature boundary (Celsius + Fahrenheit), the
 * null/`Off`/non-number field guards reproduced from the web source, the Defrost/Heater chip rules, the
 * empty-snapshot predicate, the active-vehicle resolution, and the registry footprint constraints. These
 * run in the `:android:testReleaseUnitTest` gate with no device.
 */
class ClimateStatusProjectionTest {
    private val celsius = UnitFormatter.default()
    private val fahrenheit = UnitFormatter(UnitPreferences.fromSettings(buildJsonObject { put("unit_of_temp", "F") }))

    // ── empty / no-snapshot ─────────────────────────────────────────────────────
    @Test
    fun nullSnapshotIsEmpty() {
        val display = ClimateStatusProjection.project(null, celsius)
        assertFalse(display.hasData)
        assertEquals(EM_DASH, display.cabinTempText)
        assertEquals(EM_DASH, display.outsideTempText)
        assertEquals(EM_DASH, display.hvacPowerText)
        assertTrue(display.chips.isEmpty())
    }

    @Test
    fun jsonNullSnapshotIsEmpty() {
        assertFalse(ClimateStatusProjection.project(JsonNull, celsius).hasData)
        assertTrue(ClimateStatusProjection.isEmptySnapshot(JsonNull))
    }

    @Test
    fun nonObjectSnapshotIsEmpty() {
        assertTrue(ClimateStatusProjection.isEmptySnapshot(JsonPrimitive(5)))
        assertTrue(ClimateStatusProjection.isEmptySnapshot(null))
    }

    @Test
    fun objectSnapshotIsNotEmpty() {
        assertFalse(ClimateStatusProjection.isEmptySnapshot(buildJsonObject { put("inside_temp", 1.0) }))
    }

    // ── content / formatting ────────────────────────────────────────────────────
    @Test
    fun projectsCelsiusReadingsAndBothChips() {
        val snapshot =
            buildJsonObject {
                put("inside_temp", 21.0)
                put("outside_temp", 14.0)
                put("hvac_power", 2.4)
                put("defrost_mode", "Front")
                put("battery_heater_on", true)
            }
        val display = ClimateStatusProjection.project(snapshot, celsius)

        assertTrue(display.hasData)
        assertEquals("21\u00B0C", display.cabinTempText)
        assertEquals("14\u00B0C", display.outsideTempText)
        assertEquals("2.4 kW", display.hvacPowerText)
        assertEquals(listOf(ClimateChipKind.Defrost, ClimateChipKind.Heater), display.chips)
    }

    @Test
    fun convertsTemperatureToFahrenheitAtDisplayBoundary() {
        val snapshot = buildJsonObject { put("inside_temp", 20.0) }
        val display = ClimateStatusProjection.project(snapshot, fahrenheit)
        // 20°C → 68°F, rendered as a whole degree (web fmtInt).
        assertEquals("68\u00B0F", display.cabinTempText)
    }

    @Test
    fun roundsTemperatureToWholeDegrees() {
        val snapshot = buildJsonObject { put("inside_temp", 21.6) }
        assertEquals("22\u00B0C", ClimateStatusProjection.project(snapshot, celsius).cabinTempText)
    }

    @Test
    fun missingReadingsRenderEmDashWithNoChips() {
        val snapshot =
            buildJsonObject {
                put("ts", "2026-06-06T12:00:00Z")
                put("vehicle_id", 1)
            }
        val display = ClimateStatusProjection.project(snapshot, celsius)

        assertTrue(display.hasData)
        assertEquals(EM_DASH, display.cabinTempText)
        assertEquals(EM_DASH, display.outsideTempText)
        assertEquals(EM_DASH, display.hvacPowerText)
        assertTrue(display.chips.isEmpty())
    }

    @Test
    fun nonNumericHvacPowerRendersEmDash() {
        // The backend can serialise hvac_power as a boolean; the typed contract is a number, so a
        // non-number reads as missing (em dash) rather than coercing.
        val snapshot = buildJsonObject { put("hvac_power", true) }
        assertEquals(EM_DASH, ClimateStatusProjection.project(snapshot, celsius).hvacPowerText)
    }

    @Test
    fun nullReadingsRenderEmDash() {
        val snapshot =
            buildJsonObject {
                put("inside_temp", JsonNull)
                put("hvac_power", JsonNull)
            }
        val display = ClimateStatusProjection.project(snapshot, celsius)
        assertEquals(EM_DASH, display.cabinTempText)
        assertEquals(EM_DASH, display.hvacPowerText)
    }

    // ── chip rules ──────────────────────────────────────────────────────────────
    @Test
    fun defrostOffHidesChip() {
        assertFalse(ClimateStatusProjection.showsDefrost("Off"))
        assertFalse(ClimateStatusProjection.showsDefrost(""))
        assertFalse(ClimateStatusProjection.showsDefrost(null))
        assertTrue(ClimateStatusProjection.showsDefrost("Front"))
    }

    @Test
    fun onlyHeaterChipWhenDefrostOff() {
        val snapshot =
            buildJsonObject {
                put("defrost_mode", "Off")
                put("battery_heater_on", true)
            }
        assertEquals(listOf(ClimateChipKind.Heater), ClimateStatusProjection.project(snapshot, celsius).chips)
    }

    @Test
    fun onlyDefrostChipWhenHeaterOff() {
        val snapshot =
            buildJsonObject {
                put("defrost_mode", "Rear")
                put("battery_heater_on", false)
            }
        assertEquals(listOf(ClimateChipKind.Defrost), ClimateStatusProjection.project(snapshot, celsius).chips)
    }

    // ── registry / footprint ─────────────────────────────────────────────────────
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("climate-status", ClimateStatusRegistration.ID)
        assertEquals("climate", ClimateStatusRegistration.CATEGORY)
        assertEquals("ClimateStatusWidget", ClimateStatusRegistration.SLUG)
        assertEquals(ClimateStatusSize(1, 2), ClimateStatusRegistration.DEFAULT_SIZE)
        assertEquals(ClimateStatusSize(1, 2), ClimateStatusRegistration.MIN_SIZE)
        assertEquals(ClimateStatusSize(2, 40), ClimateStatusRegistration.MAX_SIZE)
    }

    @Test
    fun footprintBoundsAndClamp() {
        assertTrue(ClimateStatusRegistration.isWithinBounds(ClimateStatusSize(1, 2)))
        assertTrue(ClimateStatusRegistration.isWithinBounds(ClimateStatusSize(2, 40)))
        assertFalse(ClimateStatusRegistration.isWithinBounds(ClimateStatusSize(3, 2)))
        assertFalse(ClimateStatusRegistration.isWithinBounds(ClimateStatusSize(1, 1)))
        assertEquals(ClimateStatusSize(2, 40), ClimateStatusRegistration.clamp(ClimateStatusSize(9, 99)))
        assertEquals(ClimateStatusSize(1, 2), ClimateStatusRegistration.clamp(ClimateStatusSize(0, 0)))
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
