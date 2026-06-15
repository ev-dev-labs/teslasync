// Pure, framework-free model + projections for the GlancePage dashboard surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/dashboard/pages/GlancePage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core
// Vehicle / VehicleState DTOs, the cache-then-network Resource, and kotlinx JSON), so the composable stays a thin
// render layer and this logic is unit-testable off-device.
//
// The web page owns five concerns this file ports: (1) the target-vehicle resolution (web
// `vehicleId ?? vehicles?.[0]`); (2) the location-label derivation (web `getLocationLabel`); (3) the battery
// color band feeding the RadialGauge (web `batteryColor` thresholds with a muted no-state fallback); (4) the
// online gate driving the quick-action buttons (web `isOnline`); and (5) the lock/climate command-name toggles
// (web `state?.is_locked ? 'unlock' : 'lock'`, `'climate_on'/'climate_off'`). The single resolved [GlanceSnapshot]
// is what the page renders; [glanceResource] folds the vehicle-list freshness (loading/empty/error/success/stale)
// around it so the bound state holder can drive the full data-state matrix.
//
// SI boundary (unit-conversion instructions): NO unit conversion happens here — ranges stay in meters and temps
// in degrees Celsius exactly as the API serves them; the render layer converts at its display boundary via the
// shared UnitFormatter (web `useUnits`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.glance

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `GlancePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `standalone("glance", "/glance", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to that
 * destination (and its `/glance` deep link) without the nav module depending on it.
 */
object GlancePageRegistration {
    /** The navigation destination id (Destinations.kt `standalone("glance", "/glance", …)`). */
    const val ROUTE_ID: String = "glance"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/glance"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "GlancePage"
}

// ── Vehicle command names (web GlancePage `sendCommand.mutate({ command })`) ───────────────────────────────────

/** The Tesla command strings the quick-actions dispatch, byte-for-byte the web GlancePage command literals. */
object GlanceCommands {
    const val LOCK: String = "lock"
    const val UNLOCK: String = "unlock"
    const val CLIMATE_ON: String = "climate_on"
    const val CLIMATE_OFF: String = "climate_off"
    const val HORN: String = "honk_horn"
}

/** Lock vs unlock target — web `state?.is_locked ? 'unlock' : 'lock'`. */
fun lockCommandFor(isLocked: Boolean): String = if (isLocked) GlanceCommands.UNLOCK else GlanceCommands.LOCK

/** Climate-off vs climate-on target — web `state?.is_climate_on ? 'climate_off' : 'climate_on'`. */
fun climateCommandFor(isClimateOn: Boolean): String =
    if (isClimateOn) GlanceCommands.CLIMATE_OFF else GlanceCommands.CLIMATE_ON

/** The set of command names whose in-flight dispatch should spin the lock quick-action. */
val LOCK_COMMANDS: Set<String> = setOf(GlanceCommands.LOCK, GlanceCommands.UNLOCK)

/** The set of command names whose in-flight dispatch should spin the climate quick-action. */
val CLIMATE_COMMANDS: Set<String> = setOf(GlanceCommands.CLIMATE_ON, GlanceCommands.CLIMATE_OFF)

// ── Online gate (web `isOnline`) ───────────────────────────────────────────────────────────────────────────────

/** Web `state?.state === 'online' || state?.state === 'parked'` — the vehicle states that accept commands. */
fun isVehicleOnline(stateValue: String?): Boolean = stateValue == ONLINE_STATE || stateValue == PARKED_STATE

private const val ONLINE_STATE = "online"
private const val PARKED_STATE = "parked"

// ── Battery color band (web `batteryColor` thresholds, muted no-state fallback) ─────────────────────────────────

/**
 * The state-of-charge color band feeding the RadialGauge — the native analogue of the web `batteryColor`
 * thresholds (`> 50` green, `> 20` amber, otherwise red) plus an [Unknown] band for the no-state case (web's
 * `COLOR.MUTED` fallback). The render layer maps each band onto a semantic theme color so light/dark and
 * high-contrast all resolve correctly.
 */
enum class GlanceBatteryBand {
    Green,
    Amber,
    Red,
    Unknown,
    ;

    companion object {
        /** The band for a [level] (0–100) — verbatim parity with the web `batteryColor` thresholds. */
        fun forLevel(level: Double): GlanceBatteryBand =
            when {
                level > GREEN_MIN_PCT -> Green
                level > AMBER_MIN_PCT -> Amber
                else -> Red
            }

        private const val GREEN_MIN_PCT = 50.0
        private const val AMBER_MIN_PCT = 20.0
    }
}

/** The band for a resolved [state] — [GlanceBatteryBand.Unknown] when no state decoded (web muted gauge). */
fun batteryBandFor(state: VehicleState?): GlanceBatteryBand =
    if (state == null) GlanceBatteryBand.Unknown else GlanceBatteryBand.forLevel(state.batteryLevel.toDouble()) // parity:allow numeric conversion call, not an unfinished marker

// ── Location label kind (web `getLocationLabel`) ───────────────────────────────────────────────────────────────

/**
 * The distinct location labels the page can show — the native split of the web `getLocationLabel` cascade. The
 * three named-place kinds resolve from the localized catalog at the render boundary; [Destination] carries the
 * raw backend `destination_name`; [None] renders the em-dash fallback (web's `'—'`).
 */
enum class GlanceLocationKind { Home, Work, Favorite, Destination, None }

/**
 * The parsed `GET /location-snapshots/latest` body the page needs — the native analogue of the fields the web
 * `getLocationLabel` reads. A present-but-not-object body parses to `null` (web's outer `!location` em-dash gate).
 *
 * @property locatedAtHome / [locatedAtWork] / [locatedAtFavorite] the geofence presence flags, in the web's
 *   home → work → favorite precedence.
 * @property destinationName the active route's destination, or `null`/blank when not navigating.
 */
data class GlanceLocation(
    val locatedAtHome: Boolean,
    val locatedAtWork: Boolean,
    val locatedAtFavorite: Boolean,
    val destinationName: String?,
) {
    /** The label kind, applying the web `getLocationLabel` precedence (home → work → favorite → destination). */
    val kind: GlanceLocationKind
        get() =
            when {
                locatedAtHome -> GlanceLocationKind.Home
                locatedAtWork -> GlanceLocationKind.Work
                locatedAtFavorite -> GlanceLocationKind.Favorite
                !destinationName.isNullOrBlank() -> GlanceLocationKind.Destination
                else -> GlanceLocationKind.None
            }

    companion object {
        /** Parse a raw snapshot body into a [GlanceLocation]; a non-object body yields `null` (web `!location`). */
        fun fromJson(element: JsonElement): GlanceLocation? {
            val obj = element as? JsonObject ?: return null
            return GlanceLocation(
                locatedAtHome = obj.boolField("located_at_home") ?: false,
                locatedAtWork = obj.boolField("located_at_work") ?: false,
                locatedAtFavorite = obj.boolField("located_at_favorite") ?: false,
                destinationName = obj.stringField("destination_name"),
            )
        }

        private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

        private fun JsonObject.boolField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
    }
}

/** The label kind for an optional [location] — [GlanceLocationKind.None] when absent (web `!location` em-dash). */
fun locationKindOf(location: GlanceLocation?): GlanceLocationKind = location?.kind ?: GlanceLocationKind.None

// ── Target-vehicle resolution (web `vehicleId ?? vehicles?.[0]`) ────────────────────────────────────────────────

/**
 * Resolve the vehicle the page should show — the native analogue of the web memo (`vehicleIdParam` match, else
 * `vehicles[0]`). The standalone `/glance` route carries no `vehicle_id` argument, so the app-scoped
 * [selectedId] (the `SelectedVehicleStore`, which self-heals to the first enrolled vehicle) plays the role of the
 * web query param: an in-list selection wins, otherwise the first vehicle. A null/empty fleet yields `null` (the
 * web `!vehicles?.length` no-vehicle branch).
 */
fun resolveGlanceVehicle(
    vehicles: List<Vehicle>?,
    selectedId: Long?,
): Vehicle? {
    if (vehicles.isNullOrEmpty()) return null
    selectedId?.let { id -> vehicles.firstOrNull { it.id == id } }?.let { return it }
    return vehicles.first()
}

// ── Resolved page snapshot + freshness-preserving Resource projection ───────────────────────────────────────────

/**
 * The fully resolved view the page renders — the resolved [vehicle] plus its last-known [state] and [location]
 * and the [stateFetchedAt] freshness stamp (web `useVehicleState` `dataUpdatedAt`). [vehicle] is `null` only on a
 * still-loading or empty fleet, which the bound state holder maps to the loading / empty data states.
 */
data class GlanceSnapshot(
    val vehicle: Vehicle?,
    val state: VehicleState? = null,
    val location: GlanceLocation? = null,
    val stateFetchedAt: Long? = null,
)

/**
 * Fold the resolved page fields into the SAME cache-then-network [Resource] envelope the vehicle-list feed
 * carried, so the bound state holder renders the full data-state matrix (loading → empty → error → success,
 * plus stale/offline) from one source. The page phase tracks the vehicle-list feed (the web `PageContainer`
 * loading/error chrome + the `!vehicle` empty branch); the per-vehicle state/location are secondary reads folded
 * into the [GlanceSnapshot] (absent ⇒ em-dash metrics + a muted gauge), exactly as the web page renders them.
 * Pure, so the freshness-preservation contract is unit-tested without a network or cache.
 */
fun glanceResource(
    vehicles: Resource<List<Vehicle>>,
    vehicle: Vehicle?,
    state: VehicleState?,
    location: GlanceLocation?,
    stateFetchedAt: Long?,
): Resource<GlanceSnapshot> {
    val snapshot = GlanceSnapshot(vehicle, state, location, stateFetchedAt)
    return when (vehicles) {
        is Resource.Loading ->
            Resource.Loading(
                cached = if (vehicles.cached == null && vehicle == null) null else snapshot,
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
                cached = if (vehicles.cached == null && vehicle == null) null else snapshot,
                fetchedAt = vehicles.fetchedAt,
                stale = vehicles.stale,
                error = vehicles.error,
            )
    }
}

/** The freshness stamp carried by any [Resource] variant (the per-feed `fetchedAt`), or `null` before any load. */
fun <T> resourceFetchedAt(resource: Resource<T>): Long? =
    when (resource) {
        is Resource.Loading -> resource.fetchedAt
        is Resource.Success -> resource.fetchedAt
        is Resource.Error -> resource.fetchedAt
    }

// ── Diagnostics (P1/S11) ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Emit the one PII-safe `view.opened` diagnostic with the surface [GlancePageRegistration.SLUG] (P1/S11). Carries
 * no vehicle id or command, so a diagnostics line can never leak fleet data.
 */
fun recordGlancePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to GlancePageRegistration.SLUG))
}
