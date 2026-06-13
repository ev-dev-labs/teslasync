// The data seams the DateTime shared surface binds to, plus their production binding over the shared P1/S8
// holders. Named after the surface bundle (DateTime*) rather than the single interface it declares. The view
// (composable) performs NO HTTP — it only collects state from the ViewModel, which drives this seam, satisfying
// the "no direct HTTP from the view" contract (ADR-002).
//
// The web tz-aware path composes three hooks — `useSettings` (the `/settings` document carrying
// `tz_display_default` / `timezone_user` / `locale`), `useSelectedVehicle` (the active vehicle, whose reported
// IANA `timezone` is read), and `useTimezone` (the pure `resolveTimezone` fold over the two). This seam mirrors
// that union: [settings] is the settings-document feed (web `useSettings`), [vehicles] is the enrolled-fleet
// feed (web `useVehicles`, the list `useSelectedVehicle` resolves against), and [selectedId] is the persisted
// active-vehicle selection (web `useSelectedVehicleStore().vehicleId`). The `useTimezone` fold itself is pure
// and lives at the render boundary (DateTimeModel.effectiveZoneId). The three production holders already exist
// app-wide (P1/S8): the `SettingsStore`, the `VehiclesStore`, and the `SelectedVehicleStore`, so every observer
// folds into one upstream collection.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DateTime) cannot form a valid Kotlin package. `ktlint:standard:filename` /
// `MatchingDeclarationName` are suppressed for the co-located production-binding factory alongside the namesake
// interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datetime

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [DateTimeViewModel] depends on so it binds to an abstraction (real holders ↔ test fake),
 * never to a concrete client — the Android analogue of the web `useSettings` + `useSelectedVehicle` (+ the pure
 * `useTimezone`) composition (P1/S8 state-holder boundary).
 *
 * [settings] streams the cache-then-network `/settings` document (web `useSettings`); [vehicles] streams the
 * cache-then-network enrolled fleet (web `useVehicles`, resolved against [selectedId] to find the active
 * vehicle's zone); [selectedId] streams the persisted active-vehicle selection (web
 * `useSelectedVehicleStore().vehicleId`). Each feed accessor returns a fresh [Resource] flow so the ViewModel's
 * refresh / retry restart a real upstream collection. No HTTP touches the view.
 */
interface DateTimeSource {
    /** The persisted active-vehicle id, or `null` when none is selected (web store `vehicleId`). */
    val selectedId: StateFlow<Long?>

    /** Stream the cache-then-network `/settings` document (web `useSettings`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** Stream the cache-then-network enrolled-vehicle list (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>
}

/**
 * Binds the surface to the shared P1/S8 holders: the [SettingsStore] `settings()` feed (the `useSettings`
 * port), the [VehiclesStore] `vehicles()` feed (the `useVehicles` port), and the app-scoped
 * [SelectedVehicleStore] (the `useSelectedVehicleStore` port). The reads use each store's shared feed, so every
 * observer folds into one upstream collection — the same settings + selection every other screen follows.
 */
fun dateTimeSource(
    selection: SelectedVehicleStore,
    vehiclesStore: VehiclesStore,
    settingsStore: SettingsStore,
): DateTimeSource =
    object : DateTimeSource {
        override val selectedId: StateFlow<Long?> = selection.selectedId

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()
    }
