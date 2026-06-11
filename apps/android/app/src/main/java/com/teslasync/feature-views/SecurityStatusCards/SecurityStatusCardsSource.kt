// The data port the SecurityStatusCards feature view binds to — the native analogue of the web
// `useVehicles` + `useSecurityLatest` hook pair the SecurityAccessPage composes and hands the child
// (web/src/api/hooks/useVehicles.ts + web/src/features/admin/pages/SecurityAccessPage.tsx; P1/S8
// state-holder boundary). [vehicles] supplies the fallback active-vehicle id; [security] is a
// cache-then-network [Resource] of one vehicle's latest security snapshot (a raw `JsonElement`, exactly as
// the shared layer serves `/security/latest`). The view never performs HTTP itself, and a test fake stands
// in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SecurityStatusCards) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitystatuscards

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
 * The single seam the [SecurityStatusCardsViewModel] depends on so it binds to an abstraction (real adapter
 * ↔ test fake), never to a concrete store/repository or the network. [vehicles] resolves the default vehicle
 * (web `vehicles?.[0]?.id`); [security] is the cache-then-network latest-security feed the page polls (web
 * `useSecurityLatest`). No HTTP touches the view.
 */
interface SecurityStatusCardsSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network latest security snapshot (web `useSecurityLatest`). */
    fun security(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Re-collecting these feeds performs a genuine cache-then-network re-fetch, which
 * backs the surface's refresh/retry affordance (the web page's 5s poll + `refetch()`): the view-model
 * reproduces the standard trigger ▸ re-collect pipeline over this port. No HTTP touches the view.
 */
fun VehiclesRepository.asSecurityStatusCardsSource(): SecurityStatusCardsSource {
    val repo = this
    return object : SecurityStatusCardsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> = repo.securityLatest(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every vehicle
 * surface shares app-wide. Use this when a host wants the cards to fold into the same shared collections as
 * the rest of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asSecurityStatusCardsSource(): SecurityStatusCardsSource {
    val store = this
    return object : SecurityStatusCardsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> = store.securityLatest(vehicleId)
    }
}

/**
 * Composes the fleet list with the active vehicle's security snapshot into one cache-then-network [Resource]
 * stream — the native port of the web `activeId = vehicleId ?? vehicles?.[0]?.id` resolution feeding
 * `useSecurityLatest(activeId)`. A positive [preferredVehicleId] short-circuits straight to its security feed
 * (the web fleet list is not consulted when a selected id is supplied); otherwise the first enrolled vehicle
 * drives the feed, and when neither resolves the fleet resource is folded onto a no-snapshot ([JsonNull])
 * value so the surface renders its loading / cards-with-defaults / error state honestly (web's disabled
 * query → `latest` undefined → default cards).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun securityCardsResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    securityFor: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<JsonElement>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        securityFor(preferred)
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoVehicleSecurity())
                else -> securityFor(id)
            }
        }
    }
}

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty (web `vehicles?.[0]?.id`). */
internal fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }

/** Folds a fleet-list [Resource] onto a no-snapshot security value, preserving loading/empty/error. */
private fun Resource<List<Vehicle>>.toNoVehicleSecurity(): Resource<JsonElement> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(JsonNull, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }
