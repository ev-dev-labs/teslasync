// The data seam the VehicleTwin surface binds to, plus its production binding over the shared P1/S8 holders.
// Named after the surface bundle (VehicleTwin*) rather than the single interface it declares. The view
// (composable) performs NO HTTP — it only collects state from the ViewModel, which drives this seam, satisfying
// the "no direct HTTP from the view" contract (ADR-002).
//
// The web source's only internal data dependency is `useVehiclePaint(vehicleId, exteriorColor)`, which composes
// two inputs: (1) the per-vehicle, device-local paint OVERRIDE (web `localStorage`, cross-tab broadcast) and
// (2) the Tesla `exterior_color` of the active vehicle (native `Vehicle.color`), read from the cache-then-network
// vehicle record. This seam mirrors that union: [selectedId] + [vehicles] resolve the active vehicle (the
// `exterior_color` source, the same `useVehicles` + `useSelectedVehicle` feed every vehicle-scoped surface folds
// into), [paintOverride] streams the device-local override for a vehicle, and [setPaint] writes it (web
// `setPaint`). [reconcile] keeps the shared selection self-healed from the live list (web "default to the first
// vehicle"). The override store is its own small holder so the view never touches persistence directly.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehicleTwin) cannot form a valid Kotlin package. `MatchingDeclarationName` and
// the ktlint filename rule are suppressed: the mandated `VehicleTwin*` filename cannot match the
// `VehicleTwinSource` seam plus its co-located stores + production adapter.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehicletwin

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The per-vehicle paint-override holder — the native analogue of the web `useVehiclePaint` persistence
 * (`localStorage` keyed `teslasync:vehicle:{id}:paint`, with in-tab + cross-tab sync). A `null` override means
 * "use the inferred paint"; a present one is the user's explicit choice for that vehicle. It is a separate,
 * device-local holder so the override survives selection changes and is observed reactively, while the view never
 * reads persistence directly.
 *
 * The production [inMemoryVehicleTwinPaintStore] keeps the choice for the process lifetime (the override is, by
 * the web contract, device-local and explicitly NOT server-synced); a host that wants cross-launch persistence can
 * supply a `Settings`-backed implementation of this interface without touching the surface. Confine creation and
 * use to one scope (the platform main scope), matching the sibling `SelectedVehicleStore`.
 */
interface VehicleTwinPaintStore {
    /** Streams the device-local paint override for [vehicleId] (web `readOverride`); `null` ⇒ use inferred paint. */
    fun override(vehicleId: Long?): StateFlow<PaintPaletteId?>

    /** Persists [id] (or clears it with `null`) as the override for [vehicleId] (web `setPaint` / `writeOverride`). */
    fun setOverride(
        vehicleId: Long,
        id: PaintPaletteId?,
    )
}

/**
 * The default in-process [VehicleTwinPaintStore]: a per-vehicle [MutableStateFlow] map. Each vehicle gets its own
 * override slot (web "keyed per-vehicle so a Pearl White and a Midnight Silver in the same garage each render
 * correctly"). A `null` / non-positive [vehicleId] has no slot (web disables persistence for "no vehicle yet") and
 * always reads `null`.
 */
fun inMemoryVehicleTwinPaintStore(): VehicleTwinPaintStore =
    object : VehicleTwinPaintStore {
        private val slots = mutableMapOf<Long, MutableStateFlow<PaintPaletteId?>>()
        private val none = MutableStateFlow<PaintPaletteId?>(null)

        private fun slot(vehicleId: Long): MutableStateFlow<PaintPaletteId?> = slots.getOrPut(vehicleId) { MutableStateFlow(null) }

        override fun override(vehicleId: Long?): StateFlow<PaintPaletteId?> =
            if (vehicleId == null || vehicleId <= 0) none.asStateFlow() else slot(vehicleId).asStateFlow()

        override fun setOverride(
            vehicleId: Long,
            id: PaintPaletteId?,
        ) {
            if (vehicleId <= 0) return
            slot(vehicleId).value = id
        }
    }

/**
 * The single seam the [VehicleTwinViewModel] depends on so it binds to an abstraction (real holders ↔ test fake),
 * never to a concrete client — the Android analogue of the web `useVehicles` + `useSelectedVehicle` +
 * `useVehiclePaint` composition (P1/S8 state-holder boundary).
 *
 * [selectedId] streams the persisted active-vehicle selection; [vehicles] streams the cache-then-network enrolled
 * fleet (each call a fresh [Resource] flow so refresh/retry restart a real upstream collection); [paintOverride]
 * streams the device-local override for a vehicle; [setPaint] writes it; and [reconcile] self-heals the selection
 * against the live list. No HTTP touches the view.
 */
interface VehicleTwinSource {
    /** The persisted selected-vehicle id, or `null` when none is selected (web store `vehicleId`). */
    val selectedId: StateFlow<Long?>

    /** Stream the cache-then-network enrolled-vehicle list (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream the device-local paint override for [vehicleId] (web `useVehiclePaint` override slot). */
    fun paintOverride(vehicleId: Long?): StateFlow<PaintPaletteId?>

    /** Persist [id] (or clear with `null`) as the paint override for [vehicleId] (web `setPaint`). */
    fun setPaint(
        vehicleId: Long,
        id: PaintPaletteId?,
    )

    /** Self-heal the selection against the currently-[availableIds] (web "default to the first vehicle"). */
    fun reconcile(availableIds: List<Long>)
}

/**
 * Binds the surface to the shared P1/S8 holders: the app-scoped [SelectedVehicleStore] (the active-vehicle
 * selection), the [VehiclesStore] `vehicles()` feed (the `useVehicles` port, the `exterior_color` source), and the
 * [VehicleTwinPaintStore] override holder (the `useVehiclePaint` persistence). Each read uses the store's shared
 * feed, so every observer folds into one upstream collection — the same selection and fleet every other
 * vehicle-scoped screen follows.
 */
fun vehicleTwinSource(
    selection: SelectedVehicleStore,
    vehiclesStore: VehiclesStore,
    paintStore: VehicleTwinPaintStore,
): VehicleTwinSource =
    object : VehicleTwinSource {
        override val selectedId: StateFlow<Long?> = selection.selectedId

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun paintOverride(vehicleId: Long?): StateFlow<PaintPaletteId?> = paintStore.override(vehicleId)

        override fun setPaint(
            vehicleId: Long,
            id: PaintPaletteId?,
        ) {
            paintStore.setOverride(vehicleId, id)
        }

        override fun reconcile(availableIds: List<Long>) {
            selection.reconcile(availableIds)
        }
    }
