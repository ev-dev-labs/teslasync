// The data seam the VehicleCostPage admin surface binds to, plus its production binding over the shared S8
// OperatorConfidenceStore. The view (composable) performs NO HTTP — it only collects state from the view-model,
// which drives this seam, reproducing the web page's single TanStack-Query read (`useVehicleCost`).
//
// The read is the shared-core cache-then-network `Resource` stream the S8 OperatorConfidenceStore already
// exposes (`GET /admin/observability/vehicle-cost?limit&since` ▸ vehicleCost(sinceIso, limit)); [refresh] is the
// store's own per-feed re-fetch for the active (sinceIso, limit) pair (the web `refetchInterval` / error-retry
// analogue). A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
// concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.vehiclecost

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore
import io.teslasync.shared.core.presentation.operatorconfidence.VehicleCostResponse
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [VehicleCostPageViewModel] depends on so it binds to an abstraction (the shared
 * Operator-Confidence holder in production, a fake in tests), never to a concrete store or the network. The
 * read is a cache-then-network typed `Resource` flow per (sinceIso, limit) pair (web `useVehicleCost`);
 * [refresh] re-fetches the active pair (the web query `refetch` / the error-state retry). No HTTP touches the
 * view.
 */
interface VehicleCostSource {
    /** The typed `GET /admin/observability/vehicle-cost` feed for [sinceIso] + [limit] (web `useVehicleCost`). */
    fun vehicleCost(
        sinceIso: String?,
        limit: Int,
    ): Flow<Resource<VehicleCostResponse>>

    /** Re-fetches the vehicle-cost feed for the active [sinceIso] + [limit] pair (web `refetch` / error retry). */
    fun refresh(
        sinceIso: String?,
        limit: Int,
    )
}

/**
 * Binds the surface to the shared **S8** [OperatorConfidenceStore] — the memoized, multi-observer admin feeds
 * the app shares. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun OperatorConfidenceStore.asVehicleCostSource(): VehicleCostSource {
    val store = this
    return object : VehicleCostSource {
        override fun vehicleCost(
            sinceIso: String?,
            limit: Int,
        ): Flow<Resource<VehicleCostResponse>> = store.vehicleCost(sinceIso, limit)

        override fun refresh(
            sinceIso: String?,
            limit: Int,
        ) = store.refreshVehicleCost(sinceIso, limit)
    }
}
