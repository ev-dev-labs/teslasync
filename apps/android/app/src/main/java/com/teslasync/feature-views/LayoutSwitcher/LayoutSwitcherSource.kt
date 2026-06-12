// The data port the LayoutSwitcher feature view binds to — the native analogue of the web `useSelectedVehicle`
// hook the component reads (web/src/hooks/useSelectedVehicle.ts → web/src/api/hooks/useVehicles.ts; the P1/S8
// state-holder boundary). The switcher itself is prop-driven (its layouts + callbacks come from the host),
// and the ONLY async data it touches is the enrolled-vehicle list, which scopes the visible layouts, renders
// the pinned badge, and gates the pin/unpin action. [vehicles] streams that cache-then-network list; the
// composition below resolves it to a [SelectedVehicleContext]. The view never performs HTTP, and a test fake
// stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LayoutSwitcher — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.layoutswitcher

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * The single seam the [LayoutSwitcherViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never to a concrete store/repository or the network. [vehicles] is the cache-then-network enrolled
 * fleet feed (web `useVehicles`), the only data source the switcher's `useSelectedVehicle` resolves from. No
 * HTTP touches the view.
 */
interface LayoutSwitcherSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the selected/active vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holder every vehicle
 * surface shares app-wide. Use this when a host wants the switcher to fold into the same shared collections as
 * the rest of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asLayoutSwitcherSource(): LayoutSwitcherSource {
    val store = this
    return object : LayoutSwitcherSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()
    }
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feed the S8
 * [VehiclesStore] also wraps. Re-collecting it performs a genuine cache-then-network re-fetch, which backs the
 * surface's refresh/retry affordance. No HTTP touches the view.
 */
fun VehiclesRepository.asLayoutSwitcherSource(): LayoutSwitcherSource {
    val repo = this
    return object : LayoutSwitcherSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()
    }
}

/**
 * Maps the cache-then-network vehicles feed onto a [SelectedVehicleContext] feed, preserving the ADR-013
 * lifecycle (loading / success / error + cached / stale / fetchedAt) so the surface renders every state
 * honestly. The payload is resolved by [resolveSelectedVehicle]; loading/error cached values are folded
 * through the same resolution so "last known" context survives an offline refresh.
 */
internal fun selectedVehicleResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
): Flow<Resource<SelectedVehicleContext>> = vehicles.map { it.toSelectedVehicleContext(preferredVehicleId) }

/**
 * Resolves the selected-vehicle context from the enrolled [vehicles] (web `useSelectedVehicle`): a positive
 * [preferredVehicleId] picks that vehicle when present, otherwise the first enrolled vehicle is used (web
 * "default to the first vehicle"). Returns [SelectedVehicleContext.NONE] when the fleet is empty/absent. The
 * label is the display name, falling back to the VIN, else `null` (web `display_name ?? vin`).
 */
internal fun resolveSelectedVehicle(
    vehicles: List<Vehicle>?,
    preferredVehicleId: Long?,
): SelectedVehicleContext {
    val list = vehicles.orEmpty()
    if (list.isEmpty()) return SelectedVehicleContext.NONE
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    val match = preferred?.let { id -> list.firstOrNull { it.id == id } } ?: list.first()
    return SelectedVehicleContext(vehicleId = match.id, label = vehicleLabel(match))
}

/** The selected vehicle's display label (web `display_name ?? vin`), or `null` when both are blank. */
private fun vehicleLabel(vehicle: Vehicle): String? {
    val name = vehicle.displayName.trim()
    if (name.isNotEmpty()) return name
    val vin = vehicle.vin.trim()
    return vin.ifEmpty { null }
}

/** Folds a fleet-list [Resource] onto a resolved-context [Resource], preserving loading / stale / error. */
private fun Resource<List<Vehicle>>.toSelectedVehicleContext(preferredVehicleId: Long?): Resource<SelectedVehicleContext> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let { resolveSelectedVehicle(it, preferredVehicleId) },
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = resolveSelectedVehicle(data, preferredVehicleId),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let { resolveSelectedVehicle(it, preferredVehicleId) },
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }
