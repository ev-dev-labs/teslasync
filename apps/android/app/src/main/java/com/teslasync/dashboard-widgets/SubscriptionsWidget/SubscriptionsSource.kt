// The data port the Subscriptions widget binds to — the native analogue of the two web hooks the component
// composes: `useVehicles` (to resolve the active vehicle — web `vehicleId ?? vehicles?.[0]?.id`) and
// `useVehicleSubscriptions` (the per-vehicle `/vehicles/{id}/subscriptions` envelope). See
// web/src/features/dashboard/widgets/SubscriptionsWidget.tsx + web/src/api/hooks/useVehicles.ts. The view
// never performs HTTP; a concrete adapter over the shared S7/S8 vehicles data layer (or a test fake) drives
// this seam, and cache-then-network freshness is preserved end to end (ADR-013).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SubscriptionsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.subscriptions

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * The single seam the [SubscriptionsWidgetViewModel] depends on so it binds to an abstraction (real adapter
 * ↔ test fake), never to a concrete store/repository or the network. [vehicles] resolves the default vehicle
 * (web `vehicles?.[0]?.id`); [subscriptions] is the cache-then-network per-vehicle subscriptions envelope
 * (web `useVehicleSubscriptions`). No HTTP touches the view.
 */
interface SubscriptionsSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network subscriptions envelope (web `useVehicleSubscriptions`). */
    fun subscriptions(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Re-collecting these feeds performs a genuine cache-then-network re-fetch, which
 * is what backs the widget's manual refresh/retry affordance (the web `useVehicleSubscriptions().refetch()`):
 * the view-model reproduces the standard trigger ▸ re-collect pipeline over this port. No HTTP touches the
 * view.
 */
fun VehiclesRepository.asSubscriptionsSource(): SubscriptionsSource {
    val repo = this
    return object : SubscriptionsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun subscriptions(vehicleId: String): Flow<Resource<JsonElement>> = repo.vehicleSubscriptions(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every vehicle
 * surface shares app-wide. Use this when a host wants the widget to fold into the same shared collections as
 * the rest of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asSubscriptionsSource(): SubscriptionsSource {
    val store = this
    return object : SubscriptionsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun subscriptions(vehicleId: String): Flow<Resource<JsonElement>> = store.vehicleSubscriptions(vehicleId)
    }
}

/**
 * The first enrolled vehicle's positive id (web `vehicles?.[0]?.id` feeding `numericId > 0`), or `null` when
 * the list is absent/empty or the leading id is non-positive.
 */
internal fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }

/**
 * Composes the fleet list with the active vehicle's subscriptions envelope into one cache-then-network
 * [Resource] stream — the native port of the web `numericId = vehicleId ?? vehicles?.[0]?.id ?? 0; stringId =
 * numericId > 0 ? String(numericId) : undefined` resolution feeding `useVehicleSubscriptions(stringId)`. A
 * positive [preferredVehicleId] short-circuits straight to its subscriptions feed (the web vehicle-list is
 * not consulted when a prop id is supplied); otherwise the first enrolled vehicle drives the feed.
 *
 * When no vehicle id resolves the fleet resource is folded onto a no-data ([JsonNull]) envelope so the
 * surface renders honestly: a still-loading fleet stays loading (skeleton), a resolved/empty fleet becomes an
 * empty success ("No subscriptions"), and a hard fleet error degrades to a cached empty (offline/error chip +
 * the empty message) rather than the hard error surface — mirroring the web, where only the
 * `useVehicleSubscriptions` query (never the disabled-when-id-less vehicles query) drives the error surface.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun subscriptionsResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    subscriptionsFor: (String) -> Flow<Resource<JsonElement>>,
): Flow<Resource<JsonElement>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        subscriptionsFor(preferred.toString())
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoVehicleSubscriptions())
                else -> subscriptionsFor(id.toString())
            }
        }
    }
}

/**
 * Folds a fleet-list [Resource] that yields no usable vehicle id onto a no-data subscriptions envelope: a
 * still-loading fleet stays loading; a resolved fleet becomes an empty success ([JsonNull]); a hard fleet
 * error becomes a cached empty with `stale = true` + the error kind, so the surface shows the friendly empty
 * state behind an offline/error chip rather than the hard error screen (web: a disabled subscriptions query
 * never raises the error surface).
 */
private fun Resource<List<Vehicle>>.toNoVehicleSubscriptions(): Resource<JsonElement> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(JsonNull, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = JsonNull, fetchedAt = fetchedAt, stale = true, error = error)
    }
