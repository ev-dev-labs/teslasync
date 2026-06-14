package io.teslasync.android.dashboard.widgets.digitaltwin

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the DigitalTwinWidget's pure logic — the `buildTwinState` merge (door / window
 * / turn-signal parsing, lock / sentry precedence, charging + driving detection), the badge derivation
 * (order, tones, labels), the cache-then-network state fold (loading / content / empty / offline-cached /
 * error-without-blanking), the no-vehicle fold, the active-vehicle resolution and the registry metadata.
 * Mirrors the web spec (web/src/features/dashboard/widgets/DigitalTwinWidget.tsx + web/src/lib/vehicleState.ts)
 * against the snake_case wire contract.
 */
class DigitalTwinProjectionTest {
    private val strings =
        DigitalTwinStrings(
            title = "Digital Twin",
            lockUnknown = "Lock Unknown",
            locked = "Locked",
            unlocked = "Unlocked",
            windowsUnknown = "Windows Unknown",
            windowsClosed = "Windows Closed",
            windowsOpen = "Open",
            driving = "Driving",
            charging = "Charging",
            sentryOn = "Sentry",
            headlightsOn = "Lights On",
            hazardsOn = "Hazards",
            doorsOpen = "Doors Open",
            frunkOpen = "Frunk Open",
            trunkOpen = "Trunk Open",
            noVehicle = "No vehicle data",
        )

    // ── Registry metadata (web registry/vehicle.ts → vehicle-twin) ─────────────────

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("vehicle-twin", DigitalTwinRegistration.ID)
        assertEquals("vehicle", DigitalTwinRegistration.CATEGORY)
        assertEquals("DigitalTwinWidget", DigitalTwinRegistration.SLUG)
        assertEquals(DigitalTwinSize(2, 4), DigitalTwinRegistration.DEFAULT_SIZE)
        assertEquals(DigitalTwinSize(2, 4), DigitalTwinRegistration.MIN_SIZE)
        assertEquals(DigitalTwinSize(3, 40), DigitalTwinRegistration.MAX_SIZE)
    }

    @Test
    fun sizeExpandsAtThreeColsOrFiveRows() {
        assertFalse(DigitalTwinSize(2, 4).isExpanded)
        assertTrue(DigitalTwinSize(3, 4).isExpanded)
        assertTrue(DigitalTwinSize(2, 5).isExpanded)
    }

    @Test
    fun clampHonoursMinMaxFootprint() {
        assertEquals(DigitalTwinSize(2, 4), DigitalTwinRegistration.clamp(DigitalTwinSize(1, 1)))
        assertEquals(DigitalTwinSize(3, 40), DigitalTwinRegistration.clamp(DigitalTwinSize(9, 99)))
        assertTrue(DigitalTwinRegistration.isWithinBounds(DigitalTwinSize(2, 10)))
        assertFalse(DigitalTwinRegistration.isWithinBounds(DigitalTwinSize(1, 10)))
    }

    // ── buildTwinState — merge + parsers (web vehicleState.ts) ─────────────────────

    @Test
    fun emptyTripleYieldsEmptyTwin() {
        assertEquals(VehicleTwinState.EMPTY, DigitalTwinProjection.buildTwinState(null, null, null))
        assertEquals(VehicleTwinState.EMPTY, DigitalTwinProjection.buildTwinState(JsonNull, null, null))
    }

    @Test
    fun doorStateObjectDecodesPascalAndSnakeCorners() {
        val security =
            buildJsonObject {
                put(
                    "door_state",
                    buildJsonObject {
                        put("DriverFront", true)
                        put("passenger_rear", true)
                    },
                )
            }
        val twin = DigitalTwinProjection.buildTwinState(security, null, null)
        assertEquals(true, twin.doors.driverFront)
        assertEquals(true, twin.doors.passengerRear)
        assertNull(twin.doors.driverRear)
        assertEquals(2, DigitalTwinProjection.openDoorCount(twin.doors))
    }

    @Test
    fun doorStateClosedShorthandClosesSideDoors() {
        val twin = DigitalTwinProjection.buildTwinState(buildJsonObject { put("door_state", "ClosedAll") }, null, null)
        assertEquals(false, twin.doors.driverFront)
        assertEquals(false, twin.doors.passengerRear)
        assertEquals(0, DigitalTwinProjection.openDoorCount(twin.doors))
    }

    @Test
    fun doorStateDescriptiveStringMarksMatchingCorner() {
        val twin = DigitalTwinProjection.buildTwinState(buildJsonObject { put("door_state", "OpenDriverFront") }, null, null)
        assertEquals(true, twin.doors.driverFront)
        assertNull(twin.doors.passengerFront)
    }

    @Test
    fun frunkAndTrunkMirrorTrunkCorners() {
        val security =
            buildJsonObject {
                put(
                    "door_state",
                    buildJsonObject {
                        put("TrunkFront", true)
                        put("TrunkRear", true)
                    },
                )
            }
        val twin = DigitalTwinProjection.buildTwinState(security, null, null)
        assertEquals(true, twin.frunkOpen)
        assertEquals(true, twin.trunkOpen)
    }

    @Test
    fun windowEnumStringsParseToState() {
        val security =
            buildJsonObject {
                put("fd_window", "Open")
                put("fp_window", "Closed")
                put("rd_window", "PartiallyOpen")
                put("rp_window", "FrontDriverWindowStateClosed")
            }
        val twin = DigitalTwinProjection.buildTwinState(security, null, null)
        assertEquals(WindowOpenState.Open, twin.windowFD)
        assertEquals(WindowOpenState.Closed, twin.windowFP)
        assertEquals(WindowOpenState.Partial, twin.windowRD)
        assertEquals(WindowOpenState.Closed, twin.windowRP)
    }

    @Test
    fun windowCornerFallsBackToWindowsOpenSummary() {
        val security = buildJsonObject { put("windows_open", "driver_front, rear passenger") }
        val twin = DigitalTwinProjection.buildTwinState(security, null, null)
        assertEquals(WindowOpenState.Open, twin.windowFD)
        assertEquals(WindowOpenState.Open, twin.windowRP)
        assertEquals(WindowOpenState.Unknown, twin.windowFP)
    }

    @Test
    fun windowsOpenClosedSummaryClosesAllCorners() {
        val twin = DigitalTwinProjection.buildTwinState(buildJsonObject { put("windows_open", "closed") }, null, null)
        assertEquals(WindowOpenState.Closed, twin.windowFD)
        assertEquals(WindowOpenState.Closed, twin.windowRP)
    }

    @Test
    fun lockAndSentryPreferSecurityThenVehicleState() {
        val security = buildJsonObject { put("locked", true) }
        val state = vehicleState(isLocked = false, sentryMode = true)
        val twin = DigitalTwinProjection.buildTwinState(security, state, null)
        assertEquals(true, twin.locked)
        assertEquals(true, twin.sentryMode)
    }

    @Test
    fun lightsFlagsDecodeFromSecurity() {
        val security =
            buildJsonObject {
                put("lights_high_beams", true)
                put("lights_hazards_active", true)
                put("lights_turn_signal", "TurnSignalLeft")
            }
        val twin = DigitalTwinProjection.buildTwinState(security, null, null)
        assertEquals(true, twin.headlights)
        assertEquals(true, twin.hazards)
        assertEquals(TurnSignalState.Left, twin.turnSignal)
    }

    @Test
    fun chargingActiveFromTelemetryState() {
        val charging = buildJsonObject { put("charging_state", "Charging") }
        val twin = DigitalTwinProjection.buildTwinState(null, null, charging)
        assertTrue(twin.isCharging)
        assertEquals(true, twin.chargePortOpen)
    }

    @Test
    fun chargingActiveFromVehicleStatePower() {
        val twin = DigitalTwinProjection.buildTwinState(null, vehicleState(chargerPower = 7.0), null)
        assertTrue(twin.isCharging)
    }

    @Test
    fun chargePortPrefersExplicitTelemetryFlag() {
        val charging =
            buildJsonObject {
                put("charging_state", "Charging")
                put("charge_port_door_open", false)
            }
        val twin = DigitalTwinProjection.buildTwinState(null, null, charging)
        assertEquals(false, twin.chargePortOpen)
    }

    @Test
    fun drivingFromStateOrSpeed() {
        assertTrue(DigitalTwinProjection.isVehicleDriving(vehicleState(state = "Driving")))
        assertTrue(DigitalTwinProjection.isVehicleDriving(vehicleState(speed = 12.0)))
        assertFalse(DigitalTwinProjection.isVehicleDriving(vehicleState(state = "online", speed = 0.0)))
        assertFalse(DigitalTwinProjection.isVehicleDriving(null))
    }

    // ── badge derivation (web JSX) ─────────────────────────────────────────────────

    @Test
    fun lockBadgeReflectsLockState() {
        assertEquals("Lock Unknown", lockBadge(buildTwin(locked = null)).text)
        assertEquals(TwinBadgeTone.Neutral, lockBadge(buildTwin(locked = null)).tone)
        assertEquals("Locked", lockBadge(buildTwin(locked = true)).text)
        assertEquals(TwinBadgeTone.Success, lockBadge(buildTwin(locked = true)).tone)
        assertEquals("Unlocked", lockBadge(buildTwin(locked = false)).text)
        assertEquals(TwinBadgeTone.Danger, lockBadge(buildTwin(locked = false)).tone)
    }

    @Test
    fun windowBadgeReflectsWindowSummary() {
        assertEquals("Windows Unknown", windowBadge(buildTwin()).text)
        assertEquals(TwinBadgeTone.Neutral, windowBadge(buildTwin()).tone)
        val closed = buildTwin(windows = WindowOpenState.Closed)
        assertEquals("Windows Closed", windowBadge(closed).text)
        assertEquals(TwinBadgeTone.Success, windowBadge(closed).tone)
        val open = buildTwin(windows = WindowOpenState.Open)
        assertEquals("4 Open", windowBadge(open).text)
        assertEquals(TwinBadgeTone.Warning, windowBadge(open).tone)
    }

    @Test
    fun conditionalBadgesAppearOnlyWhenEngaged() {
        val twin =
            buildTwin().copy(
                isDriving = true,
                isCharging = true,
                sentryMode = true,
                headlights = true,
                hazards = true,
                frunkOpen = true,
                trunkOpen = true,
                doors =
                    TwinDoors(
                        driverFront = true,
                        passengerFront = true,
                        driverRear = null,
                        passengerRear = null,
                        trunkFront = null,
                        trunkRear = null,
                    ),
            )
        val texts = badgesOf(twin).map { it.text }
        assertTrue(texts.contains("Driving"))
        assertTrue(texts.contains("Charging"))
        assertTrue(texts.contains("Sentry"))
        assertTrue(texts.contains("Lights On"))
        assertTrue(texts.contains("Hazards"))
        assertTrue(texts.contains("2 Doors Open"))
        assertTrue(texts.contains("Frunk Open"))
        assertTrue(texts.contains("Trunk Open"))
    }

    @Test
    fun quietTwinShowsOnlyLockAndWindowBadges() {
        val badges = badgesOf(buildTwin())
        assertEquals(2, badges.size)
        assertTrue(badges.none { it.dot })
    }

    @Test
    fun liveStatusBadgesCarryDot() {
        val twin = buildTwin().copy(isDriving = true, sentryMode = true)
        assertTrue(badgesOf(twin).first { it.text == "Driving" }.dot)
        assertTrue(badgesOf(twin).first { it.text == "Sentry" }.dot)
    }

    // ── project — display assembly ─────────────────────────────────────────────────

    @Test
    fun projectExposesLabelAndDescriptionWhenVehiclePresent() {
        val data = DigitalTwinData(vehicle = TwinVehicle(1, "Sparky", "Deep Blue"), twin = buildTwin(locked = true))
        val display = DigitalTwinProjection.project(data, strings)
        assertTrue(display.hasVehicle)
        assertEquals("Sparky", display.vehicleLabel)
        assertEquals("Deep Blue", display.exteriorColor)
        assertTrue(display.twinContentDescription.startsWith("Sparky, Locked"))
    }

    @Test
    fun projectMarksEmptyWhenNoVehicle() {
        val display = DigitalTwinProjection.project(DigitalTwinData.EMPTY, strings)
        assertFalse(display.hasVehicle)
        assertEquals("", display.vehicleLabel)
    }

    // ── state fold (cache-then-network) ────────────────────────────────────────────

    @Test
    fun foldStateLoadingWhenCoreFeedsHaveNoCache() {
        val ui =
            DigitalTwinProjection.foldState(
                vehicle = TwinVehicle(1, "Car", null),
                stateRes = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                securityRes = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                chargingRes = Resource.Success(JsonNull, fetchedAt = 1L, stale = false),
            )
        assertEquals(UiPhase.Loading, ui.phase)
    }

    @Test
    fun foldStateContentWhenVehicleResolved() {
        val ui =
            DigitalTwinProjection.foldState(
                vehicle = TwinVehicle(1, "Car", null),
                stateRes = Resource.Success(VehicleStateEnvelope(vehicleState(isLocked = true), live = true), 10L, false),
                securityRes = Resource.Success(buildJsonObject { put("locked", true) }, 20L, false),
                chargingRes = Resource.Success(JsonNull, 5L, false),
            )
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(true, ui.data?.twin?.locked)
        assertEquals(20L, ui.fetchedAt)
        assertFalse(ui.stale)
    }

    @Test
    fun foldStateOfflineKeepsCachedTwinWithStaleAndRetry() {
        val ui =
            DigitalTwinProjection.foldState(
                vehicle = TwinVehicle(1, "Car", null),
                stateRes = Resource.Success(VehicleStateEnvelope(vehicleState(), live = false), 10L, false),
                securityRes =
                    Resource.Error(
                        cached = buildJsonObject { put("locked", false) },
                        fetchedAt = 8L,
                        stale = true,
                        error = ApiError.Network(),
                    ),
                chargingRes = Resource.Success(JsonNull, 5L, false),
            )
        assertEquals(UiPhase.Content, ui.phase)
        assertTrue(ui.stale)
        assertTrue(ui.isOffline)
        assertTrue(ui.canRetry)
        assertEquals(ErrorKind.Network, ui.errorKind)
        assertEquals(false, ui.data?.twin?.locked)
    }

    @Test
    fun foldNoVehicleEmptyLoadingError() {
        assertEquals(
            UiPhase.Loading,
            DigitalTwinProjection.foldNoVehicle(Resource.Loading(cached = null, fetchedAt = null, stale = false)).phase,
        )
        val empty = DigitalTwinProjection.foldNoVehicle(Resource.Success(emptyList<Vehicle>(), 10L, false))
        assertEquals(UiPhase.Empty, empty.phase)
        assertEquals(DigitalTwinData.EMPTY, empty.data)
        val errored =
            DigitalTwinProjection.foldNoVehicle(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()))
        assertEquals(UiPhase.Empty, errored.phase)
        assertTrue(errored.hasError)
    }

    // ── vehicle resolution ─────────────────────────────────────────────────────────

    @Test
    fun resolveVehiclePicksFirstOrPreferredOrNull() {
        val fleet = listOf(car(1, "A"), car(2, "B"))
        assertEquals(1L, resolveVehicle(fleet, null)?.id)
        assertEquals(2L, resolveVehicle(fleet, 2L)?.id)
        assertEquals(1L, resolveVehicle(fleet, 99L)?.id)
        assertNull(resolveVehicle(emptyList(), 1L))
        assertNull(resolveVehicle(null, null))
    }

    @Test
    fun toTwinVehicleFallsBackToVin() {
        assertEquals("Sparky", car(1, "Sparky").toTwinVehicle().label)
        assertEquals("VIN1", car(1, "").toTwinVehicle().label)
    }

    // ── helpers ────────────────────────────────────────────────────────────────────

    private fun lockBadge(twin: VehicleTwinState): TwinBadge = badgesOf(twin)[0]

    private fun windowBadge(twin: VehicleTwinState): TwinBadge = badgesOf(twin)[1]

    private fun badgesOf(twin: VehicleTwinState): List<TwinBadge> =
        DigitalTwinProjection.project(DigitalTwinData(TwinVehicle(1, "Car", null), twin), strings).badges

    private fun buildTwin(
        locked: Boolean? = null,
        windows: WindowOpenState = WindowOpenState.Unknown,
    ): VehicleTwinState =
        VehicleTwinState.EMPTY.copy(
            locked = locked,
            windowFD = windows,
            windowFP = windows,
            windowRD = windows,
            windowRP = windows,
        )

    private fun vehicleState(
        state: String = "online",
        speed: Double = 0.0,
        chargerPower: Double = 0.0,
        isLocked: Boolean = false,
        sentryMode: Boolean = false,
    ): VehicleState =
        VehicleState(
            batteryLevel = 80,
            chargeRate = 0.0,
            chargerPower = chargerPower,
            idealRange = 0.0,
            insideTemp = 20.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = isLocked,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 15.0,
            power = 0.0,
            ratedRange = 0.0,
            sentryMode = sentryMode,
            softwareVersion = "2025.1",
            speed = speed,
            state = state,
            timeToFullCharge = 0.0,
            vehicleId = 1,
        )

    private fun car(
        id: Long,
        name: String,
    ): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = name,
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )
}
