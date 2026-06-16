// The data seam the ChargingHeatmapPage surface binds to, plus its production binding over the shared KMP core. The view
// (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web
// page's single data read `useChargingSessionsPaginated(vehicleId, { limit, start, end })` (`GET /charging`), the global
// `useSelectedVehicle` scope, and `useUnits`/`useSettings` (the `/settings` document).
//
// The paginated charging feed is served by the shared-core S7 [ChargingRepository] (the same KMP port of the web
// `useCharging` hook domain): a cache-then-network `Resource` stream of the generated SI [ChargingSession] DTO. The
// Android [io.teslasync.android.data.DataContainer] wires no shared ChargingStore (S8) into its graph, so the host binds
// the repository directly — exactly as the sibling BatteryHealthPage does — and the view-model projects it onto the
// lifecycle-aware UiState (the S8-equivalent render projection). A narrow interface so the view-model depends on an
// abstraction (the real bindings ↔ a test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.charging.chargingheatmap

import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.android.data.SelectedVehicleStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/** Recent-session window the heatmap reads (web `{ limit: 2000 }`). */
const val HEATMAP_SESSIONS_LIMIT: Int = 2000

/**
 * The single seam the [ChargingHeatmapPageViewModel] depends on so it binds to an abstraction (the shared Charging +
 * Settings holders + the app-scoped selection in production; a fake in tests), never to a concrete store or the network.
 * The read feed is a cache-then-network `Resource` flow of the generated SI DTO (the web read hook); the selection is the
 * global active-vehicle scope. No HTTP touches the view.
 */
interface ChargingHeatmapPageSource {
    /**
     * The cache-then-network paginated `GET /charging?vehicle_id=&limit=&offset=0[&start][&end]` feed for [vehicleId]
     * (web `useChargingSessionsPaginated`), already `safeArray`-guarded + decoded to the SI [ChargingSession] DTO.
     */
    fun chargingSessionsPaginated(vehicleId: Long, start: String?, end: String?): Flow<Resource<List<ChargingSession>>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` / `useSettings`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the shared-core [ChargingRepository] (S7) + the shared [SettingsStore] (S8) + the app-scoped
 * [SelectedVehicleStore] — the memoized cache-then-network feed every Charging surface shares, plus the global active
 * vehicle. The live values flow through unchanged so the view-model renders the full state matrix (loading / content /
 * empty / error / stale / offline). No HTTP touches the view.
 */
fun chargingHeatmapPageSourceOf(
    charging: ChargingRepository,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): ChargingHeatmapPageSource =
    object : ChargingHeatmapPageSource {
        override fun chargingSessionsPaginated(
            vehicleId: Long,
            start: String?,
            end: String?,
        ): Flow<Resource<List<ChargingSession>>> =
            charging.sessionsPaginated(vehicleId, HEATMAP_SESSIONS_LIMIT, 0, start, end)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
