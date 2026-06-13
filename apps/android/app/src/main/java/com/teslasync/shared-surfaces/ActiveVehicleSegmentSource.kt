// The data seam the ActiveVehicleSegment surface binds to, plus its production binding over the shared P1/S8
// holders. Named after the surface bundle (ActiveVehicleSegment*) rather than the single interface it declares.
// The view (composable) performs NO HTTP — it only collects state from the ViewModel, which drives this seam,
// satisfying the "no direct HTTP from the view" contract (ADR-002).
//
// The web source composes four hooks: `useSelectedVehicle` (the persisted selection: `vehicles` + `vehicleId` +
// `setVehicleId` + default-to-first), `useVehicleState(vehicleId)` (the active vehicle's last-known battery +
// range), and `useUnits` (the SI→display distance preference). This seam mirrors that union: [selectedId] +
// [select] + [reconcile] are the selection store, [vehicles] is the enrolled-fleet feed, [vehicleState] is the
// per-vehicle last-known state feed, and [units] is the live display-unit formatter. All four production holders
// already exist app-wide (P1/S8): the `SelectedVehicleStore`, the `VehiclesStore` `vehicles()` + `vehicleState()`
// feeds (the KMP ports of `useVehicles` / `useVehicleState`), and the `DataContainer.unitFormatter` flow (the
// `useUnits` port), so every observer folds into one upstream collection and follows one selection + one unit
// preference.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ActiveVehicleSegment) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `ActiveVehicleSegment*` filename cannot match the
// `ActiveVehicleSegmentSource` seam plus its co-located production adapter.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.activevehiclesegment

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [ActiveVehicleSegmentViewModel] depends on so it binds to an abstraction (real holders ↔
 * test fake), never to a concrete client — the Android analogue of the web `useSelectedVehicle` +
 * `useVehicleState` + `useUnits` composition (P1/S8 state-holder boundary).
 *
 * [selectedId] streams the persisted selection (web `useSelectedVehicle().vehicleId`); [select] writes it (web
 * `setVehicleId`); [vehicles] streams the cache-then-network enrolled fleet (web `useVehicles`); [vehicleState]
 * streams the active vehicle's cache-then-network last-known state (web `useVehicleState(id)`); [units] streams
 * the live SI→display formatter (web `useUnits`); [reconcile] self-heals the selection against the live list
 * (web "default to the first vehicle"). Each feed call returns a fresh flow so the ViewModel's refresh / retry
 * restart a real upstream collection. No HTTP touches the view.
 */
interface ActiveVehicleSegmentSource {
    /** The persisted selected-vehicle id, or `null` when none is selected (web `useSelectedVehicle` `vehicleId`). */
    val selectedId: StateFlow<Long?>

    /** The live SI→display unit formatter, tracking the user's settings (web `useUnits`). */
    val units: StateFlow<UnitFormatter>

    /** Stream the cache-then-network enrolled-vehicle list (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network last-known state envelope (web `useVehicleState(id)`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** Persist [id] as the active selection (web `setVehicleId`). */
    fun select(id: Long)

    /** Self-heal the selection against the currently-[availableIds] (web "default to the first vehicle"). */
    fun reconcile(availableIds: List<Long>)
}

/**
 * Binds the surface to the shared P1/S8 holders: the app-scoped [SelectedVehicleStore] (the active-vehicle
 * selection, the `useSelectedVehicle` store port), the [VehiclesStore] `vehicles()` + `vehicleState()` feeds
 * (the `useVehicles` / `useVehicleState` ports), and the live [unitFormatter] flow (the `useUnits` port). The
 * reads use the store's shared feeds, so every observer folds into one upstream collection — the same selection
 * and unit preference every other vehicle-scoped screen follows.
 */
fun activeVehicleSegmentSource(
    selection: SelectedVehicleStore,
    vehiclesStore: VehiclesStore,
    unitFormatter: StateFlow<UnitFormatter>,
): ActiveVehicleSegmentSource =
    object : ActiveVehicleSegmentSource {
        override val selectedId: StateFlow<Long?> = selection.selectedId

        override val units: StateFlow<UnitFormatter> = unitFormatter

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = vehiclesStore.vehicleState(vehicleId)

        override fun select(id: Long) {
            selection.select(id)
        }

        override fun reconcile(availableIds: List<Long>) {
            selection.reconcile(availableIds)
        }
    }
