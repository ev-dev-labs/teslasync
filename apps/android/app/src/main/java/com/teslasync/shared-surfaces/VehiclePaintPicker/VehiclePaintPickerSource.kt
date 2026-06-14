// The persistence seam the VehiclePaintPicker surface binds to, plus its process-wide production store — the
// native port of web/src/hooks/useVehiclePaint.ts's storage layer (the per-vehicle localStorage override at
// `teslasync:vehicle:{id}:paint`, the cross-tab `broadcast` bus, and the same-tab listener channel). The view
// (composable) performs NO work of its own; it only renders the projected state the ViewModel derives from
// this seam, satisfying the "data flows through the shared state holder" contract (ADR-002). No HTTP exists on
// this path at all — the override is browser-/device-local, exactly as on the web.
//
// The web hook composes three same-purpose channels so every `useVehiclePaint` instance for a vehicle stays
// in sync without a reload: localStorage (durable per-vehicle override), a same-tab listener set
// (`notifyInTab` / `subscribeInTab`, because a `storage` event only fires in OTHER tabs), and the cross-tab
// `broadcast` bus (`vehicle.paint.changed`). On a single device these three collapse into ONE in-process
// keyed state holder: a per-vehicle `StateFlow<PaintPaletteId?>` every observer in the process shares, so a
// write from the picker is seen immediately by the picker's own label AND by any VehicleTwin bound to the
// same vehicle — the same way the accepted `SelectedVehicleStore` ports the localStorage-backed
// `useSelectedVehicleStore`. A `vehicleId` of `null`, `0` or negative is "no vehicle yet": persistence is
// disabled and the override reads as `null`, so the picker still renders the inferred / fallback paint
// (web `storageKey` returns `null` and the hook returns the inferred paint).
//
// Durable cross-process / on-disk persistence (the localStorage "survives a restart" property) is a P1/S8
// platform-store concern (Jetpack DataStore) owned by the shared DI container, not this surface; the seam is
// injectable precisely so a disk-backed binding can replace [ProcessVehiclePaintStore] without touching the
// view or the ViewModel. The in-memory store is the documented sibling-precedent shape, not a shortcut.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehiclePaintPicker) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `VehiclePaintPicker*` filename cannot match the
// `VehiclePaintSource` seam plus its co-located production store + accessor.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclepaintpicker

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.concurrent.ConcurrentHashMap

/**
 * The single seam the [VehiclePaintPickerViewModel] depends on so it binds to an abstraction (the real
 * process store ↔ a throwaway test fake), never to a concrete client — the Android analogue of the web
 * `useVehiclePaint` storage layer (the P1/S8 state-holder boundary for this surface).
 *
 * [overrideFor] streams the persisted per-vehicle override (web `readOverride` + the cross-tab / same-tab
 * sync), `null` meaning "no override → use the inferred paint"; [setOverride] writes it (web `writeOverride`
 * + `broadcast` + `notifyInTab`), with `null` clearing the override. A non-persistable [vehicleId] (`null` /
 * `<= 0`) reads as a constant `null` and ignores writes, exactly as the web `storageKey` guard disables
 * persistence. No HTTP touches the view.
 */
interface VehiclePaintSource {
    /** Stream the persisted override for [vehicleId] (web `readOverride`); `null` ⇒ use the inferred paint. */
    fun overrideFor(vehicleId: Long?): StateFlow<PaintPaletteId?>

    /** Persist [id] as the override for [vehicleId] (web `writeOverride` + broadcast); `null` clears it. */
    fun setOverride(
        vehicleId: Long?,
        id: PaintPaletteId?,
    )
}

/**
 * The default [VehiclePaintSource] — a process-wide, per-vehicle in-memory store, the native analogue of the
 * web localStorage override fanned out over the broadcast + in-tab channels. Each persistable vehicle id owns
 * one lazily-created [MutableStateFlow]; every observer of the same vehicle shares it, so a [setOverride] is
 * reflected live across the whole process (the in-process replacement for the web `broadcast` + `notifyInTab`
 * fan-out). A non-persistable id is served the shared constant-`null` [emptyOverride] and its writes are
 * dropped (web persistence disabled for `id <= 0`). Safe to touch from any thread — the per-vehicle map is a
 * [ConcurrentHashMap] and `StateFlow` writes are atomic.
 */
class ProcessVehiclePaintStore : VehiclePaintSource {
    private val flows = ConcurrentHashMap<Long, MutableStateFlow<PaintPaletteId?>>()
    private val emptyOverride: StateFlow<PaintPaletteId?> = MutableStateFlow(null)

    override fun overrideFor(vehicleId: Long?): StateFlow<PaintPaletteId?> =
        if (isPersistableVehicleId(vehicleId)) flowFor(vehicleId!!) else emptyOverride

    override fun setOverride(
        vehicleId: Long?,
        id: PaintPaletteId?,
    ) {
        if (!isPersistableVehicleId(vehicleId)) return
        flowFor(vehicleId!!).value = id
    }

    private fun flowFor(vehicleId: Long): MutableStateFlow<PaintPaletteId?> = flows.computeIfAbsent(vehicleId) { MutableStateFlow(null) }
}

/**
 * The process-wide paint-override store every call-site shares — the native analogue of the web module-level
 * localStorage + broadcast singleton. The surface defaults its seam to this so the picker is a true drop-in
 * (like the web component); a test constructs a throwaway [ProcessVehiclePaintStore] so the singleton is
 * never polluted across cases.
 */
val ProcessVehiclePaintSource: VehiclePaintSource = ProcessVehiclePaintStore()
