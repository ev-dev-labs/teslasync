// Pure, framework-free metadata + domain model for the CommandsPage system surface — the native analogue of the
// cross-cutting concerns + derivations the web page owns (web/src/features/system/pages/CommandsPage.tsx, the
// remote-control center mounted at /commands). No Compose, no Android framework, no HTTP lives here, so the route
// identity, the fleet roll-up (Vehicles / Online / Asleep counts), the per-vehicle command-center projections, and
// the command-latest JSON decode are all exercised off-device and the composable stays a thin render layer.
//
// The web page reads the `/vehicles` list (web `Vehicle` carries an inline `state` / `battery_level` /
// `battery_range`) and a per-vehicle `/vehicles/{id}/state` map (the `statesMap` it threads into each
// VehicleCommandCenter). The OpenAPI-generated [Vehicle] model carries no `state`/`battery_*` fields, so this port
// sources those three quantities from the SAME per-vehicle state feed the command centers consume — the
// online/asleep roll-up and each command center's vehicle badge therefore agree, and there is no second source of
// truth. Quantities stay SI (ranges in metres, temps in °C, speeds in m/s); the render boundary converts via the
// shared UnitFormatter (S5), never this layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system — the
// P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace
// uses, so the package intentionally diverges from the path — exactly as the sibling dashboard / power-user page
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located registration + recorder + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.commands

import io.teslasync.android.featureviews.vehiclecommandcenter.CommandCenterVehicle
import io.teslasync.android.featureviews.vehiclecommandcenter.CommandCenterVehicleState
import io.teslasync.android.featureviews.vehiclecommandcenter.CommandLogEntry
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Canonical metadata for the CommandsPage surface. The web page is a top-level system route, so this object
 * carries the cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires
 * (already a metadata-only destination at Destinations.kt `page("commands", "/commands", NavGroup.System)`), the
 * diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11), and the in-app deep link the "View
 * History" affordance follows (web `<Link to="/command-history">`).
 */
object CommandsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("commands", "/commands", NavGroup.System)`). */
    const val ROUTE_ID: String = "commands"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/commands"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "CommandsPage"

    /**
     * The in-app deep link the "View History" header action follows — the native analogue of the web
     * `<Link to="/command-history">`. No `NavController` is exposed to page hosts, so the app's own
     * `teslasync://app/{path}` deep-link scheme (AndroidManifest + TeslaSyncNavHost) is the sanctioned
     * forward-navigation seam, opened via `LocalUriHandler`.
     */
    const val COMMAND_HISTORY_DEEP_LINK: String = "teslasync://app/command-history"
}

/**
 * The fixed refresh-cadence label the Refresh metric card shows — the web `value="15s"`, the per-vehicle
 * `refetchInterval: 15_000`. A literal interval, not translatable copy (the web renders it verbatim too).
 */
const val REFRESH_INTERVAL_LABEL: String = "15s"

/** Vehicle lifecycle states that count as NOT online — the web `v.state !== 'asleep' && v.state !== 'offline'`. */
private const val ASLEEP_STATE: String = "asleep"
private const val OFFLINE_STATE: String = "offline"

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no vehicle data. */
internal fun recordCommandsPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to CommandsPageRegistration.SLUG))
}

/**
 * Whether a vehicle's lifecycle [state] counts as online — the web `v.state !== 'asleep' && v.state !== 'offline'`.
 * A `null` state (the per-vehicle state feed has not resolved or hard-errored) is treated as NOT online, so the
 * online roll-up is conservative until each vehicle's state arrives rather than over-counting on a cold start.
 */
fun isVehicleOnline(state: String?): Boolean = state != null && state != ASLEEP_STATE && state != OFFLINE_STATE

/**
 * The fleet roll-up the four metric cards render — web `vehicles.length`, `onlineCount`, and
 * `vehicles.length - onlineCount`.
 *
 * @property vehicleCount enrolled-vehicle count (web Vehicles card).
 * @property onlineCount vehicles whose state is neither asleep nor offline (web Online card).
 * @property asleepCount the remainder (web Asleep card, `(vehicles?.length ?? 0) - onlineCount`).
 */
data class CommandsStats(
    val vehicleCount: Int,
    val onlineCount: Int,
    val asleepCount: Int,
) {
    companion object {
        /** Derive the roll-up from the resolved per-vehicle rows (web `onlineCount` memo over the vehicle list). */
        fun fromRows(rows: List<CommandsVehicleRow>): CommandsStats {
            val total = rows.size
            val online = rows.count { isVehicleOnline(it.state?.state) }
            return CommandsStats(vehicleCount = total, onlineCount = online, asleepCount = total - online)
        }
    }
}

/**
 * One enrolled vehicle paired with its last-known per-vehicle [state] — the native analogue of the web
 * `(vehicle, statesMap[vehicle.id])` pair threaded into each VehicleCommandCenter. [state] is `null` while the
 * `/vehicles/{id}/state` feed is loading or after a hard error (web `states[v.id] ?? null`).
 */
data class CommandsVehicleRow(
    val vehicle: Vehicle,
    val state: VehicleState?,
)

/**
 * The immutable success surface the ViewModel exposes and the page renders — the resolved per-vehicle [rows] plus
 * whether any per-vehicle state read hard-errored ([statesError], which drives the GlassPanel5 error banner, web
 * `{statesError && …}`). The fleet [stats] are derived so the metric cards and the command-center list never drift.
 */
data class CommandsSnapshot(
    val rows: List<CommandsVehicleRow>,
    val statesError: Boolean,
) {
    /** The fleet roll-up the four metric cards render. */
    val stats: CommandsStats get() = CommandsStats.fromRows(rows)

    /** Whether any vehicle is enrolled (web `vehicles && vehicles.length > 0`). */
    val hasVehicles: Boolean get() = rows.isNotEmpty()
}

/**
 * Project an enrolled [vehicle] + its per-vehicle [state] into the [CommandCenterVehicle] the feature view renders
 * — the native analogue of the web `vehicle` prop. The generated [Vehicle] carries no `state`/`battery_*`, so those
 * three come from the per-vehicle state feed (SI metres for range); a `null` state defaults to asleep + zeroed
 * battery so the command center renders its wake-first banner rather than a blank header.
 */
fun toCommandCenterVehicle(
    vehicle: Vehicle,
    state: VehicleState?,
): CommandCenterVehicle =
    CommandCenterVehicle(
        id = vehicle.id,
        vin = vehicle.vin,
        displayName = vehicle.displayName,
        model = vehicle.model.orEmpty(),
        state = state?.state ?: ASLEEP_STATE,
        batteryLevel = state?.batteryLevel?.toInt() ?: 0,
        batteryRange = state?.ratedRange ?: 0.0,
        updatedAt = vehicle.updatedAt.toString(),
    )

/**
 * Project a per-vehicle [state] into the [CommandCenterVehicleState] the feature view renders — the native
 * analogue of the web `state={states[v.id] ?? null}` prop. `null` in ⇒ `null` out (the command center shows its
 * em-dash metrics + no detailed state), exactly as the web threads a missing state. Values stay SI.
 */
fun toCommandCenterVehicleState(state: VehicleState?): CommandCenterVehicleState? =
    state?.let {
        CommandCenterVehicleState(
            batteryLevel = it.batteryLevel.toInt(),
            ratedRange = it.ratedRange,
            isLocked = it.isLocked,
            isCharging = it.isCharging,
            isClimateOn = it.isClimateOn,
            sentryMode = it.sentryMode,
            insideTemp = it.insideTemp,
            speed = it.speed,
        )
    }

/**
 * Decode the raw `GET /vehicles/{id}/commands/latest` body into the [CommandLogEntry] list the feature view's
 * latest-status feed decorates each tile with (web `useQuery(['command-latest', id])` ▸ `CommandLogEntry[]`). A
 * non-array body or a non-object row is skipped; each field falls back to its web-equivalent empty default so a
 * partial row never throws. `params` carries the raw JSON text (web `params: string`).
 */
fun parseCommandLatest(element: JsonElement): List<CommandLogEntry> {
    val array = element as? JsonArray ?: return emptyList()
    return array.mapNotNull { row ->
        val obj = row as? JsonObject ?: return@mapNotNull null
        CommandLogEntry(
            id = obj.longField("id") ?: 0L,
            vehicleId = obj.longField("vehicle_id") ?: 0L,
            command = obj.stringField("command").orEmpty(),
            params = obj.rawField("params").orEmpty(),
            status = obj.stringField("status").orEmpty(),
            error = obj.stringField("error").orEmpty(),
            createdAt = obj.stringField("created_at").orEmpty(),
        )
    }
}

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.longField(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

private fun JsonObject.rawField(key: String): String? =
    when (val value = this[key]) {
        null -> null
        is JsonPrimitive -> value.contentOrNull
        else -> value.toString()
    }

/**
 * Fold the resolved per-vehicle fields into the SAME cache-then-network [Resource] envelope the vehicle-list feed
 * carried, so the bound state holder renders the full data-state matrix (loading → empty → success → error, plus
 * stale/offline) from one source — the page phase tracks the vehicle-list feed (web `PageContainer` loading chrome
 * + the `!vehicles?.length` empty branch), while the per-vehicle states are secondary reads folded into the
 * [CommandsSnapshot]. Pure, so the freshness-preservation contract is unit-tested without a network or cache.
 */
fun commandsSnapshotResource(
    vehicles: Resource<List<Vehicle>>,
    rows: List<CommandsVehicleRow>,
    statesError: Boolean,
): Resource<CommandsSnapshot> {
    val snapshot = CommandsSnapshot(rows = rows, statesError = statesError)
    return when (vehicles) {
        is Resource.Loading ->
            Resource.Loading(
                cached = if (vehicles.cached == null) null else snapshot,
                fetchedAt = vehicles.fetchedAt,
                stale = vehicles.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = snapshot,
                fetchedAt = vehicles.fetchedAt,
                stale = vehicles.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = if (vehicles.cached == null) null else snapshot,
                fetchedAt = vehicles.fetchedAt,
                stale = vehicles.stale,
                error = vehicles.error,
            )
    }
}
