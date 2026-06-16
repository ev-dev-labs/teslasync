// The data seam the TeslaChargingHistoryPage surface binds to, plus its production binding over the shared
// state holders + the S7 charging repository. The view (composable) performs NO HTTP — it only collects state
// from the view-model, which drives this seam, reproducing the web page's three reads (`useVehicles`,
// `useTeslaChargingHistory`, `useSettings`) and its one mutation (`useRefreshTeslaChargingHistory`).
//
// The vehicle list + settings document are the shared S8 holders every surface already shares
// (`VehiclesStore.vehicles()` ▸ web `useVehicles`; `SettingsStore.settings()` ▸ web `useSettings`/`useFormatting`
// currency context). The Tesla-history feed + its refresh are the shared-core S7 [ChargingRepository] the sibling
// A7 charging page already binds to (the Android DI graph wires no ChargingStore, so the host constructs the
// shared [io.teslasync.shared.core.data.repo.HttpChargingRepository] over the SAME resilient client + offline
// cache — identical ADR-013 freshness + SI-verbatim caching — and hands it in here). A narrow seam so the
// view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or the
// network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.charging.teslacharginghistory

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [TeslaChargingHistoryPageViewModel] depends on so it binds to an abstraction (the shared
 * Vehicles/Settings holders + the charging repository in production, a fake in tests), never to a concrete
 * store/repository or the network. All three reads are cache-then-network `Resource` flows (the web read hooks);
 * the refresh is the web `useRefreshTeslaChargingHistory` mutation. No HTTP touches the view.
 */
interface TeslaChargingHistoryPageSource {
    /** The enrolled-vehicle list feed (web `useVehicles`), used to build the VIN-filter dropdown. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * The cache-then-network `GET /tesla/charging/history[?vin]` raw-JSON feed (web `useTeslaChargingHistory`).
     * The `vin` is sent only when present; a `null` vin reads the all-vehicles history.
     */
    fun teslaChargingHistory(vin: String?): Flow<Resource<JsonElement>>

    /** The `/settings` document feed (web `useSettings`/`useFormatting`) — the currency-symbol/locale source. */
    fun settings(): Flow<Resource<JsonElement>>

    /**
     * `POST /tesla/charging/history/refresh[?vin]` — pull fresh history from Tesla (web
     * `useRefreshTeslaChargingHistory`). Non-throwing [Result]; the view-model re-collects the history feed on
     * success (the web `invalidateQueries` ⇒ refetch).
     */
    suspend fun refreshHistory(vin: String?): Result<JsonElement>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [SettingsStore] and the shared **S7**
 * [ChargingRepository] — the memoized, multi-observer feeds the app shares plus the cache-then-network charging
 * feed every charging surface reaches through. The live values flow through unchanged so the view-model renders
 * the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun teslaChargingHistoryPageSourceOf(
    vehiclesStore: VehiclesStore,
    chargingRepository: ChargingRepository,
    settingsStore: SettingsStore,
): TeslaChargingHistoryPageSource =
    object : TeslaChargingHistoryPageSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun teslaChargingHistory(vin: String?): Flow<Resource<JsonElement>> =
            chargingRepository.teslaChargingHistory(vin)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override suspend fun refreshHistory(vin: String?): Result<JsonElement> =
            chargingRepository.refreshTeslaChargingHistory(vin = vin)
    }
