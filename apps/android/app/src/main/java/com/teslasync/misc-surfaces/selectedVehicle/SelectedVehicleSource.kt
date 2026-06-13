// The data seam the selectedVehicle surface binds to, plus its production binding over the shared P1/S8
// holders. Named after the surface bundle (SelectedVehicle*) rather than the single interface it declares.
// The view (composable) performs NO HTTP — it only collects state from the ViewModel, which drives this
// seam, satisfying the "no direct HTTP from the view" contract (ADR-002).
//
// The web source pairs two hooks — `useSelectedVehicleStore` (the persisted selection: `vehicleId` +
// `setVehicleId`) and `useSelectedVehicle` (that store composed with `useVehicles()` + the precedence /
// default-to-first logic). This seam mirrors that union 1:1: [selectedId] + [select] are the store, and
// [vehicles] is the enrolled-fleet feed, with [reconcile] driving the store's self-heal from the live list.
// The two production holders already exist app-wide (P1/S8): the `SelectedVehicleStore` and the
// `VehiclesStore` `vehicles()` feed (the KMP port of `useVehicles`), so every observer folds into one
// upstream collection.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/misc-surfaces/selectedVehicle) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.selectedvehicle

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [SelectedVehicleViewModel] depends on so it binds to an abstraction (real holders ↔
 * test fake), never to a concrete client — the Android analogue of the web `useSelectedVehicleStore` +
 * `useSelectedVehicle` composition (P1/S8 state-holder boundary).
 *
 * [selectedId] streams the persisted selection (web `useSelectedVehicleStore().vehicleId`); [select] writes
 * it (web `setVehicleId`); [vehicles] streams the cache-then-network enrolled fleet (web `useVehicles`), each
 * call returning a fresh [Resource] flow so the ViewModel's refresh / retry restart a real upstream
 * collection; [reconcile] self-heals the selection against the live list (web "default to the first
 * vehicle"). No HTTP touches the view.
 */
interface SelectedVehicleSource {
    /** The persisted selected-vehicle id, or `null` when none is selected (web store `vehicleId`). */
    val selectedId: StateFlow<Long?>

    /** Stream the cache-then-network enrolled-vehicle list (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Persist [id] as the active selection (web `setVehicleId`). */
    fun select(id: Long)

    /** Self-heal the selection against the currently-[availableIds] (web "default to the first vehicle"). */
    fun reconcile(availableIds: List<Long>)
}

/**
 * Binds the surface to the shared P1/S8 holders: the app-scoped [SelectedVehicleStore] (the active-vehicle
 * selection, the `useSelectedVehicleStore` port) and the [VehiclesStore] `vehicles()` feed (the `useVehicles`
 * port). The read uses the store's shared feed, so every observer of [SelectedVehicleSource.vehicles] folds
 * into one upstream collection — the same selection every other vehicle-scoped screen follows.
 */
fun selectedVehicleSource(
    selection: SelectedVehicleStore,
    vehiclesStore: VehiclesStore,
): SelectedVehicleSource =
    object : SelectedVehicleSource {
        override val selectedId: StateFlow<Long?> = selection.selectedId

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun select(id: Long) {
            selection.select(id)
        }

        override fun reconcile(availableIds: List<Long>) {
            selection.reconcile(availableIds)
        }
    }
