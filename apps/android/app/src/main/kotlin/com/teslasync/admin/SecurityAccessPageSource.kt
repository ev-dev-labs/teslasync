// The data seam the SecurityAccessPage admin surface binds to, plus its production binding over the shared S8
// holders. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this
// seam, reproducing the web page's two TanStack-Query reads (`useVehicles` for the fleet/selection + error
// surface, `useSecurityEvents` for the per-vehicle security history).
//
// Both feeds are the shared-core cache-then-network `Resource` streams the S8 holders already expose
// (`GET /vehicles` ▸ VehiclesStore.vehicles(); `GET /security?vehicle_id=` ▸ AdminStore.securityEvents(id)). A
// narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store
// or the network. Each (re)collection is a fresh cache-then-network stream, so the view-model's refresh trigger
// re-subscribing performs the web `refetch()`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.securityaccess

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [SecurityAccessPageViewModel] depends on so it binds to an abstraction (the shared Vehicles
 * + Admin holders in production, a fake in tests), never to a concrete store or the network. [vehicles] backs the
 * fleet/selection + the list-load error banner (web `useVehicles`); [securityEvents] is the per-vehicle history
 * (web `useSecurityEvents`). No HTTP touches the view.
 */
interface SecurityAccessSource {
    /** The fleet list feed — backs selection reconciliation + the list-load error banner (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The raw-JSON `GET /security?vehicle_id=` history feed for [vehicleId] (web `useSecurityEvents`). */
    fun securityEvents(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [AdminStore] — the memoized, multi-observer feeds every
 * surface shares app-wide. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / content / empty / error / stale / offline) for each source. No HTTP touches the view.
 */
fun securityAccessSourceOf(
    vehiclesStore: VehiclesStore,
    adminStore: AdminStore,
): SecurityAccessSource =
    object : SecurityAccessSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun securityEvents(vehicleId: String): Flow<Resource<JsonElement>> = adminStore.securityEvents(vehicleId)
    }
