// The data seam the VehiclePicker surface binds to, plus its production binding over the shared P1/S8 holders.
// Named after the surface bundle (VehiclePicker*) rather than the single interface it declares. The view
// (composable) performs NO HTTP — it only collects state from the ViewModel, which drives this seam,
// satisfying the "no direct HTTP from the view" contract (ADR-002).
//
// The web source composes three hooks — `useSelectedVehicleStore` (the persisted selection: `vehicleId` +
// `setVehicleId`), `useSelectedVehicle` (that store composed with `useVehicles()` + the default-to-first
// logic), and `usePinned('vehicle')` (the pin feed that re-orders + marks the rows). This seam mirrors that
// union 1:1: [selectedId] + [select] are the store, [vehicles] is the enrolled-fleet feed, [reconcile] drives
// the store's self-heal from the live list, and [pinned] is the unified-pin feed. The three production holders
// already exist app-wide (P1/S8): the `SelectedVehicleStore`, the `VehiclesStore` `vehicles()` feed (the KMP
// port of `useVehicles`), and the `PinnedStore` `pinned(type)` feed (the KMP port of `usePinned`), so every
// observer — this picker, the forms `VehicleSelect`, every vehicle-scoped page — folds into one upstream
// collection and follows one selection.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehiclePicker) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `VehiclePicker*` filename cannot match the
// `VehiclePickerSource` seam plus its co-located production adapter.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclepicker

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import io.teslasync.shared.core.presentation.pinned.PinnedStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [VehiclePickerViewModel] depends on so it binds to an abstraction (real holders ↔ test
 * fake), never to a concrete client — the Android analogue of the web `useSelectedVehicleStore` +
 * `useSelectedVehicle` + `usePinned('vehicle')` composition (P1/S8 state-holder boundary).
 *
 * [selectedId] streams the persisted selection (web `useSelectedVehicleStore().vehicleId`); [select] writes
 * it (web `setVehicleId`); [vehicles] streams the cache-then-network enrolled fleet (web `useVehicles`), each
 * call returning a fresh [Resource] flow so the ViewModel's refresh / retry restart a real upstream
 * collection; [reconcile] self-heals the selection against the live list (web "default to the first
 * vehicle"); [pinned] streams the cache-then-network unified-pin feed for the `vehicle` bucket (web
 * `usePinned('vehicle')`), a best-effort ordering input that never gates the picker's phase. No HTTP touches
 * the view.
 */
interface VehiclePickerSource {
    /** The persisted selected-vehicle id, or `null` when none is selected (web store `vehicleId`). */
    val selectedId: StateFlow<Long?>

    /** Stream the cache-then-network enrolled-vehicle list (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream the cache-then-network `vehicle` pin list (web `usePinned('vehicle')`). */
    fun pinned(): Flow<Resource<List<PinnedItem>>>

    /** Persist [id] as the active selection (web `setVehicleId`). */
    fun select(id: Long)

    /** Self-heal the selection against the currently-[availableIds] (web "default to the first vehicle"). */
    fun reconcile(availableIds: List<Long>)
}

/**
 * Binds the surface to the shared P1/S8 holders: the app-scoped [SelectedVehicleStore] (the active-vehicle
 * selection, the `useSelectedVehicleStore` port), the [VehiclesStore] `vehicles()` feed (the `useVehicles`
 * port), and the [PinnedStore] `pinned(Vehicle)` feed (the `usePinned('vehicle')` port). Each read uses the
 * store's shared feed, so every observer folds into one upstream collection — the same selection, fleet and
 * pin order every other vehicle-scoped screen follows.
 */
fun vehiclePickerSource(
    selection: SelectedVehicleStore,
    vehiclesStore: VehiclesStore,
    pinnedStore: PinnedStore,
): VehiclePickerSource =
    object : VehiclePickerSource {
        override val selectedId: StateFlow<Long?> = selection.selectedId

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun pinned(): Flow<Resource<List<PinnedItem>>> = pinnedStore.pinned(PinnedItemType.Vehicle)

        override fun select(id: Long) {
            selection.select(id)
        }

        override fun reconcile(availableIds: List<Long>) {
            selection.reconcile(availableIds)
        }
    }
