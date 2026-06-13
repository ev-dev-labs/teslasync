// The data seam the VehicleMultiSelect surface binds to for the enrolled-vehicle list it reads — the native
// analogue of the web `useVehicles` hook (web/src/api/hooks/useVehicles.ts, `GET /vehicles`) the component's
// callers feed into its `vehicles` prop. The view (composable) performs NO HTTP — it only collects state from
// the [VehicleMultiSelectViewModel], which drives this seam (ADR-002), satisfying the "no direct HTTP from the
// view" contract. A concrete adapter over the shared Vehicles layer — the S8 [VehiclesStore] for the shared,
// multi-observer feed every vehicle-scoped screen already shares, or the S7 [VehiclesRepository] for the cold
// cache-then-network flow a manual retry re-collects — backs it in production; a test fake backs it in unit
// tests. Mirrors the dual-adapter shape of the sibling Range / UserCell surfaces.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehicleMultiSelect) cannot form a valid Kotlin package.
// `MatchingDeclarationName` and the ktlint filename rule are suppressed: the mandated `VehicleMultiSelect*`
// filename hosts the seam interface plus its co-located extension adapters.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclemultiselect

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [VehicleMultiSelectViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never a concrete client — the Android counterpart of the web `useVehicles` read. The
 * `GET /vehicles` list is carried as the shared-core [Vehicle]s the backend serves so the picker's id / name /
 * model / VIN fields are read verbatim. No HTTP touches the view.
 */
fun interface VehicleMultiSelectSource {
    /** Cache-then-network `GET /vehicles` enrolled-fleet feed (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer enrolled-fleet feed
 * every vehicle-scoped screen shares, so the same list (and its refreshes) drives this picker too. No HTTP
 * touches the view.
 */
fun VehiclesStore.asVehicleMultiSelectSource(): VehicleMultiSelectSource {
    val store = this
    return VehicleMultiSelectSource { store.vehicles() }
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network `Flow`.
 * Re-collecting it performs a genuine cache-then-network re-fetch, which backs the surface's manual refresh /
 * error-retry affordance when no shared [VehiclesStore] is in scope. No HTTP touches the view.
 */
fun VehiclesRepository.asVehicleMultiSelectSource(): VehicleMultiSelectSource {
    val repo = this
    return VehicleMultiSelectSource { repo.vehicles() }
}
