// Pure, framework-free model + projection for the Digital Twin dashboard widget — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/DigitalTwinWidget.tsx) together with the `buildTwinState` merge it
// composes from `web/src/lib/vehicleState.ts`. No Compose, no Android, no HTTP: every type here is
// unit-tested off device in the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer. The latest-security + charging-telemetry snapshots arrive as raw (non-unit) JSON whose corner
// fields may be a string enum OR a native boolean depending on the protomodel emission, so this file owns
// the defensive decode (web optional-chaining + `asNonEmptyString` → null-safe reads), the door / window /
// turn-signal parsing, the SI-free badge derivation, and the cache-then-network state fold.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DigitalTwinWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling SecurityStatus / VehicleAccess
// widgets do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.digitaltwin

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

// ── Security-snapshot fields read off `/security/latest` (web `SecurityEvent`) ──────────────────────────
private const val FIELD_DOOR_STATE = "door_state"
private const val FIELD_DOORS_OPEN = "doors_open"
private const val FIELD_WINDOWS_OPEN = "windows_open"
private const val FIELD_FD_WINDOW = "fd_window"
private const val FIELD_FP_WINDOW = "fp_window"
private const val FIELD_RD_WINDOW = "rd_window"
private const val FIELD_RP_WINDOW = "rp_window"
private const val FIELD_LOCKED = "locked"
private const val FIELD_SENTRY_MODE = "sentry_mode"
private const val FIELD_LIGHTS_HIGH_BEAMS = "lights_high_beams"
private const val FIELD_LIGHTS_HAZARDS = "lights_hazards_active"
private const val FIELD_LIGHTS_TURN_SIGNAL = "lights_turn_signal"
private const val FIELD_DRIVER_SEAT_OCCUPIED = "driver_seat_occupied"

// ── Charging-telemetry fields read off `/charging-telemetry/latest` (web `ChargingTelemetry`) ───────────
private const val FIELD_CHARGING_STATE = "charging_state"
private const val FIELD_CHARGER_POWER_KW = "charger_power_kw"
private const val FIELD_CHARGE_PORT_DOOR_OPEN = "charge_port_door_open"

// Compound `DoorState` PascalCase / snake_case corner keys (web `parsed.DriverFront ?? parsed.driver_front`).
private const val KEY_DRIVER_FRONT_P = "DriverFront"
private const val KEY_DRIVER_FRONT_S = "driver_front"
private const val KEY_PASSENGER_FRONT_P = "PassengerFront"
private const val KEY_PASSENGER_FRONT_S = "passenger_front"
private const val KEY_DRIVER_REAR_P = "DriverRear"
private const val KEY_DRIVER_REAR_S = "driver_rear"
private const val KEY_PASSENGER_REAR_P = "PassengerRear"
private const val KEY_PASSENGER_REAR_S = "passenger_rear"
private const val KEY_TRUNK_FRONT_P = "TrunkFront"
private const val KEY_TRUNK_FRONT_S = "trunk_front"
private const val KEY_TRUNK_REAR_P = "TrunkRear"
private const val KEY_TRUNK_REAR_S = "trunk_rear"

private const val STATE_DRIVING = "driving"
private const val CHARGE_STATE_CHARGING = "charging"
private const val CHARGE_STATE_STARTING = "starting"

// Web "all closed" door shorthands + the window-summary closed tokens (lower-cased).
private val CLOSED_DOOR_SHORTHANDS: Set<String> = setOf("closedall", "closed", "none", "[]", "0", "false")
private val WINDOW_CLOSED_TOKENS: Set<String> = setOf("closed", "none", "[]", "false")

// Per-corner aliases the web `parseWindowOpenSummary` matches inside the `windows_open` summary string.
private val WINDOW_FD_ALIASES: List<String> = listOf("fd", "front driver", "driver front", "driver_front")
private val WINDOW_FP_ALIASES: List<String> = listOf("fp", "front passenger", "passenger front", "passenger_front")
private val WINDOW_RD_ALIASES: List<String> = listOf("rd", "rear driver", "driver rear", "driver_rear")
private val WINDOW_RP_ALIASES: List<String> = listOf("rp", "rear passenger", "passenger rear", "passenger_rear")

// Descriptive door-string tokens that mark the front/rear trunk open (web `lower.includes(...)` chains).
private val FRUNK_TOKENS: List<String> = listOf("frunk", "fronttrunk", "front_trunk", "trunkfront", "trunk_front")
private val TRUNK_REAR_TOKENS: List<String> = listOf("reartrunk", "rear_trunk", "trunkrear", "trunk_rear", "liftgate")

private val WINDOW_STATE_STRIP = Regex("WindowState", RegexOption.IGNORE_CASE)
private val TURN_SIGNAL_STRIP = Regex("turnsignal", RegexOption.IGNORE_CASE)
private val CHARGE_STATE_STRIP = Regex("[\\s_-]")

private val LENIENT_JSON =
    Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

/**
 * A window corner's open state — the native analogue of the web `WindowState`
 * (`'open' | 'closed' | 'partial' | null`), with [Unknown] standing in for the web `null` so the
 * value is always total. The widget treats anything other than [Unknown] / [Closed] as "open".
 */
enum class WindowOpenState { Open, Closed, Partial, Unknown }

/** A turn-signal reading — the native analogue of the web `TurnSignalState` (`'left'|'right'|'both'|'off'|null`). */
enum class TurnSignalState { Left, Right, Both, Off, Unknown }

/**
 * The four side doors + the two trunks decoded from the compound `DoorState` signal — the native analogue
 * of the web `DoorStates`. Each corner is `null` when its state is unknown (web `boolean | null`); the twin
 * visual draws unknown corners dashed, closed corners dim, and open corners amber.
 */
data class TwinDoors(
    val driverFront: Boolean?,
    val passengerFront: Boolean?,
    val driverRear: Boolean?,
    val passengerRear: Boolean?,
    val trunkFront: Boolean?,
    val trunkRear: Boolean?,
) {
    companion object {
        /** The all-unknown door snapshot (web `UNKNOWN_DOORS`). */
        val UNKNOWN: TwinDoors = TwinDoors(null, null, null, null, null, null)

        /** The "all side doors closed, trunks unknown" snapshot (web closed-shorthand branch). */
        val ALL_CLOSED: TwinDoors = TwinDoors(false, false, false, false, null, null)
    }
}

/**
 * The merged physical state of one vehicle — the native port of the web `VehicleTwinState` that
 * `buildTwinState` produces from the security snapshot, the typed vehicle-state envelope and the charging
 * telemetry. Pure data (no Compose) so the merge is unit-tested directly. Only the fields the widget + twin
 * visual actually consume are carried (the web SSE-only `vehicleColor` / `lastUpdated` are not rendered by
 * this surface).
 */
data class VehicleTwinState(
    val doors: TwinDoors,
    val windowFD: WindowOpenState,
    val windowFP: WindowOpenState,
    val windowRD: WindowOpenState,
    val windowRP: WindowOpenState,
    val frunkOpen: Boolean?,
    val trunkOpen: Boolean?,
    val chargePortOpen: Boolean?,
    val isCharging: Boolean,
    val isDriving: Boolean,
    val locked: Boolean?,
    val sentryMode: Boolean?,
    val headlights: Boolean?,
    val hazards: Boolean?,
    val turnSignal: TurnSignalState,
    val driverSeatOccupied: Boolean?,
) {
    companion object {
        /** The all-unknown twin (web `EMPTY_TWIN_STATE`): nothing decodable, every reading unknown. */
        val EMPTY: VehicleTwinState =
            VehicleTwinState(
                doors = TwinDoors.UNKNOWN,
                windowFD = WindowOpenState.Unknown,
                windowFP = WindowOpenState.Unknown,
                windowRD = WindowOpenState.Unknown,
                windowRP = WindowOpenState.Unknown,
                frunkOpen = null,
                trunkOpen = null,
                chargePortOpen = null,
                isCharging = false,
                isDriving = false,
                locked = null,
                sentryMode = null,
                headlights = null,
                hazards = null,
                turnSignal = TurnSignalState.Unknown,
                driverSeatOccupied = null,
            )
    }
}

/**
 * The display identity of the resolved vehicle — the native analogue of the web `vehicle` the widget
 * resolves from the fleet list. [label] is the web `vehicle.display_name || vehicle.vin`; [exteriorColor]
 * is the Tesla paint code (native `Vehicle.color`, web `exterior_color`) the twin visual tints the body
 * with.
 *
 * @property id the resolved vehicle id (drives the per-vehicle feeds).
 * @property label the human label shown under the twin (display name, falling back to the VIN).
 * @property exteriorColor the paint code used to tint the body, or `null` for the default metallic.
 */
data class TwinVehicle(
    val id: Long,
    val label: String,
    val exteriorColor: String?,
)

/**
 * The decoded snapshot the widget renders — the native analogue of the web `{ vehicle, twinState }` it
 * holds. A `null` [vehicle] is the web "no vehicle" branch (the top-level empty state); a non-null
 * [vehicle] always renders the twin + badges, even when every reading is unknown.
 *
 * @property vehicle the resolved vehicle, or `null` when the fleet is empty (web `vehicle` undefined).
 * @property twin the merged physical state (web `twinState`).
 */
data class DigitalTwinData(
    val vehicle: TwinVehicle?,
    val twin: VehicleTwinState,
) {
    /** Web `vehicle ? … : <EmptyState/>` — false ⇒ the body shows the "No vehicle data" empty state. */
    val hasVehicle: Boolean get() = vehicle != null

    companion object {
        /** The no-vehicle snapshot surfaced for an empty fleet. */
        val EMPTY: DigitalTwinData = DigitalTwinData(vehicle = null, twin = VehicleTwinState.EMPTY)
    }
}

/**
 * The localized strings this surface needs — the native mirror of the sixteen `t('widget.…')` calls the
 * web component makes. Resolved once at the render boundary (P1/S10) and passed into
 * [DigitalTwinProjection] so the projection stays framework-free yet fully localized, exactly as the
 * sibling SecurityStatus / VehicleAccess widgets do.
 */
data class DigitalTwinStrings(
    val title: String,
    val lockUnknown: String,
    val locked: String,
    val unlocked: String,
    val windowsUnknown: String,
    val windowsClosed: String,
    val windowsOpen: String,
    val driving: String,
    val charging: String,
    val sentryOn: String,
    val headlightsOn: String,
    val hazardsOn: String,
    val doorsOpen: String,
    val frunkOpen: String,
    val trunkOpen: String,
    val noVehicle: String,
)

/**
 * The tone of a status [TwinBadge] — the native analogue of the web `Badge` `variant` union
 * (`'info' | 'success' | 'warning' | 'danger' | 'neutral'`). The render layer maps each onto the shared
 * `BadgeVariant`.
 */
enum class TwinBadgeTone { Info, Success, Warning, Danger, Neutral }

/**
 * One render-ready status chip — the native analogue of a web `<Badge>`. Pure data (no Compose) so the
 * badge derivation is unit-tested directly.
 *
 * @property text the localized chip label (e.g. "Locked", "2 Doors Open").
 * @property tone the chip tone (drives the wash + text colour).
 * @property dot whether the chip shows a leading status dot (web `dot` prop on live-status badges).
 */
data class TwinBadge(
    val text: String,
    val tone: TwinBadgeTone,
    val dot: Boolean,
)

/**
 * The fully projected, render-ready view of the twin snapshot — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose) so every branch is unit-tested directly.
 *
 * @property hasVehicle web `vehicle` truthy — false ⇒ the body shows the "No vehicle data" empty state.
 * @property twin the merged physical state the twin visual draws.
 * @property vehicleLabel the label shown under the twin (web `vehicle.display_name || vehicle.vin`).
 * @property exteriorColor the Tesla paint code used to tint the body (web `exterior_color`), or `null`.
 * @property badges the ordered status chips (lock + windows are always present, the rest are conditional).
 * @property twinContentDescription a folded TalkBack phrase summarising the twin (label + every badge).
 */
data class DigitalTwinDisplay(
    val hasVehicle: Boolean,
    val twin: VehicleTwinState,
    val vehicleLabel: String,
    val exteriorColor: String?,
    val badges: List<TwinBadge>,
    val twinContentDescription: String,
)

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * component reads `size.cols`/`size.rows` to choose the larger (`md`) vs compact (`sm`) twin render, so
 * this type carries the same axes the registry constrains.
 */
data class DigitalTwinSize(
    val cols: Int,
    val rows: Int,
) {
    /** Web `size.cols >= 3 || size.rows >= 5` — render the larger twin. */
    val isExpanded: Boolean get() = cols >= 3 || rows >= 5
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`vehicle-twin`). A dashboard grid host binds this
 * surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object DigitalTwinRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "vehicle-twin"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DigitalTwinWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val DEFAULT_SIZE: DigitalTwinSize = DigitalTwinSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows (web `minSize`). */
    val MIN_SIZE: DigitalTwinSize = DigitalTwinSize(cols = 2, rows = 4)

    /** Maximum footprint: 3 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: DigitalTwinSize = DigitalTwinSize(cols = 3, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: DigitalTwinSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DigitalTwinSize): DigitalTwinSize =
        DigitalTwinSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * Pure projection + state-fold for the Digital Twin surface — the native port of the inline derivations in
 * `DigitalTwinWidget.tsx` and the `buildTwinState` merge in `vehicleState.ts`. [project] turns a decoded
 * [DigitalTwinData] into the render-ready [DigitalTwinDisplay]; [buildTwinState] merges the three raw
 * inputs; [foldState] composes the per-vehicle cache-then-network feeds onto the shared [UiState] surface,
 * and [foldNoVehicle] covers the empty-fleet branch.
 */
object DigitalTwinProjection {
    /**
     * Project [data] into the render model using the localized [strings]. The badge order, tones and labels
     * reproduce the web JSX verbatim; lock + windows badges are always present, the live-status / opening
     * badges only when their reading is engaged.
     */
    fun project(
        data: DigitalTwinData,
        strings: DigitalTwinStrings,
    ): DigitalTwinDisplay {
        val badges = twinBadges(data.twin, strings)
        val label = data.vehicle?.label.orEmpty()
        return DigitalTwinDisplay(
            hasVehicle = data.hasVehicle,
            twin = data.twin,
            vehicleLabel = label,
            exteriorColor = data.vehicle?.exteriorColor,
            badges = badges,
            twinContentDescription = describeTwin(label, badges),
        )
    }

    /**
     * Merge the security snapshot, the typed vehicle [state] and the charging telemetry into one
     * [VehicleTwinState] — the native port of `buildTwinState`. A wholly absent triple yields
     * [VehicleTwinState.EMPTY] (web `if (!security && !vehicleState && !charging) return EMPTY`). Security
     * corner fields prefer the typed boolean, falling back to the `windows_open` summary string; lock /
     * sentry prefer the security value then the vehicle-state envelope.
     */
    fun buildTwinState(
        security: JsonElement?,
        state: VehicleState?,
        charging: JsonElement?,
    ): VehicleTwinState {
        val sec = security as? JsonObject
        val chargingObj = charging as? JsonObject
        if (sec == null && state == null && chargingObj == null) return VehicleTwinState.EMPTY

        val doors = parseDoorState(sec?.get(FIELD_DOOR_STATE) ?: sec?.get(FIELD_DOORS_OPEN))
        val chargingActive = isChargingActive(state, chargingObj)
        val windowsOpen = sec?.get(FIELD_WINDOWS_OPEN)
        return VehicleTwinState(
            doors = doors,
            windowFD = resolveWindow(sec?.get(FIELD_FD_WINDOW), windowsOpen, WINDOW_FD_ALIASES),
            windowFP = resolveWindow(sec?.get(FIELD_FP_WINDOW), windowsOpen, WINDOW_FP_ALIASES),
            windowRD = resolveWindow(sec?.get(FIELD_RD_WINDOW), windowsOpen, WINDOW_RD_ALIASES),
            windowRP = resolveWindow(sec?.get(FIELD_RP_WINDOW), windowsOpen, WINDOW_RP_ALIASES),
            frunkOpen = doors.trunkFront,
            trunkOpen = doors.trunkRear,
            chargePortOpen = boolField(chargingObj, FIELD_CHARGE_PORT_DOOR_OPEN) ?: chargePortFallback(chargingActive),
            isCharging = chargingActive,
            isDriving = isVehicleDriving(state),
            locked = boolField(sec, FIELD_LOCKED) ?: state?.isLocked,
            sentryMode = boolField(sec, FIELD_SENTRY_MODE) ?: state?.sentryMode,
            headlights = boolField(sec, FIELD_LIGHTS_HIGH_BEAMS),
            hazards = boolField(sec, FIELD_LIGHTS_HAZARDS),
            turnSignal = parseTurnSignal(sec?.get(FIELD_LIGHTS_TURN_SIGNAL)),
            driverSeatOccupied = boolField(sec, FIELD_DRIVER_SEAT_OCCUPIED),
        )
    }

    /**
     * Fold the resolved vehicle's three cache-then-network feeds onto one lifecycle-aware [UiState]. A first
     * load of the state OR security feed renders the skeleton (web `isLoading = stateLoading ||
     * securityLoading`); otherwise the twin always renders (web `vehicle ? … : empty` — a known vehicle is
     * content even when every reading is unknown). A hard failure is surfaced through the freshness chip
     * (stale / offline) keeping the last-known twin visible, never a blank panel.
     */
    fun foldState(
        vehicle: TwinVehicle,
        stateRes: Resource<VehicleStateEnvelope>,
        securityRes: Resource<JsonElement>,
        chargingRes: Resource<JsonElement>,
    ): UiState<DigitalTwinData> {
        val core = listOf(stateRes, securityRes)
        if (core.any { it is Resource.Loading && it.cached == null }) return UiState.loading()

        val twin = buildTwinState(securityRes.cached, stateRes.cached?.state, chargingRes.cached)
        val all = listOf(stateRes, securityRes, chargingRes)
        val errorRes = all.firstNotNullOfOrNull { it as? Resource.Error<*> }
        return UiState(
            phase = UiPhase.Content,
            data = DigitalTwinData(vehicle = vehicle, twin = twin),
            fetchedAt = all.mapNotNull(::fetchedAtOf).maxOrNull()?.takeIf { it > 0L },
            stale = all.any { it.stale } || errorRes != null,
            refreshing = all.any { it is Resource.Loading },
            errorKind = errorRes?.let { errorKindOf(it.error) },
            httpStatus = errorRes?.let { httpStatusOf(it.error) },
        )
    }

    /**
     * The fold for the empty-fleet branch (web `vehicle` undefined ⇒ the per-vehicle feeds stay disabled).
     * While the fleet list is still loading with nothing cached the surface shows its skeleton; once the
     * fleet resolves to no vehicle (or fails) the surface shows its "No vehicle data" empty state, flagging
     * the freshness chip stale / offline when the fleet read itself errored — never a blank panel.
     */
    fun foldNoVehicle(vehiclesRes: Resource<List<Vehicle>>): UiState<DigitalTwinData> {
        if (vehiclesRes is Resource.Loading && vehiclesRes.cached == null) return UiState.loading()
        val errorRes = vehiclesRes as? Resource.Error<*>
        return UiState(
            phase = UiPhase.Empty,
            data = DigitalTwinData.EMPTY,
            fetchedAt = fetchedAtOf(vehiclesRes)?.takeIf { it > 0L },
            stale = vehiclesRes.stale || errorRes != null,
            refreshing = vehiclesRes is Resource.Loading,
            errorKind = errorRes?.let { errorKindOf(it.error) },
            httpStatus = errorRes?.let { httpStatusOf(it.error) },
        )
    }

    // ── badge derivation (web JSX `<Badge>` block) ──────────────────────────────────────────────────────

    private fun twinBadges(
        twin: VehicleTwinState,
        strings: DigitalTwinStrings,
    ): List<TwinBadge> {
        val windows = windowSummary(twin)
        val openDoors = openDoorCount(twin.doors)
        return buildList {
            add(TwinBadge(lockLabel(twin.locked, strings), lockTone(twin.locked), dot = false))
            add(TwinBadge(windowLabel(windows, strings), windowTone(windows), dot = false))
            if (twin.isDriving) add(TwinBadge(strings.driving, TwinBadgeTone.Info, dot = true))
            if (twin.isCharging) add(TwinBadge(strings.charging, TwinBadgeTone.Info, dot = true))
            if (twin.sentryMode == true) add(TwinBadge(strings.sentryOn, TwinBadgeTone.Warning, dot = true))
            if (twin.headlights == true) add(TwinBadge(strings.headlightsOn, TwinBadgeTone.Neutral, dot = true))
            if (twin.hazards == true) add(TwinBadge(strings.hazardsOn, TwinBadgeTone.Warning, dot = true))
            if (openDoors > 0) add(TwinBadge("$openDoors ${strings.doorsOpen}", TwinBadgeTone.Warning, dot = false))
            if (twin.frunkOpen == true) add(TwinBadge(strings.frunkOpen, TwinBadgeTone.Warning, dot = false))
            if (twin.trunkOpen == true) add(TwinBadge(strings.trunkOpen, TwinBadgeTone.Warning, dot = false))
        }
    }

    private fun lockLabel(
        locked: Boolean?,
        strings: DigitalTwinStrings,
    ): String =
        when (locked) {
            null -> strings.lockUnknown
            true -> strings.locked
            false -> strings.unlocked
        }

    private fun lockTone(locked: Boolean?): TwinBadgeTone =
        when (locked) {
            null -> TwinBadgeTone.Neutral
            true -> TwinBadgeTone.Success
            false -> TwinBadgeTone.Danger
        }

    private fun windowLabel(
        windows: WindowSummary,
        strings: DigitalTwinStrings,
    ): String =
        when {
            !windows.hasData -> strings.windowsUnknown
            windows.openCount == 0 -> strings.windowsClosed
            else -> "${windows.openCount} ${strings.windowsOpen}"
        }

    private fun windowTone(windows: WindowSummary): TwinBadgeTone =
        when {
            !windows.hasData -> TwinBadgeTone.Neutral
            windows.openCount == 0 -> TwinBadgeTone.Success
            else -> TwinBadgeTone.Warning
        }

    /** Open side-door count — web `[driverFront, passengerFront, driverRear, passengerRear].filter(Boolean)`. */
    fun openDoorCount(doors: TwinDoors): Int =
        listOf(doors.driverFront, doors.passengerFront, doors.driverRear, doors.passengerRear).count { it == true }

    /** Summarise the four window corners (web `windowStates` derivations). */
    fun windowSummary(twin: VehicleTwinState): WindowSummary {
        val windows = listOf(twin.windowFD, twin.windowFP, twin.windowRD, twin.windowRP)
        val hasData = windows.any { it != WindowOpenState.Unknown }
        val openCount = windows.count { it != WindowOpenState.Unknown && it != WindowOpenState.Closed }
        return WindowSummary(hasData = hasData, openCount = openCount)
    }

    private fun describeTwin(
        label: String,
        badges: List<TwinBadge>,
    ): String = (listOf(label).filter { it.isNotEmpty() } + badges.map { it.text }).joinToString(", ")

    // ── raw-input parsers (web `vehicleState.ts`) ───────────────────────────────────────────────────────

    /**
     * Decode the compound `DoorState` value — the native port of the web `parseDoorState`. Accepts a native
     * JSON object, the "all closed" shorthands, a JSON object serialized as a string, or a descriptive enum
     * string; anything unknown reads as [TwinDoors.UNKNOWN].
     */
    fun parseDoorState(value: JsonElement?): TwinDoors =
        when (value) {
            is JsonObject -> doorsFromObject(value)
            else -> doorsFromString(jsonString(value)?.trim().orEmpty())
        }

    /**
     * Parse a single window corner string — the native port of the web `parseWindowState`. Returns `null`
     * (web's `WindowState` null) when the value is not a decodable string so the caller can fall back to the
     * `windows_open` summary.
     */
    fun parseWindowState(value: JsonElement?): WindowOpenState? {
        val raw = jsonString(value) ?: return null
        return windowFromEnum(parseWindowEnum(raw)) ?: windowFromHeuristics(raw.lowercase())
    }

    /**
     * Parse the per-corner state out of the `windows_open` summary string — the native port of the web
     * `parseWindowOpenSummary`. A recognised closed token yields [WindowOpenState.Closed]; any matching
     * corner alias yields [WindowOpenState.Open]; anything else yields `null` (unknown).
     */
    fun parseWindowOpenSummary(
        value: JsonElement?,
        aliases: List<String>,
    ): WindowOpenState? {
        val normalized = jsonString(value)?.lowercase() ?: return null
        return when {
            normalized in WINDOW_CLOSED_TOKENS -> WindowOpenState.Closed
            aliases.any { normalized.contains(it) } -> WindowOpenState.Open
            else -> null
        }
    }

    /** Parse the turn-signal value — the native port of the web `parseTurnSignal`. */
    fun parseTurnSignal(value: JsonElement?): TurnSignalState {
        val lower = jsonString(value)?.lowercase()?.replace(TURN_SIGNAL_STRIP, "") ?: return TurnSignalState.Unknown
        return when {
            lower.contains("both") -> TurnSignalState.Both
            lower.contains("left") -> TurnSignalState.Left
            lower.contains("right") -> TurnSignalState.Right
            lower.isEmpty() || lower == "0" || lower.contains("off") -> TurnSignalState.Off
            else -> TurnSignalState.Unknown
        }
    }

    /** Whether the vehicle is driving — web `state?.toLowerCase() === 'driving' || (speed ?? 0) > 0`. */
    fun isVehicleDriving(state: VehicleState?): Boolean = state != null && (state.state.lowercase() == STATE_DRIVING || state.speed > 0.0)

    /**
     * Whether charging is active — the native port of the web `isChargingActive`: the vehicle-state
     * `is_charging`/`charger_power` flags OR the telemetry `charger_power_kw`/normalised `charging_state`.
     */
    fun isChargingActive(
        state: VehicleState?,
        charging: JsonObject?,
    ): Boolean {
        val normalized = jsonString(charging?.get(FIELD_CHARGING_STATE))?.lowercase()?.replace(CHARGE_STATE_STRIP, "").orEmpty()
        val signals =
            listOf(
                state?.isCharging == true,
                (state?.chargerPower ?: 0.0) > 0.0,
                (numberField(charging, FIELD_CHARGER_POWER_KW) ?: 0.0) > 0.0,
                normalized == CHARGE_STATE_CHARGING,
                normalized == CHARGE_STATE_STARTING,
            )
        return signals.any { it }
    }

    // ── decode helpers ──────────────────────────────────────────────────────────────────────────────────

    private fun resolveWindow(
        corner: JsonElement?,
        windowsOpen: JsonElement?,
        aliases: List<String>,
    ): WindowOpenState = parseWindowState(corner) ?: parseWindowOpenSummary(windowsOpen, aliases) ?: WindowOpenState.Unknown

    private fun doorsFromString(raw: String): TwinDoors {
        if (raw.isEmpty()) return TwinDoors.UNKNOWN
        val lower = raw.lowercase()
        return when {
            lower in CLOSED_DOOR_SHORTHANDS -> TwinDoors.ALL_CLOSED
            raw.startsWith("{") -> parseDoorJson(raw, lower)
            else -> doorsFromDescriptive(lower)
        }
    }

    private fun parseDoorJson(
        raw: String,
        lower: String,
    ): TwinDoors {
        val obj = runCatching { LENIENT_JSON.parseToJsonElement(raw) as? JsonObject }.getOrNull()
        return obj?.let { doorsFromObject(it) } ?: doorsFromDescriptive(lower)
    }

    private fun doorsFromObject(obj: JsonObject): TwinDoors =
        TwinDoors(
            driverFront = doorField(obj, KEY_DRIVER_FRONT_P, KEY_DRIVER_FRONT_S),
            passengerFront = doorField(obj, KEY_PASSENGER_FRONT_P, KEY_PASSENGER_FRONT_S),
            driverRear = doorField(obj, KEY_DRIVER_REAR_P, KEY_DRIVER_REAR_S),
            passengerRear = doorField(obj, KEY_PASSENGER_REAR_P, KEY_PASSENGER_REAR_S),
            trunkFront = doorField(obj, KEY_TRUNK_FRONT_P, KEY_TRUNK_FRONT_S),
            trunkRear = doorField(obj, KEY_TRUNK_REAR_P, KEY_TRUNK_REAR_S),
        )

    private fun doorsFromDescriptive(lower: String): TwinDoors =
        TwinDoors(
            driverFront = descriptiveOpen(lower.contains("driver") && lower.contains("front")),
            passengerFront = descriptiveOpen(lower.contains("passenger") && lower.contains("front")),
            driverRear = descriptiveOpen((lower.contains("driver") && lower.contains("rear")) || lower.contains("driverrear")),
            passengerRear =
                descriptiveOpen((lower.contains("passenger") && lower.contains("rear")) || lower.contains("passengerrear")),
            trunkFront = descriptiveOpen(matchesFrunk(lower)),
            trunkRear = descriptiveOpen(matchesTrunkRear(lower)),
        )

    private fun matchesFrunk(lower: String): Boolean = FRUNK_TOKENS.any { lower.contains(it) }

    private fun matchesTrunkRear(lower: String): Boolean {
        val explicit = TRUNK_REAR_TOKENS.any { lower.contains(it) }
        val bareTrunk = lower.contains("trunk") && !lower.contains("frunk") && !lower.contains("front")
        return explicit || bareTrunk
    }

    // A descriptive segment marks a corner open only on a positive match; web leaves non-matches `null`.
    private fun descriptiveOpen(matched: Boolean): Boolean? = if (matched) true else null

    private fun doorField(
        obj: JsonObject,
        pascalKey: String,
        snakeKey: String,
    ): Boolean? {
        val present = obj[pascalKey]?.takeUnless { it is JsonNull } ?: obj[snakeKey]?.takeUnless { it is JsonNull }
        return present?.let { truthy(it) }
    }

    private fun parseWindowEnum(raw: String): String {
        val g = raw.replace(WINDOW_STATE_STRIP, "")
        return when {
            g.contains("Closed") -> "Closed"
            g.contains("Partial") -> "Partial"
            g.contains("Open") -> "Open"
            else -> g.ifEmpty { raw }
        }
    }

    private fun windowFromEnum(clean: String): WindowOpenState? =
        when (clean) {
            "Closed" -> WindowOpenState.Closed
            "Partial" -> WindowOpenState.Partial
            "Open" -> WindowOpenState.Open
            else -> null
        }

    private fun windowFromHeuristics(lower: String): WindowOpenState? =
        when {
            lower.contains("closed") || lower == "0" -> WindowOpenState.Closed
            lower.contains("partial") || lower.contains("vent") -> WindowOpenState.Partial
            lower.contains("open") -> WindowOpenState.Open
            else -> null
        }

    private fun chargePortFallback(chargingActive: Boolean): Boolean? = if (chargingActive) true else null

    private fun truthy(element: JsonElement): Boolean =
        when {
            element is JsonObject || element is JsonArray -> true
            element is JsonPrimitive && element.isString -> element.content.isNotEmpty()
            element is JsonPrimitive -> element.booleanOrNull ?: ((element.doubleOrNull ?: 0.0) != 0.0)
            else -> false
        }

    private fun boolField(
        obj: JsonObject?,
        key: String,
    ): Boolean? = (obj?.get(key) as? JsonPrimitive)?.booleanOrNull

    private fun numberField(
        obj: JsonObject?,
        key: String,
    ): Double? = (obj?.get(key) as? JsonPrimitive)?.doubleOrNull

    private fun jsonString(value: JsonElement?): String? =
        (value as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotEmpty() }

    private fun fetchedAtOf(res: Resource<*>): Long? =
        when (res) {
            is Resource.Loading -> res.fetchedAt
            is Resource.Success -> res.fetchedAt
            is Resource.Error -> res.fetchedAt
        }
}

/** A folded summary of the four window corners — `hasData` gates the "unknown" badge, `openCount` the value. */
data class WindowSummary(
    val hasData: Boolean,
    val openCount: Int,
)

/**
 * Resolve the active vehicle from the fleet — the native port of the web
 * `vehicleId ? vehicles?.find(v => v.id === vehicleId) ?? vehicles?.[0] : vehicles?.[0]`. A positive
 * [preferredVehicleId] selects that vehicle (falling back to the first), otherwise the first enrolled
 * vehicle wins; an empty fleet yields `null` (the empty state).
 */
fun resolveVehicle(
    vehicles: List<Vehicle>?,
    preferredVehicleId: Long?,
): Vehicle? {
    val list = vehicles?.takeIf { it.isNotEmpty() } ?: return null
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) list.firstOrNull { it.id == preferred } ?: list.first() else list.first()
}

/** Adapt a generated [Vehicle] into the surface's [TwinVehicle] (web `display_name || vin`, `exterior_color`). */
fun Vehicle.toTwinVehicle(): TwinVehicle =
    TwinVehicle(
        id = id,
        label = displayName.ifBlank { vin },
        exteriorColor = color,
    )
