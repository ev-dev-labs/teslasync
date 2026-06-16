// The data seam the BatteryDegradationPage surface binds to, plus its production binding over the shared S8
// holders. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this
// seam, reproducing the web page's two data reads: `useBatteryHealthAnalytics` (`/analytics/battery-health`) and
// `useBatteryDegradation` (`/analytics/battery-degradation`), the global `useSelectedVehicle` scope, and
// `useUnits` (the `/settings` document).
//
// Both analytics feeds are shared-core cache-then-network `Resource` streams the S8 [EnergyStore] already exposes
// (it ports the named `useBatteryHealthAnalytics` / `useBatteryDegradation` hooks one-to-one), the settings feed
// is the [SettingsStore] document, and the active-vehicle scope is the app-scoped [SelectedVehicleStore]
// selection. A narrow seam so the view-model depends on an abstraction (real holders ↔ a test fake), never on a
// concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.battery.degradation

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [BatteryDegradationPageViewModel] depends on so it binds to an abstraction (the shared
 * Energy + Settings holders + the app-scoped selection in production; a fake in tests), never to a concrete store
 * or the network. Every read feed is a cache-then-network `Resource` flow (the web read hooks); the selection is
 * the global active-vehicle scope. No HTTP touches the view.
 */
interface BatteryDegradationPageSource {
    /** The cache-then-network `GET /analytics/battery-health` feed for [vehicleId] (web `useBatteryHealthAnalytics`). */
    fun batteryHealthAnalytics(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /analytics/battery-degradation` feed for [vehicleId] (web `useBatteryDegradation`). */
    fun batteryDegradation(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the shared **S8** [EnergyStore] + [SettingsStore] + the app-scoped [SelectedVehicleStore] —
 * the memoized, multi-observer feeds every surface shares app-wide. The live values flow through unchanged so the
 * view-model renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches
 * the view.
 */
fun batteryDegradationPageSourceOf(
    energyStore: EnergyStore,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): BatteryDegradationPageSource =
    object : BatteryDegradationPageSource {
        override fun batteryHealthAnalytics(vehicleId: String): Flow<Resource<JsonElement>> =
            energyStore.batteryHealthAnalytics(vehicleId)

        override fun batteryDegradation(vehicleId: String): Flow<Resource<JsonElement>> =
            energyStore.batteryDegradation(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
