// The data seam the CostAnalysisPage surface binds to, plus its production binding over the shared-core charging
// repository, the app-scoped active-vehicle selection, and the live settings document. The view (composable)
// performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web
// page's two reads (`useChargingSessionsPaginated(vehicleId, { limit: 5000, start, end })` and
// `useCostForecast(vehicleId)`), the global `useSelectedVehicle` scope, and the `useUnits`/`useSettings` display
// preferences.
//
// The sessions feed + the cost-forecast feed are the shared-core cache-then-network `Resource` streams the S7
// [ChargingRepository] already exposes (`GET /charging` ▸ `sessionsPaginated`; `GET /analytics/cost-forecast` ▸
// `costForecast`). The Android DI graph ([io.teslasync.android.data.DataContainer]) wires no ChargingStore yet, so
// the host constructs the shared [io.teslasync.shared.core.data.repo.HttpChargingRepository] over the SAME
// resilient client + offline cache the other repositories use (so the ADR-013 freshness contract + SI-verbatim
// caching are identical) and hands it in here. A narrow seam so the view-model depends on an abstraction (real
// adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.charging.costanalysis

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [CostAnalysisPageViewModel] depends on so it binds to an abstraction (the shared charging
 * repository + the app-scoped selection + the settings store in production, a fake in tests), never to a concrete
 * repository or the network. The sessions + cost-forecast feeds are cache-then-network `Resource` flows (the web
 * read hooks); the selection is the global active-vehicle scope; the settings feed drives the display units. No
 * HTTP touches the view.
 */
interface CostAnalysisPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /**
     * The cache-then-network paginated `GET /charging` feed for [vehicleId] over the picked date window (web
     * `useChargingSessionsPaginated`). The page reads the [CostAnalysisPageRegistration.SESSIONS_LIMIT] window.
     */
    fun sessionsPaginated(
        vehicleId: Long,
        start: String?,
        end: String?,
    ): Flow<Resource<List<ChargingSession>>>

    /**
     * The cache-then-network `GET /analytics/cost-forecast?vehicle_id&months` feed for [vehicleId] (web
     * `useCostForecast`). Delivered as raw SI [JsonElement]; the page parses it at the display boundary.
     */
    fun costForecast(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The live `/settings` document (web `useSettings`/`useUnits`), driving the display distance unit. */
    fun settings(): StateFlow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [ChargingRepository] + the app-scoped [SelectedVehicleStore] + the shared
 * [SettingsStore] — the memoized cache-then-network feeds every charging surface shares, scoped to the active
 * vehicle. The live values flow through unchanged so the view-model renders the full state matrix (loading /
 * content / empty / error / stale / offline). No HTTP touches the view.
 */
fun costAnalysisPageSourceOf(
    chargingRepository: ChargingRepository,
    selectedVehicleStore: SelectedVehicleStore,
    settingsStore: SettingsStore,
): CostAnalysisPageSource =
    object : CostAnalysisPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun sessionsPaginated(
            vehicleId: Long,
            start: String?,
            end: String?,
        ): Flow<Resource<List<ChargingSession>>> =
            chargingRepository.sessionsPaginated(
                vehicleId = vehicleId,
                limit = CostAnalysisPageRegistration.SESSIONS_LIMIT,
                offset = 0,
                start = start,
                end = end,
            )

        override fun costForecast(vehicleId: Long): Flow<Resource<JsonElement>> =
            chargingRepository.costForecast(
                vehicleId = vehicleId.toString(),
                months = CostAnalysisPageRegistration.FORECAST_MONTHS,
            )

        override fun settings(): StateFlow<Resource<JsonElement>> = settingsStore.settings()
    }
