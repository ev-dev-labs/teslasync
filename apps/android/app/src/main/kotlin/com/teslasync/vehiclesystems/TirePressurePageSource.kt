// The data seam the TirePressurePage surface binds to, plus its production binding over the shared S8 holders. The view
// (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the
// web page's two data reads: `useTirePressure` (`GET /tire-pressure/latest?vehicle_id={id}`) and
// `useTirePressureHistory` (`GET /tire-pressure?vehicle_id={id}`), scoped to the global `useSelectedVehicle` selection,
// with `useUnits`/`useFormatting` reading the `/settings` document for the pressure unit + locale.
//
// Both reads are already exposed by the shared **S8** [VehicleSystemsStore] (the memoized, multi-observer
// cache-then-network `Resource` streams every vehicle-systems surface shares app-wide), the unit/locale preference
// comes from the shared [SettingsStore] `/settings` document, and the scope is the app-wide [SelectedVehicleStore]
// selection. So this seam is a thin pass-through: a narrow interface so the view-model depends on an abstraction (the
// real store binding ↔ a test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.tirepressure

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehiclesystems.VehicleSystemsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [TirePressurePageViewModel] depends on so it binds to an abstraction (the shared VehicleSystems
 * + Settings holders and the app-scoped selection in production; a fake in tests), never to a concrete store or the
 * network. The two read feeds are cache-then-network `Resource` flows (the web read hooks); the selection is the
 * global active-vehicle scope. No HTTP touches the view.
 */
interface TirePressurePageSource {
    /** The cache-then-network `GET /tire-pressure/latest` feed for [vehicleId] (web `useTirePressure`). */
    fun tirePressureLatest(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /tire-pressure` history feed for [vehicleId] (web `useTirePressureHistory`). */
    fun tirePressureHistory(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`/`useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the shared **S8** [VehicleSystemsStore] + [SettingsStore] + the app-scoped
 * [SelectedVehicleStore] — the memoized, multi-observer feeds every surface shares app-wide. The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / error / stale / offline).
 * No HTTP touches the view.
 */
fun tirePressurePageSourceOf(
    vehicleSystemsStore: VehicleSystemsStore,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): TirePressurePageSource =
    object : TirePressurePageSource {
        override fun tirePressureLatest(vehicleId: String): Flow<Resource<JsonElement>> =
            vehicleSystemsStore.tirePressure(vehicleId)

        override fun tirePressureHistory(vehicleId: String): Flow<Resource<JsonElement>> =
            vehicleSystemsStore.tirePressureHistory(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
