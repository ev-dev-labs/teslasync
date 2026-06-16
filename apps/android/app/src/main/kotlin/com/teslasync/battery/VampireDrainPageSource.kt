// The data seam the VampireDrainPage surface binds to, plus its production binding over the shared S8 holders. The view
// (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the
// web page's data reads: `useVampireDrainStats` (`GET /vampire-drain/stats?vehicle_id={id}`), the global
// `useSelectedVehicle` scope, and `fmtNumber`/`formatDate` reading the `/settings` document locale.
//
// The single idle-drain feed is already exposed by the shared **S8** [EnergyStore] (the memoized, multi-observer
// cache-then-network `Resource` stream every battery/energy surface shares app-wide), and the locale preference comes
// from the shared [SettingsStore] `/settings` document, scoped to the app-wide [SelectedVehicleStore] selection. So this
// seam is a thin pass-through: a narrow interface so the view-model depends on an abstraction (the real store binding ↔
// a test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.battery.vampiredrain

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [VampireDrainPageViewModel] depends on so it binds to an abstraction (the shared Energy +
 * Settings holders and the app-scoped selection in production; a fake in tests), never to a concrete store or the
 * network. The read feed is a cache-then-network `Resource` flow (the web read hook); the selection is the global
 * active-vehicle scope. No HTTP touches the view.
 */
interface VampireDrainPageSource {
    /** The cache-then-network `GET /vampire-drain/stats` feed for [vehicleId] (web `useVampireDrainStats`). */
    fun vampireDrainStats(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useFormatting` locale). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the shared **S8** [EnergyStore] + [SettingsStore] + the app-scoped [SelectedVehicleStore] — the
 * memoized, multi-observer feeds every surface shares app-wide. The live values flow through unchanged so the view-model
 * renders the full state matrix (loading / content / error / stale / offline). No HTTP touches the view.
 */
fun vampireDrainPageSourceOf(
    energyStore: EnergyStore,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): VampireDrainPageSource =
    object : VampireDrainPageSource {
        override fun vampireDrainStats(vehicleId: String): Flow<Resource<JsonElement>> =
            energyStore.vampireDrainStats(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
