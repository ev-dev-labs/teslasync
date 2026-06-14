package io.teslasync.android.dashboard.widgets.digitaltwinmini

import io.teslasync.android.sharedsurfaces.vehicletwin.EMPTY_TWIN_STATE
import io.teslasync.android.sharedsurfaces.vehicletwin.PaintPaletteId
import io.teslasync.android.sharedsurfaces.vehicletwin.TurnSignalState
import io.teslasync.android.sharedsurfaces.vehicletwin.WindowState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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
 * Off-device verification of the pure Digital Twin Mini model — the data adapter (raw security / typed
 * state / charging snapshots → [io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinState]) ported
 * from the web `buildTwinState`, the two status-badge projections, the registry metadata, and the
 * active-vehicle resolution. No Compose / Android / coroutines — these run in the offline
 * `testReleaseUnitTest` gate.
 */
class DigitalTwinMiniProjectionTest {
    // ── buildVehicleTwinState (web buildTwinState) ──────────────────────────────────────────────────────

    @Test
    fun allSourcesAbsentYieldsNeutralSilhouette() {
        assertEquals(EMPTY_TWIN_STATE, buildVehicleTwinState(null, null, null))
        assertEquals(EMPTY_TWIN_STATE, buildVehicleTwinState(JsonNull, null, JsonNull))
    }

    @Test
    fun securityDrivesLockSentryAndOpenings() {
        val security =
            buildJsonObject {
                put("locked", false)
                put("sentry_mode", true)
                put("door_state", "OpenDriverFront")
                put("fd_window", "Open")
                put("lights_high_beams", true)
                put("lights_turn_signal", "TurnSignalLeft")
                put("driver_seat_occupied", true)
            }
        val twin = buildVehicleTwinState(security, null, null)

        assertEquals(false, twin.locked)
        assertEquals(true, twin.sentryMode)
        assertEquals(true, twin.doors.driverFront)
        assertEquals(WindowState.Open, twin.windowFD)
        assertEquals(true, twin.headlights)
        assertEquals(TurnSignalState.Left, twin.turnSignal)
        assertEquals(true, twin.driverSeatOccupied)
    }

    @Test
    fun vehicleStateBacksLockAndSentryWhenSecurityAbsent() {
        val twin = buildVehicleTwinState(null, vehicleState(isLocked = true, sentryMode = true), null)
        assertEquals(true, twin.locked)
        assertEquals(true, twin.sentryMode)
    }

    @Test
    fun securityLockOverridesVehicleStateLock() {
        val security = buildJsonObject { put("locked", false) }
        val twin = buildVehicleTwinState(security, vehicleState(isLocked = true), null)
        // web `security?.locked ?? vehicleState?.is_locked` — a present (even false) security value wins.
        assertEquals(false, twin.locked)
    }

    @Test
    fun chargingActiveFromTelemetryPowerOpensChargePort() {
        val charging = buildJsonObject { put("charger_power_kw", 11.0) }
        val twin = buildVehicleTwinState(null, null, charging)
        assertTrue(twin.isCharging)
        assertEquals(true, twin.chargePortOpen)
    }

    @Test
    fun explicitChargePortFalseSurvivesActiveCharging() {
        val charging =
            buildJsonObject {
                put("charging_state", "Charging")
                put("charge_port_door_open", false)
            }
        val twin = buildVehicleTwinState(null, null, charging)
        assertTrue(twin.isCharging)
        // web `charging?.charge_port_door_open ?? (active ? true : null)` — a present false is kept.
        assertEquals(false, twin.chargePortOpen)
    }

    @Test
    fun chargingActiveFromVehicleStateFlag() {
        val twin = buildVehicleTwinState(null, vehicleState(isCharging = true), null)
        assertTrue(twin.isCharging)
    }

    @Test
    fun drivingDetectedByStateOrSpeed() {
        assertTrue(buildVehicleTwinState(null, vehicleState(state = "driving"), null).isDriving)
        assertTrue(buildVehicleTwinState(null, vehicleState(speed = 12.0), null).isDriving)
        assertFalse(buildVehicleTwinState(null, vehicleState(state = "online", speed = 0.0), null).isDriving)
    }

    @Test
    fun frunkAndTrunkMirrorTheTrunkDoors() {
        val security = buildJsonObject { put("door_state", "FrontTrunkOpen") }
        val twin = buildVehicleTwinState(security, null, null)
        assertEquals(true, twin.doors.trunkFront)
        assertEquals(twin.doors.trunkFront, twin.frunkOpen)
        assertEquals(twin.doors.trunkRear, twin.trunkOpen)
    }

    @Test
    fun windowFallsBackToCompoundSummary() {
        val security = buildJsonObject { put("windows_open", "driver front") }
        val twin = buildVehicleTwinState(security, null, null)
        // No fd_window field → the compound `windows_open` summary alias drives the corner.
        assertEquals(WindowState.Open, twin.windowFD)
    }

    // ── parse helpers ───────────────────────────────────────────────────────────────────────────────────

    @Test
    fun parseDoorStateClosedShorthandClosesPassengerCorners() {
        val doors = parseDoorState(JsonPrimitive("ClosedAll"))
        assertEquals(false, doors.driverFront)
        assertEquals(false, doors.passengerRear)
        assertNull(doors.trunkFront)
    }

    @Test
    fun parseDoorStateAcceptsObjectPayload() {
        val doors =
            parseDoorState(
                buildJsonObject {
                    put("DriverFront", true)
                    put("passenger_rear", false)
                },
            )
        assertEquals(true, doors.driverFront)
        assertEquals(false, doors.passengerRear)
        assertNull(doors.driverRear)
    }

    @Test
    fun parseWindowStateClassifiesTokens() {
        assertEquals(WindowState.Closed, parseWindowState(JsonPrimitive("WindowStateClosed")))
        assertEquals(WindowState.Partial, parseWindowState(JsonPrimitive("PartiallyOpen")))
        assertEquals(WindowState.Open, parseWindowState(JsonPrimitive("Open")))
        assertEquals(WindowState.Unknown, parseWindowState(JsonPrimitive(true)))
        assertEquals(WindowState.Unknown, parseWindowState(null))
    }

    @Test
    fun parseTurnSignalStripsTokenAndClassifies() {
        assertEquals(TurnSignalState.Both, parseTurnSignal(JsonPrimitive("TurnSignalBoth")))
        assertEquals(TurnSignalState.Right, parseTurnSignal(JsonPrimitive("Right")))
        assertEquals(TurnSignalState.Off, parseTurnSignal(JsonPrimitive("TurnSignalOff")))
        assertEquals(TurnSignalState.Unknown, parseTurnSignal(null))
    }

    @Test
    fun strictBoolRejectsNonBooleanJson() {
        assertEquals(true, strictBool(JsonPrimitive(true)))
        assertNull(strictBool(JsonPrimitive("true")))
        assertNull(strictBool(JsonPrimitive(1)))
        assertNull(strictBool(null))
    }

    // ── projection (badges + paint + a11y) ──────────────────────────────────────────────────────────────

    @Test
    fun unlockedProjectsDangerBadgeWithUnlockGlyph() {
        val security =
            buildJsonObject {
                put("locked", false)
                put("sentry_mode", false)
            }
        val display = DigitalTwinMiniProjection.project(data(security = security), STRINGS)

        assertEquals(BadgeTone.Danger, display.lockBadge.tone)
        assertEquals("Unlocked", display.lockBadge.text)
        assertTrue(display.lockBadge.unlocked)
        assertEquals(BadgeTone.Neutral, display.sentryBadge?.tone)
        assertEquals("Off", display.sentryBadge?.text)
    }

    @Test
    fun lockedProjectsSuccessBadgeAndArmedSentry() {
        val security =
            buildJsonObject {
                put("locked", true)
                put("sentry_mode", true)
            }
        val display = DigitalTwinMiniProjection.project(data(security = security), STRINGS)

        assertEquals(BadgeTone.Success, display.lockBadge.tone)
        assertEquals("Locked", display.lockBadge.text)
        assertFalse(display.lockBadge.unlocked)
        assertEquals(BadgeTone.Info, display.sentryBadge?.tone)
        assertEquals("Sentry", display.sentryBadge?.text)
    }

    @Test
    fun unknownLockShowsDashAndSuccessToneNoSentryBadge() {
        val display = DigitalTwinMiniProjection.project(data(security = null), STRINGS)
        assertEquals(BadgeTone.Success, display.lockBadge.tone)
        assertEquals("\u2014", display.lockBadge.text)
        assertNull(display.sentryBadge)
    }

    @Test
    fun paintResolvesFromVehicleExteriorColor() {
        val display = DigitalTwinMiniProjection.project(data(color = "DeepBlue"), STRINGS)
        assertEquals(PaintPaletteId.DeepBlue, display.paint.id)
    }

    // ── registration + footprint ──────────────────────────────────────────────────────────────────────

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("digital-twin-mini", DigitalTwinMiniRegistration.ID)
        assertEquals("vehicle", DigitalTwinMiniRegistration.CATEGORY)
        assertEquals("DigitalTwinMiniWidget", DigitalTwinMiniRegistration.SLUG)
        assertEquals(DigitalTwinMiniSize(2, 4), DigitalTwinMiniRegistration.DEFAULT_SIZE)
        assertEquals(DigitalTwinMiniSize(1, 4), DigitalTwinMiniRegistration.MIN_SIZE)
        assertEquals(DigitalTwinMiniSize(4, 40), DigitalTwinMiniRegistration.MAX_SIZE)
    }

    @Test
    fun clampHonoursMinMaxBounds() {
        assertEquals(DigitalTwinMiniSize(1, 4), DigitalTwinMiniRegistration.clamp(DigitalTwinMiniSize(0, 1)))
        assertEquals(DigitalTwinMiniSize(4, 40), DigitalTwinMiniRegistration.clamp(DigitalTwinMiniSize(9, 99)))
        assertTrue(DigitalTwinMiniRegistration.isWithinBounds(DigitalTwinMiniSize(2, 4)))
        assertFalse(DigitalTwinMiniRegistration.isWithinBounds(DigitalTwinMiniSize(9, 99)))
    }

    @Test
    fun badgeVisibilityFollowsFootprint() {
        assertTrue(DigitalTwinMiniSize(2, 4).showsBadges)
        assertTrue(DigitalTwinMiniSize(1, 4).showsBadges)
        assertFalse(DigitalTwinMiniSize(1, 1).showsBadges)
        assertTrue(DigitalTwinMiniSize(1, 1).isCompact)
    }

    // ── active-vehicle resolution ────────────────────────────────────────────────────────────────────

    @Test
    fun resolveVehiclePrefersConfiguredIdThenFirst() {
        val fleet = listOf(vehicle(5), vehicle(9))
        assertEquals(9L, resolveVehicle(fleet, 9)?.id)
        assertEquals(5L, resolveVehicle(fleet, 7)?.id)
        assertEquals(5L, resolveVehicle(fleet, null)?.id)
        assertNull(resolveVehicle(emptyList(), 5))
        assertNull(resolveVehicle(null, 5))
    }

    @Test
    fun emptyPredicateGatesOnVehicle() {
        assertTrue(isDigitalTwinMiniEmpty(DigitalTwinMiniData(null, null, null, null)))
        assertFalse(isDigitalTwinMiniEmpty(DigitalTwinMiniData(vehicle(5), null, null, null)))
    }

    private companion object {
        val STRINGS =
            DigitalTwinMiniStrings(
                digitalTwin = "Digital Twin",
                open = "Open",
                locked = "Locked",
                unlocked = "Unlocked",
                sentry = "Sentry",
                off = "Off",
                noVehicle = "No vehicle data",
            )

        fun data(
            security: JsonObject? = null,
            color: String? = "PearlWhite",
        ): DigitalTwinMiniData = DigitalTwinMiniData(vehicle(5, color), null, security, null)

        fun vehicle(
            id: Long,
            color: String? = "PearlWhite",
        ): Vehicle =
            Vehicle(
                createdAt = Instant.fromEpochSeconds(0),
                displayName = "Car $id",
                enrolledAt = Instant.fromEpochSeconds(0),
                id = id,
                teslaId = id,
                timezone = "UTC",
                updatedAt = Instant.fromEpochSeconds(0),
                vin = "VIN$id",
                color = color,
                model = "Model 3",
            )

        fun vehicleState(
            isLocked: Boolean = false,
            sentryMode: Boolean = false,
            isCharging: Boolean = false,
            state: String = "online",
            speed: Double = 0.0,
        ): VehicleState =
            VehicleState(
                batteryLevel = 60,
                chargeRate = 0.0,
                chargerPower = 0.0,
                idealRange = 300_000.0,
                insideTemp = 20.0,
                isCharging = isCharging,
                isClimateOn = false,
                isLocked = isLocked,
                latitude = 0.0,
                longitude = 0.0,
                odometer = 0.0,
                outsideTemp = 10.0,
                power = 0.0,
                ratedRange = 300_000.0,
                sentryMode = sentryMode,
                softwareVersion = "2025.1.0",
                speed = speed,
                state = state,
                timeToFullCharge = 0.0,
                vehicleId = 5,
            )
    }
}
