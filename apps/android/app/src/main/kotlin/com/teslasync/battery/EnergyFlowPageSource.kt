// The data seam the EnergyFlowPage battery surface binds to, plus its production binding over the shared S8 Energy +
// Settings holders and the app-scoped active-vehicle selection. The view (composable) performs NO HTTP — it only
// collects state from the view-model, which drives this seam, reproducing the web page's data reads: the primary
// historical `useQuery('/vehicles/{id}/energy?days=N')` (web `EnergyStatsResponse`), the real-time
// `useEnergyFlow('/vehicles/{id}/energy/flow')`, the global `useSelectedVehicle` scope, and `useUnits` (the `/settings`
// document).
//
// Every read feed is a shared-core cache-then-network `Resource` stream the S8 [EnergyStore]/[SettingsStore] already
// expose (energy stats + energy flow ▸ EnergyStore, settings ▸ SettingsStore), and the active-vehicle scope is the
// app-scoped [SelectedVehicleStore] selection — so the ADR-013 freshness contract + SI-verbatim caching are identical
// to every other surface and NO page-local repository is needed. A narrow seam so the view-model depends on an
// abstraction (the real holders ↔ a test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.battery.energyflow

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [EnergyFlowPageViewModel] depends on so it binds to an abstraction (the shared Energy + Settings
 * holders + the app-scoped selection in production; a fake in tests), never to a concrete store or the network. Every
 * read feed is a cache-then-network `Resource` flow (the web read hooks); the selection is the global active-vehicle
 * scope. No HTTP touches the view.
 */
interface EnergyFlowPageSource {
    /**
     * The cache-then-network `GET /vehicles/{id}/energy?days={days}` feed for [vehicleId] (web primary stats
     * `useQuery`). The view-model only requests it for a real selection (web `enabled: activeId != null`).
     */
    fun energyStats(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /vehicles/{id}/energy/flow` real-time feed for [vehicleId] (web `useEnergyFlow`). */
    fun energyFlow(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the shared **S8** [EnergyStore] + [SettingsStore] + the app-scoped [SelectedVehicleStore] — the
 * memoized, multi-observer feeds every surface shares app-wide. The live values flow through unchanged so the
 * view-model renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches the
 * view.
 */
fun energyFlowPageSourceOf(
    energyStore: EnergyStore,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): EnergyFlowPageSource =
    object : EnergyFlowPageSource {
        override fun energyStats(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<JsonElement>> = energyStore.energyStats(vehicleId, days)

        override fun energyFlow(vehicleId: String): Flow<Resource<JsonElement>> = energyStore.energyFlow(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
