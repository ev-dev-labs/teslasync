// Pure, framework-free model + projections for the DigitalTwinPage vehicles surface (P3/A7) — the native analogue of
// everything web/src/features/vehicles/pages/DigitalTwinPage.tsx (composed with web/src/lib/vehicleState.ts and
// web/src/api/types.ts `deriveVehicleStatus`) derives before it composes its real-time physical-state dashboard. No
// Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the
// kotlinx-serialization JSON model, the shared VehicleTwin physical-state types and the diagnostics Logger), so the
// composable stays a thin render layer and all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page reads four feeds — `GET /vehicles` (web `useVehicles`), `GET /vehicles/{id}/state`
// (web `useVehicleState`), `GET /security/latest` (web `useSecurityLatest`) and `GET /charging-telemetry/latest`
// (web `useChargingTelemetryLatest`) — then folds the latter three through `buildTwinState` (lib/vehicleState.ts) into
// the merged physical state the VehicleTwin draws, and derives the badge status (web `badgeStatus` useMemo over
// `deriveVehicleStatus`). This file ports that decode (`parseVehicles` / `parseSecurity` / `parseVehicleState` /
// `parseCharging`), the verbatim merge (`buildTwinState`, with `parseDoorState` / `parseWindowState` /
// `parseTurnSignal` / `parseWindowOpenSummary`), the badge derivation (`deriveVehicleStatus` / `deriveBadgeStatus`),
// and the three side-panel row projections (`doorRows` / `windowRows` / `securityRows`, whose cell values are
// i18n-token enums resolved to strings at the render boundary, ADR-014). It produces the shared
// `io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinState` so the real VehicleTwin surface renders it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do. `TooManyFunctions` is
// suppressed for the parity-complete decode + derivation set.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.vehicles.digitaltwin

import io.teslasync.android.sharedsurfaces.vehicletwin.DoorStates
import io.teslasync.android.sharedsurfaces.vehicletwin.EMPTY_TWIN_STATE
import io.teslasync.android.sharedsurfaces.vehicletwin.TurnSignalState
import io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinState
import io.teslasync.android.sharedsurfaces.vehicletwin.WindowState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `DigitalTwinPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("digitalTwin", "/digital-twin", NavGroup.Vehicles)`, so [io.teslasync.android.navigation.PageHosts] binds this
 * surface to that destination (and its `/digital-twin` deep link) without the nav module depending on it.
 */
object DigitalTwinPageRegistration {
    /** The navigation destination id (Destinations.kt `page("digitalTwin", "/digital-twin", …)`). */
    const val ROUTE_ID: String = "digitalTwin"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/digital-twin"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle payload. */
    const val SLUG: String = "DigitalTwinPage"
}

/** Em dash shown for a missing data value (web `?? '—'` / `windowLabel` default). */
const val TWIN_EM_DASH: String = "\u2014"

/* ------------------------------------------------------------------ */
/*  Domain model (the decoded feed shapes)                            */
/* ------------------------------------------------------------------ */

/** One enrolled vehicle row from `GET /vehicles` (web `Vehicle`) — only the fields this surface reads. */
data class TwinVehicle(
    val id: Long,
    val displayName: String,
    val exteriorColor: String?,
)

/** The decoded `GET /security/latest` snapshot (web `SecurityEvent`); raw door/window fields stay [JsonElement]. */
data class SecuritySnapshot(
    val doorState: JsonElement?,
    val doorsOpen: JsonElement?,
    val windowsOpen: JsonElement?,
    val fdWindow: JsonElement?,
    val fpWindow: JsonElement?,
    val rdWindow: JsonElement?,
    val rpWindow: JsonElement?,
    val locked: Boolean?,
    val sentryMode: Boolean?,
    val driverSeatOccupied: Boolean?,
    val lightsHighBeams: Boolean?,
    val lightsHazardsActive: Boolean?,
    val lightsTurnSignal: JsonElement?,
    val createdAt: String?,
)

/** The decoded `GET /vehicles/{id}/state` snapshot (web `VehicleState` + the `live` flag). */
data class VehicleStateSnapshot(
    val stateName: String?,
    val speed: Double?,
    val isCharging: Boolean?,
    val chargerPower: Double?,
    val isLocked: Boolean?,
    val sentryMode: Boolean?,
    val live: Boolean,
)

/** The decoded `GET /charging-telemetry/latest` snapshot (web `ChargingTelemetry`) — the charging signals only. */
data class ChargingSnapshot(
    val chargingState: String?,
    val chargerPowerW: Double?,
    val chargerPowerKw: Double?,
    val chargePortDoorOpen: Boolean?,
)

/* ------------------------------------------------------------------ */
/*  JSON decode (web useQuery queryFn payloads)                       */
/* ------------------------------------------------------------------ */

/**
 * Decodes the `GET /vehicles` payload into the enrolled-vehicle list (web `useVehicles`). Accepts a bare JSON array or
 * a `{ "data": [...] }` / `{ "items": [...] }` envelope; anything else is an empty fleet (web `safeArray`). Non-object
 * rows are skipped.
 */
fun parseVehicles(payload: JsonElement?): List<TwinVehicle> {
    val array =
        when (payload) {
            is JsonArray -> payload
            is JsonObject -> (payload["data"] as? JsonArray) ?: (payload["items"] as? JsonArray)
            else -> null
        } ?: return emptyList()
    return array.mapNotNull { element ->
        val obj = element as? JsonObject ?: return@mapNotNull null
        val id = obj.long("id") ?: return@mapNotNull null
        TwinVehicle(
            id = id,
            displayName = obj.string("display_name") ?: obj.string("name").orEmpty(),
            exteriorColor = obj.string("exterior_color"),
        )
    }
}

/**
 * Decodes the `GET /security/latest` payload into a [SecuritySnapshot] (web `useSecurityLatest`). Returns `null` when
 * the payload is absent or not a JSON object (web `securityData ?` optional chaining everywhere downstream).
 */
fun parseSecurity(payload: JsonElement?): SecuritySnapshot? {
    val obj = payload as? JsonObject ?: return null
    return SecuritySnapshot(
        doorState = obj.element("door_state"),
        doorsOpen = obj.element("doors_open"),
        windowsOpen = obj.element("windows_open"),
        fdWindow = obj.element("fd_window"),
        fpWindow = obj.element("fp_window"),
        rdWindow = obj.element("rd_window"),
        rpWindow = obj.element("rp_window"),
        locked = obj.bool("locked"),
        sentryMode = obj.bool("sentry_mode"),
        driverSeatOccupied = obj.bool("driver_seat_occupied"),
        lightsHighBeams = obj.bool("lights_high_beams"),
        lightsHazardsActive = obj.bool("lights_hazards_active"),
        lightsTurnSignal = obj.element("lights_turn_signal"),
        createdAt = obj.string("created_at") ?: obj.string("ts"),
    )
}

/**
 * Decodes the `GET /vehicles/{id}/state` payload (web `useVehicleState`). The primary shape is `{ state: {…},
 * live }`; the legacy `{ vehicle, position, is_charging, … }` shape is folded the same way the web hook does. Returns
 * `null` when the payload is not a JSON object.
 */
fun parseVehicleState(payload: JsonElement?): VehicleStateSnapshot? {
    val obj = payload as? JsonObject ?: return null
    val live = obj.bool("live") ?: false
    val stateObj = obj["state"] as? JsonObject
    if (stateObj != null && stateObj["vehicle_id"] != null) {
        return VehicleStateSnapshot(
            stateName = stateObj.string("state"),
            speed = stateObj.double("speed"),
            isCharging = stateObj.bool("is_charging"),
            chargerPower = stateObj.double("charger_power"),
            isLocked = stateObj.bool("is_locked"),
            sentryMode = stateObj.bool("sentry_mode"),
            live = live,
        )
    }
    val vehicle = obj["vehicle"] as? JsonObject
    val position = obj["position"] as? JsonObject
    if (vehicle == null && position == null) {
        val plain = obj["state"] as? JsonPrimitive
        return VehicleStateSnapshot(
            stateName = plain?.contentOrNull,
            speed = null,
            isCharging = obj.bool("is_charging"),
            chargerPower = obj.double("charger_power"),
            isLocked = obj.bool("is_locked"),
            sentryMode = obj.bool("sentry_mode"),
            live = live,
        )
    }
    return VehicleStateSnapshot(
        stateName = vehicle?.string("state") ?: "offline",
        speed = position?.double("speed"),
        isCharging = obj.bool("is_charging"),
        chargerPower = obj.double("charger_power"),
        isLocked = obj.bool("is_locked") ?: vehicle?.bool("is_locked"),
        sentryMode = obj.bool("sentry_mode"),
        live = live,
    )
}

/**
 * Decodes the `GET /charging-telemetry/latest` payload into a [ChargingSnapshot] (web `useChargingTelemetryLatest`).
 * Returns `null` when the payload is absent or not a JSON object. Both the SI canonical `charger_power_w` and the
 * legacy `charger_power_kw` are read so the "is charging" predicate stays correct across the SI migration.
 */
fun parseCharging(payload: JsonElement?): ChargingSnapshot? {
    val obj = payload as? JsonObject ?: return null
    return ChargingSnapshot(
        chargingState = obj.string("charging_state"),
        chargerPowerW = obj.double("charger_power_w"),
        chargerPowerKw = obj.double("charger_power_kw"),
        chargePortDoorOpen = obj.bool("charge_port_door_open"),
    )
}

/* ------------------------------------------------------------------ */
/*  buildTwinState — verbatim port of lib/vehicleState.ts            */
/* ------------------------------------------------------------------ */

/**
 * Merges [security] + [vehicleState] + [charging] into the single [VehicleTwinState] the VehicleTwin draws — the
 * native port of the web `buildTwinState`. When every feed is absent the neutral [EMPTY_TWIN_STATE] is returned.
 */
fun buildTwinState(
    security: SecuritySnapshot?,
    vehicleState: VehicleStateSnapshot?,
    charging: ChargingSnapshot?,
): VehicleTwinState {
    if (security == null && vehicleState == null && charging == null) return EMPTY_TWIN_STATE
    val doors = parseDoorState(security?.doorState ?: security?.doorsOpen)
    val chargingActive = isChargingActive(vehicleState, charging)
    val windowsOpen = security?.windowsOpen
    return VehicleTwinState(
        doors = doors,
        windowFD = parseWindowState(security?.fdWindow)
            ?: parseWindowOpenSummary(windowsOpen, listOf("fd", "front driver", "driver front", "driver_front")),
        windowFP = parseWindowState(security?.fpWindow)
            ?: parseWindowOpenSummary(windowsOpen, listOf("fp", "front passenger", "passenger front", "passenger_front")),
        windowRD = parseWindowState(security?.rdWindow)
            ?: parseWindowOpenSummary(windowsOpen, listOf("rd", "rear driver", "driver rear", "driver_rear")),
        windowRP = parseWindowState(security?.rpWindow)
            ?: parseWindowOpenSummary(windowsOpen, listOf("rp", "rear passenger", "passenger rear", "passenger_rear")),
        frunkOpen = doors.trunkFront,
        trunkOpen = doors.trunkRear,
        chargePortOpen = charging?.chargePortDoorOpen ?: (if (chargingActive) true else null),
        isCharging = chargingActive,
        isDriving = isVehicleDriving(vehicleState),
        locked = security?.locked ?: vehicleState?.isLocked,
        sentryMode = security?.sentryMode ?: vehicleState?.sentryMode,
        headlights = security?.lightsHighBeams,
        hazards = security?.lightsHazardsActive,
        turnSignal = parseTurnSignal(security?.lightsTurnSignal),
        driverSeatOccupied = security?.driverSeatOccupied,
    )
}

/** Charging-active predicate (web `isChargingActive`): vehicle flag, charger power (SI or legacy), or charge state. */
private fun isChargingActive(
    vehicleState: VehicleStateSnapshot?,
    charging: ChargingSnapshot?,
): Boolean {
    val normalizedState = charging?.chargingState?.lowercase(Locale.ROOT)?.replace(Regex("[\\s_-]"), "").orEmpty()
    return vehicleState?.isCharging == true ||
        (vehicleState?.chargerPower ?: 0.0) > 0.0 ||
        (charging?.chargerPowerW ?: 0.0) > 0.0 ||
        (charging?.chargerPowerKw ?: 0.0) > 0.0 ||
        normalizedState == "charging" ||
        normalizedState == "starting"
}

/** Driving predicate (web `isVehicleDriving`): the `driving` state string or a positive speed. */
private fun isVehicleDriving(vehicleState: VehicleStateSnapshot?): Boolean {
    if (vehicleState == null) return false
    return vehicleState.stateName?.lowercase(Locale.ROOT) == "driving" || (vehicleState.speed ?: 0.0) > 0.0
}

/* ------------------------------------------------------------------ */
/*  Signal parsers (web lib/vehicleState.ts + parseEnums.ts)         */
/* ------------------------------------------------------------------ */

/**
 * Parses the compound DoorState signal (web `parseDoorState`). Accepts a native JSON object payload, a JSON object
 * serialized as a string, the "all closed" shorthand, or a descriptive enum string. Every field is `null` ("unknown")
 * rather than defaulting to closed when it cannot be determined.
 */
fun parseDoorState(element: JsonElement?): DoorStates {
    if (element is JsonObject) return doorsFromObject(element)
    val raw = asNonEmptyString(element)?.trim() ?: return DoorStates()
    if (raw.isEmpty()) return DoorStates()
    val lower = raw.lowercase(Locale.ROOT)
    if (lower in CLOSED_SHORTHAND) {
        return DoorStates(
            driverFront = false,
            passengerFront = false,
            driverRear = false,
            passengerRear = false,
            trunkFront = null,
            trunkRear = null,
        )
    }
    if (raw.startsWith("{")) {
        runCatching { jsonObjectOf(raw) }.getOrNull()?.let { return doorsFromObject(it) }
    }
    return doorsFromDescriptiveString(lower)
}

private val CLOSED_SHORTHAND = setOf("closedall", "closed", "none", "[]", "0", "false")

private fun doorsFromObject(obj: JsonObject): DoorStates =
    DoorStates(
        driverFront = truthy(obj["DriverFront"]) ?: truthy(obj["driver_front"]),
        passengerFront = truthy(obj["PassengerFront"]) ?: truthy(obj["passenger_front"]),
        driverRear = truthy(obj["DriverRear"]) ?: truthy(obj["driver_rear"]),
        passengerRear = truthy(obj["PassengerRear"]) ?: truthy(obj["passenger_rear"]),
        trunkFront = truthy(obj["TrunkFront"]) ?: truthy(obj["trunk_front"]),
        trunkRear = truthy(obj["TrunkRear"]) ?: truthy(obj["trunk_rear"]),
    )

/** String-matching branch of [parseDoorState] for descriptive values (e.g. "OpenDriverFront"). */
private fun doorsFromDescriptiveString(lower: String): DoorStates =
    DoorStates(
        driverFront = if (lower.contains("driver") && lower.contains("front")) true else null,
        passengerFront = if (lower.contains("passenger") && lower.contains("front")) true else null,
        driverRear = if ((lower.contains("driver") && lower.contains("rear")) || lower.contains("driverrear")) true else null,
        passengerRear =
            if ((lower.contains("passenger") && lower.contains("rear")) || lower.contains("passengerrear")) true else null,
        trunkFront =
            if (lower.contains("frunk") || lower.contains("fronttrunk") || lower.contains("front_trunk") ||
                lower.contains("trunkfront") || lower.contains("trunk_front")
            ) {
                true
            } else {
                null
            },
        trunkRear =
            if (lower.contains("reartrunk") || lower.contains("rear_trunk") || lower.contains("trunkrear") ||
                lower.contains("trunk_rear") || lower.contains("liftgate") ||
                (lower.contains("trunk") && !lower.contains("frunk") && !lower.contains("front"))
            ) {
                true
            } else {
                null
            },
    )

/**
 * Normalizes a Tesla window enum value to a [WindowState] (web `parseWindowState`). Non-string payloads yield `null`
 * (so [buildTwinState] falls through to the windows-open summary); an unrecognized string yields `null` too.
 */
fun parseWindowState(element: JsonElement?): WindowState? {
    val raw = asNonEmptyString(element) ?: return null
    val lower = raw.lowercase(Locale.ROOT)
    return when {
        lower.contains("closed") || lower == "0" -> WindowState.Closed
        lower.contains("partial") || lower.contains("vent") -> WindowState.Partial
        lower.contains("open") -> WindowState.Open
        else -> null
    }
}

/** Summary-string window heuristic (web `parseWindowOpenSummary`). */
fun parseWindowOpenSummary(
    windowsOpen: JsonElement?,
    aliases: List<String>,
): WindowState {
    val raw = asNonEmptyString(windowsOpen) ?: return WindowState.Unknown
    val normalized = raw.lowercase(Locale.ROOT)
    if (normalized in setOf("closed", "none", "[]", "false")) return WindowState.Closed
    return if (aliases.any { normalized.contains(it) }) WindowState.Open else WindowState.Unknown
}

/** Turn-signal parser (web `parseTurnSignal`). */
fun parseTurnSignal(element: JsonElement?): TurnSignalState {
    val raw = asNonEmptyString(element) ?: return TurnSignalState.Unknown
    val lower = raw.lowercase(Locale.ROOT).replace("turnsignal", "")
    return when {
        lower.contains("both") -> TurnSignalState.Both
        lower.contains("left") -> TurnSignalState.Left
        lower.contains("right") -> TurnSignalState.Right
        lower.contains("off") || lower.isEmpty() || lower == "0" -> TurnSignalState.Off
        else -> TurnSignalState.Unknown
    }
}

/* ------------------------------------------------------------------ */
/*  Badge status (web deriveVehicleStatus + badgeStatus useMemo)      */
/* ------------------------------------------------------------------ */

/** The vehicle-state strings the badge recognizes (web `VEHICLE_STATES`); anything else collapses to `online`. */
private val KNOWN_VEHICLE_STATES =
    setOf("online", "offline", "asleep", "driving", "charging", "updating", "parked", "idle", "standby")

/** Display status string for a state snapshot (web `deriveVehicleStatus`). */
fun deriveVehicleStatus(state: VehicleStateSnapshot?): String {
    if (state == null) return "offline"
    if (state.isCharging == true) return "charging"
    if ((state.speed ?: 0.0) > 0.0) return "driving"
    val s = state.stateName?.lowercase(Locale.ROOT).orEmpty()
    return if (s in KNOWN_VEHICLE_STATES) s else "online"
}

/**
 * The single source-of-truth badge status (web `badgeStatus` useMemo): charging/driving win, else the derived vehicle
 * status, else `online` when any live flag or fresh security/charging stream is flowing, else `offline`.
 */
fun deriveBadgeStatus(
    twin: VehicleTwinState,
    vehicleState: VehicleStateSnapshot?,
    hasSecurity: Boolean,
    hasCharging: Boolean,
): String {
    if (twin.isCharging) return "charging"
    if (twin.isDriving) return "driving"
    val fromState = deriveVehicleStatus(vehicleState)
    if (fromState != "offline") return fromState
    if (vehicleState?.live == true || hasSecurity || hasCharging) return "online"
    return "offline"
}

/* ------------------------------------------------------------------ */
/*  Side-panel row projections (web doorItems/windowItems/securityItems) */
/* ------------------------------------------------------------------ */

/** A side-panel label token resolved to an i18n string at the render boundary (web `t('digitalTwin.*')`). */
enum class TwinLabel {
    DoorDriverFront,
    DoorPassengerFront,
    DoorDriverRear,
    DoorPassengerRear,
    Frunk,
    Trunk,
    WindowFD,
    WindowFP,
    WindowRD,
    WindowRP,
    Locked,
    Driving,
    Charging,
    SentryMode,
    ChargePort,
    DriverSeat,
    Headlights,
    Hazards,
}

/** A side-panel cell value token resolved to an i18n string (or the em dash) at the render boundary. */
enum class TwinValue {
    Open,
    Closed,
    Partial,
    Yes,
    No,
    Active,
    Inactive,
    On,
    Off,
    Occupied,
    Empty,
    Charging,
    Dash,
}

/** One label/value row of a side panel. */
data class TwinRow(
    val label: TwinLabel,
    val value: TwinValue,
)

/** The doors & openings rows (web `doorItems`). */
fun doorRows(twin: VehicleTwinState): List<TwinRow> =
    listOf(
        TwinRow(TwinLabel.DoorDriverFront, openClosed(twin.doors.driverFront)),
        TwinRow(TwinLabel.DoorPassengerFront, openClosed(twin.doors.passengerFront)),
        TwinRow(TwinLabel.DoorDriverRear, openClosed(twin.doors.driverRear)),
        TwinRow(TwinLabel.DoorPassengerRear, openClosed(twin.doors.passengerRear)),
        TwinRow(TwinLabel.Frunk, openClosed(twin.frunkOpen)),
        TwinRow(TwinLabel.Trunk, openClosed(twin.trunkOpen)),
    )

/** The windows rows (web `windowItems` via `windowLabel`). */
fun windowRows(twin: VehicleTwinState): List<TwinRow> =
    listOf(
        TwinRow(TwinLabel.WindowFD, windowValue(twin.windowFD)),
        TwinRow(TwinLabel.WindowFP, windowValue(twin.windowFP)),
        TwinRow(TwinLabel.WindowRD, windowValue(twin.windowRD)),
        TwinRow(TwinLabel.WindowRP, windowValue(twin.windowRP)),
    )

/** The security & status rows (web `securityItems`). */
fun securityRows(twin: VehicleTwinState): List<TwinRow> =
    listOf(
        TwinRow(TwinLabel.Locked, yesNoUnknown(twin.locked)),
        TwinRow(TwinLabel.Driving, if (twin.isDriving) TwinValue.Yes else TwinValue.No),
        TwinRow(TwinLabel.Charging, if (twin.isCharging) TwinValue.Yes else TwinValue.No),
        TwinRow(TwinLabel.SentryMode, activeInactive(twin.sentryMode)),
        TwinRow(TwinLabel.ChargePort, chargePortValue(twin)),
        TwinRow(TwinLabel.DriverSeat, occupiedEmpty(twin.driverSeatOccupied)),
        TwinRow(TwinLabel.Headlights, onOff(twin.headlights)),
        TwinRow(TwinLabel.Hazards, activeOff(twin.hazards)),
    )

private fun openClosed(value: Boolean?): TwinValue =
    when (value) {
        null -> TwinValue.Dash
        true -> TwinValue.Open
        false -> TwinValue.Closed
    }

private fun windowValue(state: WindowState): TwinValue =
    when (state) {
        WindowState.Open -> TwinValue.Open
        WindowState.Closed -> TwinValue.Closed
        WindowState.Partial -> TwinValue.Partial
        WindowState.Unknown -> TwinValue.Dash
    }

private fun yesNoUnknown(value: Boolean?): TwinValue =
    when (value) {
        null -> TwinValue.Dash
        true -> TwinValue.Yes
        false -> TwinValue.No
    }

private fun activeInactive(value: Boolean?): TwinValue =
    when (value) {
        null -> TwinValue.Dash
        true -> TwinValue.Active
        false -> TwinValue.Inactive
    }

private fun activeOff(value: Boolean?): TwinValue =
    when (value) {
        null -> TwinValue.Dash
        true -> TwinValue.Active
        false -> TwinValue.Off
    }

private fun onOff(value: Boolean?): TwinValue =
    when (value) {
        null -> TwinValue.Dash
        true -> TwinValue.On
        false -> TwinValue.Off
    }

private fun occupiedEmpty(value: Boolean?): TwinValue =
    when (value) {
        null -> TwinValue.Dash
        true -> TwinValue.Occupied
        false -> TwinValue.Empty
    }

private fun chargePortValue(twin: VehicleTwinState): TwinValue =
    when {
        twin.isCharging -> TwinValue.Charging
        twin.chargePortOpen == null -> TwinValue.Dash
        twin.chargePortOpen == true -> TwinValue.Open
        else -> TwinValue.Closed
    }

/* ------------------------------------------------------------------ */
/*  Last-updated formatting (web useDateFormat.formatTime)            */
/* ------------------------------------------------------------------ */

/**
 * Locale-aware local time for the "Last updated" caption (web `formatTime(twinState.lastUpdated)`). Returns `null`
 * when there is no timestamp or it cannot be parsed (the caption is then omitted, web `twinState.lastUpdated &&`).
 */
fun lastUpdatedTime(
    createdAt: String?,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
): String? {
    val instant = createdAt?.let(::instantOf) ?: return null
    return DateTimeFormatter.ofLocalizedTime(FormatStyle.MEDIUM).withLocale(locale).format(instant.atZone(zone))
}

/* ------------------------------------------------------------------ */
/*  Resource mapping + diagnostics                                    */
/* ------------------------------------------------------------------ */

/** Projects a decode over a cache-then-network [Resource] (the sibling A7 page-model helper). */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DigitalTwinPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id, VIN, or physical-state payload.
 */
fun recordDigitalTwinPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DigitalTwinPageRegistration.SLUG))
}

/* ------------------------------------------------------------------ */
/*  JSON + timestamp helpers                                          */
/* ------------------------------------------------------------------ */

/** Web `asNonEmptyString`: the trimmed content of a string [JsonPrimitive], or `null` for any non-string / blank. */
private fun asNonEmptyString(element: JsonElement?): String? {
    val primitive = element as? JsonPrimitive ?: return null
    if (!primitive.isString) return null
    return primitive.contentOrNull?.takeIf { it.isNotBlank() }
}

/** Web `Boolean(x)` truthiness over a JSON value; `null`/[JsonNull] stay unknown. */
private fun truthy(element: JsonElement?): Boolean? {
    if (element == null || element is JsonNull) return null
    val primitive = element as? JsonPrimitive ?: return true
    primitive.booleanOrNull?.let { return it }
    primitive.doubleOrNull?.let { return it != 0.0 }
    val content = primitive.contentOrNull ?: return null
    return content.isNotEmpty() && !content.equals("false", ignoreCase = true)
}

private fun jsonObjectOf(raw: String): JsonObject =
    kotlinx.serialization.json.Json.parseToJsonElement(raw) as JsonObject

private fun JsonObject.element(key: String): JsonElement? = this[key]?.takeIf { it !is JsonNull }

private fun JsonObject.string(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }

private fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

private fun JsonObject.double(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

/** Parses an ISO-8601 timestamp (with or without an explicit offset, falling back to UTC) to an [Instant]. */
private fun instantOf(createdAt: String): Instant? {
    if (createdAt.isBlank()) return null
    runCatching { return Instant.parse(createdAt) }
    runCatching { return OffsetDateTime.parse(createdAt).toInstant() }
    runCatching { return LocalDateTime.parse(createdAt).atZone(ZoneId.of("UTC")).toInstant() }
    return null
}
