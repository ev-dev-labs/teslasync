// Pure, framework-free model + projection for the Digital Twin Mini dashboard widget — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/DigitalTwinMiniWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The web component composes four hooks (useVehicles, useVehicleState,
// useSecurityLatest, useChargingTelemetryLatest) and merges the latter three into a `VehicleTwinState`
// via `buildTwinState` (web/src/lib/vehicleState.ts); that merge + the two status badges are ported here
// against the typed [VehicleState] + the raw `/security/latest` and `/charging-telemetry/latest` JSON.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DigitalTwinMiniWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path — exactly as the sibling SecurityStatusWidget /
// VehicleHeroCardWidget do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.digitaltwinmini

import io.teslasync.android.sharedsurfaces.vehicletwin.DoorStates
import io.teslasync.android.sharedsurfaces.vehicletwin.EMPTY_TWIN_STATE
import io.teslasync.android.sharedsurfaces.vehicletwin.PaintPalette
import io.teslasync.android.sharedsurfaces.vehicletwin.TurnSignalState
import io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinState
import io.teslasync.android.sharedsurfaces.vehicletwin.WindowState
import io.teslasync.android.sharedsurfaces.vehicletwin.inferPaintFromTesla
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/** The web `'—'` em-dash rendered for the lock badge when the lock state is unknown. */
private const val EM_DASH = "\u2014"

/** The four door/window corner field names the web `buildTwinState` reads off `/security/latest`. */
private const val FIELD_DOOR_STATE = "door_state"
private const val FIELD_DOORS_OPEN = "doors_open"
private const val FIELD_WINDOWS_OPEN = "windows_open"

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * `DigitalTwinMiniWidget` reads `size.cols` / `size.rows` to decide whether the surface is too cramped to
 * show the status badges (web `isCompact`), so this type drives that branch and honours the registry's
 * min/max footprint.
 */
data class DigitalTwinMiniSize(
    val cols: Int,
    val rows: Int,
)

/** Compact footprint (web `size.cols <= 2 && size.rows <= 2`) — the surface is too small for the badges. */
val DigitalTwinMiniSize.isCompact: Boolean get() = cols <= 2 && rows <= 2

/**
 * Whether the status badges are shown at this footprint — the native mirror of the web
 * `!isCompact || size.rows >= 2` gate: hidden only when the surface is compact AND a single row tall.
 */
val DigitalTwinMiniSize.showsBadges: Boolean get() = !isCompact || rows >= 2

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`digital-twin-mini`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object DigitalTwinMiniRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "digital-twin-mini"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DigitalTwinMiniWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val DEFAULT_SIZE: DigitalTwinMiniSize = DigitalTwinMiniSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 4 rows (web `minSize`). */
    val MIN_SIZE: DigitalTwinMiniSize = DigitalTwinMiniSize(cols = 1, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: DigitalTwinMiniSize = DigitalTwinMiniSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: DigitalTwinMiniSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DigitalTwinMiniSize): DigitalTwinMiniSize =
        DigitalTwinMiniSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The localized strings this surface needs — the native mirror of the seven `t('widget.…')` calls the web
 * component makes (`digitalTwinMini`, `open`, `locked`, `unlocked`, `sentryOn`, `sentryOff`, `noVehicle`).
 * Resolved once at the render boundary (P1/S10) and passed into [DigitalTwinMiniProjection] so the
 * projection stays framework-free yet fully localized, exactly as the sibling SecurityStatusWidget does.
 */
data class DigitalTwinMiniStrings(
    val digitalTwin: String,
    val open: String,
    val locked: String,
    val unlocked: String,
    val sentry: String,
    val off: String,
    val noVehicle: String,
)

/**
 * The four cache-then-network feeds the widget composes, folded into one render payload: the resolved
 * [vehicle] (web `useVehicles` → `vehicles?.find/[0]`, the source of identity + exterior colour), its
 * last-known [vehicleState] (web `useVehicleState`), and the raw latest [security] + [charging] snapshots
 * (web `useSecurityLatest` / `useChargingTelemetryLatest`). A `null` [vehicle] is the widget's empty
 * surface (web `vehicle ? … : <EmptyState/>`); the three telemetry sources are merged into the twin via
 * [buildVehicleTwinState], all `null`-tolerant so the silhouette still renders before telemetry arrives.
 */
data class DigitalTwinMiniData(
    val vehicle: Vehicle?,
    val vehicleState: VehicleState?,
    val security: JsonElement?,
    val charging: JsonElement?,
)

/** The tone of a status badge — the native analogue of the web `Badge` `variant` union. */
enum class BadgeTone { Success, Danger, Info, Neutral }

/**
 * The lock status chip — the native analogue of the web lock `<Badge>`: it is always shown, switching its
 * tone (danger when unlocked, success otherwise — web `locked === false ? 'danger' : 'success'`), its
 * leading glyph ([unlocked] → an open padlock), and its [text] (`Unlocked` / `Locked` / `—`).
 */
data class LockBadge(
    val tone: BadgeTone,
    val text: String,
    val unlocked: Boolean,
)

/**
 * The sentry status chip — the native analogue of the web sentry `<Badge>`, rendered only when the sentry
 * state is known (web `twinState.sentryMode != null`): info-toned + `Sentry` when armed, neutral + `Off`
 * otherwise.
 */
data class SentryBadge(
    val tone: BadgeTone,
    val text: String,
    val on: Boolean,
)

/**
 * The fully projected, render-ready view of the twin — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested
 * directly: the merged physical [twinState] the canvas draws, the resolved [paint] (web
 * `exteriorColor` → `useVehiclePaint`), the always-present [lockBadge], and the conditional
 * [sentryBadge]. Each badge stays an individually-readable chip, so no merged row description is needed.
 */
data class DigitalTwinMiniDisplay(
    val twinState: VehicleTwinState,
    val paint: PaintPalette,
    val lockBadge: LockBadge,
    val sentryBadge: SentryBadge?,
)

/**
 * Pure projection from a resolved [DigitalTwinMiniData] to the render-ready [DigitalTwinMiniDisplay] — the
 * native port of the inline derivation the web component performs (`buildTwinState` + the two badge
 * ternaries). The merge is `null`-tolerant: a missing snapshot simply yields the neutral silhouette state
 * rather than hiding the surface, exactly as the web `VehicleTwin` always renders.
 */
object DigitalTwinMiniProjection {
    /** Project [data] using the localized [strings]. The twin silhouette is drawn for every data shape. */
    fun project(
        data: DigitalTwinMiniData,
        strings: DigitalTwinMiniStrings,
    ): DigitalTwinMiniDisplay {
        val twin = buildVehicleTwinState(data.security, data.vehicleState, data.charging)
        val paint = inferPaintFromTesla(data.vehicle?.color)
        val lockBadge = lockBadge(twin.locked, strings)
        val sentryBadge = twin.sentryMode?.let { sentryBadge(it, strings) }
        return DigitalTwinMiniDisplay(
            twinState = twin,
            paint = paint,
            lockBadge = lockBadge,
            sentryBadge = sentryBadge,
        )
    }

    /**
     * The lock chip (web: `variant={locked === false ? 'danger' : 'success'}`, text
     * `locked === false ? unlocked : locked ? locked : '—'`). A `null` lock state shows the success tone
     * with an em-dash label and the closed-padlock glyph (web's `'—'` branch).
     */
    private fun lockBadge(
        locked: Boolean?,
        strings: DigitalTwinMiniStrings,
    ): LockBadge =
        LockBadge(
            tone = if (locked == false) BadgeTone.Danger else BadgeTone.Success,
            text =
                when (locked) {
                    false -> strings.unlocked
                    true -> strings.locked
                    null -> EM_DASH
                },
            unlocked = locked == false,
        )

    /** The sentry chip (web: `variant={sentryMode ? 'info' : 'neutral'}`, text `sentryMode ? 'Sentry' : 'Off'`). */
    private fun sentryBadge(
        sentryMode: Boolean,
        strings: DigitalTwinMiniStrings,
    ): SentryBadge =
        SentryBadge(
            tone = if (sentryMode) BadgeTone.Info else BadgeTone.Neutral,
            text = if (sentryMode) strings.sentry else strings.off,
            on = sentryMode,
        )
}

// ── Twin-state merge (web src/lib/vehicleState.ts buildTwinState) ─────────────────────────────────────────────

/**
 * Merges the latest `/security/latest` + typed [VehicleState] + `/charging-telemetry/latest` into the
 * physical [VehicleTwinState] the twin draws — the native port of the web `buildTwinState`
 * (web/src/lib/vehicleState.ts). All three inputs are `null`-tolerant; when every source is absent the
 * neutral [EMPTY_TWIN_STATE] silhouette is returned (web `if (!security && !vehicleState && !charging)`).
 */
fun buildVehicleTwinState(
    security: JsonElement?,
    vehicleState: VehicleState?,
    charging: JsonElement?,
): VehicleTwinState {
    val sec = security as? JsonObject
    val chg = charging as? JsonObject
    if (sec == null && vehicleState == null && chg == null) return EMPTY_TWIN_STATE

    val doors = parseDoorState(sec?.get(FIELD_DOOR_STATE) ?: sec?.get(FIELD_DOORS_OPEN))
    val active = chargingActive(vehicleState, chg)
    val windowsOpen = sec?.get(FIELD_WINDOWS_OPEN)
    return VehicleTwinState(
        doors = doors,
        windowFD = windowFor(sec?.get("fd_window"), windowsOpen, FD_WINDOW_ALIASES),
        windowFP = windowFor(sec?.get("fp_window"), windowsOpen, FP_WINDOW_ALIASES),
        windowRD = windowFor(sec?.get("rd_window"), windowsOpen, RD_WINDOW_ALIASES),
        windowRP = windowFor(sec?.get("rp_window"), windowsOpen, RP_WINDOW_ALIASES),
        frunkOpen = doors.trunkFront,
        trunkOpen = doors.trunkRear,
        chargePortOpen = strictBool(chg?.get("charge_port_door_open")) ?: if (active) true else null,
        isCharging = active,
        isDriving = isVehicleDriving(vehicleState),
        locked = strictBool(sec?.get("locked")) ?: vehicleState?.isLocked,
        sentryMode = strictBool(sec?.get("sentry_mode")) ?: vehicleState?.sentryMode,
        headlights = strictBool(sec?.get("lights_high_beams")),
        hazards = strictBool(sec?.get("lights_hazards_active")),
        turnSignal = parseTurnSignal(sec?.get("lights_turn_signal")),
        driverSeatOccupied = strictBool(sec?.get("driver_seat_occupied")),
    )
}

private val FD_WINDOW_ALIASES = listOf("fd", "front driver", "driver front", "driver_front")
private val FP_WINDOW_ALIASES = listOf("fp", "front passenger", "passenger front", "passenger_front")
private val RD_WINDOW_ALIASES = listOf("rd", "rear driver", "driver rear", "driver_rear")
private val RP_WINDOW_ALIASES = listOf("rp", "rear passenger", "passenger rear", "passenger_rear")

private val WHITESPACE_OR_SEP = Regex("[\\s_-]")
private val LENIENT_JSON =
    Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

/**
 * Whether the vehicle is actively charging — the native port of the web `isChargingActive`:
 * `is_charging` true, OR positive `charger_power` (kW), OR positive `charger_power_kw` from the charging
 * snapshot, OR a `charging_state` of `charging` / `starting` (whitespace/underscore/dash stripped).
 */
internal fun chargingActive(
    vehicleState: VehicleState?,
    charging: JsonObject?,
): Boolean {
    val normalizedState =
        (charging?.get("charging_state") as? JsonPrimitive)
            ?.takeIf { it.isString }
            ?.content
            ?.lowercase()
            ?.replace(WHITESPACE_OR_SEP, "")
            .orEmpty()
    val chargerPowerKw = numberOrNull(charging?.get("charger_power_kw")) ?: 0.0
    return vehicleState?.isCharging == true ||
        (vehicleState?.chargerPower ?: 0.0) > 0.0 ||
        chargerPowerKw > 0.0 ||
        normalizedState == "charging" ||
        normalizedState == "starting"
}

/** Whether the vehicle is driving — the native port of web `isVehicleDriving` (state `driving` or speed > 0). */
internal fun isVehicleDriving(vehicleState: VehicleState?): Boolean {
    if (vehicleState == null) return false
    return vehicleState.state.lowercase() == "driving" || vehicleState.speed > 0.0
}

/**
 * The resolved window state for one corner — the native port of the web
 * `parseWindowState(corner) ?? parseWindowOpenSummary(windows_open, aliases)`: the dedicated corner field
 * wins, and only when it is unknown does the compound `windows_open` summary string drive the fallback.
 */
internal fun windowFor(
    corner: JsonElement?,
    windowsOpen: JsonElement?,
    aliases: List<String>,
): WindowState {
    val primary = parseWindowState(corner)
    return if (primary != WindowState.Unknown) primary else parseWindowOpenSummary(windowsOpen, aliases)
}

/**
 * Parses a single window field into a [WindowState] — the native port of the web `parseWindowState`
 * fallback heuristics: only a non-empty string is classified (`closed`/`0` → Closed, contains
 * `partial`/`vent` → Partial, contains `open` → Open); anything else is [WindowState.Unknown].
 */
@Suppress("ReturnCount") // Faithful guard-clause port of the web helper; flattening would obscure the parity mapping.
internal fun parseWindowState(value: JsonElement?): WindowState {
    val raw = asNonEmptyString(value) ?: return WindowState.Unknown
    val lower = raw.lowercase()
    if (lower.contains("closed") || lower == "0") return WindowState.Closed
    if (lower.contains("partial") || lower.contains("vent")) return WindowState.Partial
    if (lower.contains("open")) return WindowState.Open
    return WindowState.Unknown
}

/**
 * The compound-summary window fallback — the native port of web `parseWindowOpenSummary`:
 * `closed`/`none`/`[]`/`false` → Closed; otherwise Open when the summary mentions one of the corner
 * [aliases], else [WindowState.Unknown].
 */
@Suppress("ReturnCount") // Faithful guard-clause port of the web helper.
internal fun parseWindowOpenSummary(
    windowsOpen: JsonElement?,
    aliases: List<String>,
): WindowState {
    val raw = asNonEmptyString(windowsOpen) ?: return WindowState.Unknown
    val normalized = raw.lowercase()
    if (normalized in CLOSED_SUMMARY_TOKENS) return WindowState.Closed
    return if (aliases.any { normalized.contains(it) }) WindowState.Open else WindowState.Unknown
}

private val CLOSED_SUMMARY_TOKENS = setOf("closed", "none", "[]", "false")

/**
 * Normalises a turn-signal field into a [TurnSignalState] — the native port of web `parseTurnSignal`:
 * the `turnsignal` token is stripped, then `both` / `left` / `right` are matched, with `off` / empty / `0`
 * reading as [TurnSignalState.Off] and anything else [TurnSignalState.Unknown].
 */
@Suppress("ReturnCount") // Faithful guard-clause port of the web helper.
internal fun parseTurnSignal(value: JsonElement?): TurnSignalState {
    val raw = asNonEmptyString(value) ?: return TurnSignalState.Unknown
    val lower = raw.lowercase().replace("turnsignal", "")
    if (lower.contains("both")) return TurnSignalState.Both
    if (lower.contains("left")) return TurnSignalState.Left
    if (lower.contains("right")) return TurnSignalState.Right
    if (lower.contains("off") || lower.isEmpty() || lower == "0") return TurnSignalState.Off
    return TurnSignalState.Unknown
}

/**
 * Parses the compound `door_state` (or `doors_open`) value into the six door booleans — the native port
 * of the web `parseDoorState`: it accepts a native object payload, the `closed`/`none`/`[]`/`0`/`false`
 * shorthands, a JSON object serialised as a string, and the descriptive `OpenDriverFront`-style tokens,
 * defaulting each unknown corner to `null` (never assumed closed).
 */
@Suppress("ReturnCount") // Faithful guard-clause port of the multi-shape web helper.
internal fun parseDoorState(value: JsonElement?): DoorStates {
    (value as? JsonObject)?.let { return doorsFromObject(it) }

    val raw = asNonEmptyString(value)?.trim() ?: return DoorStates()
    if (raw.isEmpty()) return DoorStates()

    val lower = raw.lowercase()
    if (lower in ALL_CLOSED_TOKENS) return ALL_DOORS_CLOSED
    if (raw.startsWith("{")) parseJsonObject(raw)?.let { return doorsFromObject(it) }
    return descriptiveDoors(lower)
}

private val ALL_CLOSED_TOKENS = setOf("closedall", "closed", "none", "[]", "0", "false")

/** The `closed`/`none`/`[]`/`0`/`false` shorthand result (web): the four cabin doors closed, trunks unknown. */
private val ALL_DOORS_CLOSED =
    DoorStates(
        driverFront = false,
        passengerFront = false,
        driverRear = false,
        passengerRear = false,
        trunkFront = null,
        trunkRear = null,
    )

private val FRUNK_TOKENS = listOf("frunk", "fronttrunk", "front_trunk", "trunkfront", "trunk_front")
private val REAR_TRUNK_TOKENS = listOf("reartrunk", "rear_trunk", "trunkrear", "trunk_rear", "liftgate")

/**
 * The descriptive-token door reader (web `OpenDriverFront`-style strings): each corner is `true` when its
 * tokens appear, else `null`. A bare `trunk` (not `frunk`/`front`) reads as the rear trunk (web fallback).
 */
private fun descriptiveDoors(lower: String): DoorStates {
    val bareTrunk = lower.contains("trunk") && !lower.contains("frunk") && !lower.contains("front")
    return DoorStates(
        driverFront = trueOrNull(lower.contains("driver") && lower.contains("front")),
        passengerFront = trueOrNull(lower.contains("passenger") && lower.contains("front")),
        driverRear = trueOrNull((lower.contains("driver") && lower.contains("rear")) || lower.contains("driverrear")),
        passengerRear = trueOrNull((lower.contains("passenger") && lower.contains("rear")) || lower.contains("passengerrear")),
        trunkFront = trueOrNull(FRUNK_TOKENS.any { lower.contains(it) }),
        trunkRear = trueOrNull(REAR_TRUNK_TOKENS.any { lower.contains(it) } || bareTrunk),
    )
}

/** Reads the six door corners from a JSON object, preferring the PascalCase keys then the snake_case ones. */
private fun doorsFromObject(obj: JsonObject): DoorStates =
    DoorStates(
        driverFront = objectDoor(obj, "DriverFront", "driver_front"),
        passengerFront = objectDoor(obj, "PassengerFront", "passenger_front"),
        driverRear = objectDoor(obj, "DriverRear", "driver_rear"),
        passengerRear = objectDoor(obj, "PassengerRear", "passenger_rear"),
        trunkFront = objectDoor(obj, "TrunkFront", "trunk_front"),
        trunkRear = objectDoor(obj, "TrunkRear", "trunk_rear"),
    )

/** One door corner from a JSON object (web `parsed.X != null ? Boolean(parsed.X) : (parsed.x != null ? … : null)`). */
private fun objectDoor(
    obj: JsonObject,
    pascalKey: String,
    snakeKey: String,
): Boolean? = (obj[pascalKey]?.takeUnless { it is JsonNull } ?: obj[snakeKey]?.takeUnless { it is JsonNull })?.let { jsTruthy(it) }

private fun parseJsonObject(text: String): JsonObject? = runCatching { LENIENT_JSON.parseToJsonElement(text) as? JsonObject }.getOrNull()

// ── JSON value helpers ───────────────────────────────────────────────────────────────────────────────────────

/** The string content of [value] when it is a non-blank JSON string, else `null` (web `asNonEmptyString`). */
internal fun asNonEmptyString(value: JsonElement?): String? =
    (value as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }

/** A strictly-boolean JSON field (web `?? null`): a real JSON boolean carries through, anything else is `null`. */
internal fun strictBool(value: JsonElement?): Boolean? = (value as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull

/** A numeric JSON field as a [Double], or `null` when absent / non-numeric. */
private fun numberOrNull(value: JsonElement?): Double? = (value as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull

/** JavaScript `Boolean(value)` truthiness for a JSON element (used when reading a door object's fields). */
private fun jsTruthy(value: JsonElement): Boolean {
    val primitive = value as? JsonPrimitive ?: return true
    return when {
        primitive.isString -> primitive.content.isNotEmpty()
        else -> primitive.booleanOrNull ?: primitive.doubleOrNull?.let { it != 0.0 } ?: true
    }
}

/** `true` when [condition] holds, else `null` — the descriptive-door tokens map a non-match to "unknown". */
private fun trueOrNull(condition: Boolean): Boolean? = if (condition) true else null

// ── Active-vehicle resolution (web vehicleId ?? vehicles?.[0]?.id) ─────────────────────────────────────────────

/**
 * The active vehicle the widget renders — the native port of the web
 * `vehicleId ? vehicles?.find(...) ?? vehicles?.[0] : vehicles?.[0]`: a positive [preferredVehicleId]
 * picks that vehicle (falling back to the first when it is not enrolled), otherwise the first enrolled
 * vehicle; `null` when nothing is enrolled (the surface shows its empty state).
 */
fun resolveVehicle(
    vehicles: List<Vehicle>?,
    preferredVehicleId: Long?,
): Vehicle? {
    val list = vehicles?.takeIf { it.isNotEmpty() } ?: return null
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) list.firstOrNull { it.id == preferred } ?: list.first() else list.first()
}

/** Empty predicate for [DigitalTwinMiniData]: no resolving vehicle ⇒ the friendly empty state. */
fun isDigitalTwinMiniEmpty(data: DigitalTwinMiniData): Boolean = data.vehicle == null
