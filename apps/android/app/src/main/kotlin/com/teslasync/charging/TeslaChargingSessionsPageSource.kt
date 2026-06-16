// The data seam the TeslaChargingSessionsPage surface binds to, plus its production binding over the shared-core
// charging repository + the shared Vehicles / Settings state holders. The view (composable) performs NO HTTP — it only
// collects state from the view-model, which drives this seam, reproducing the web page's three reads
// (`useTeslaChargingSessions` ▸ `GET /tesla/charging/sessions`, `useVehicles` ▸ `GET /vehicles`, the `/settings`
// document behind `useUnits`/`useFormatting`) and the one mutation (`useRefreshTeslaChargingSessions` ▸
// `POST /tesla/charging/sessions/refresh`).
//
// The sessions feed is the shared-core cache-then-network `Resource` stream the S7 [ChargingRepository] already exposes;
// the Android DI graph ([io.teslasync.android.data.DataContainer]) wires no ChargingStore yet, so the host constructs
// the shared [io.teslasync.shared.core.data.repo.HttpChargingRepository] over the SAME resilient client + offline cache
// the other repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical) and hands it in
// here. The vehicles list + settings document are served by the shared S8 holders the container already exposes. A
// narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete repository or
// the network.
//
// [mapSessions] reuses the co-located TeslaChargingSessionsMap feature view's decode (its `internal`
// `Resource<JsonElement>.toChargingSessions()`), so the embedded session-location map binds to the exact same
// cache-then-network feed the page reads, scoped to the same VIN — one fetch, one freshness contract.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.charging.teslachargingsessions

import io.teslasync.android.featureviews.teslachargingsessionsmap.TeslaChargingSession
import io.teslasync.android.featureviews.teslachargingsessionsmap.toChargingSessions
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [TeslaChargingSessionsPageViewModel] depends on so it binds to an abstraction (the shared
 * charging repository + the shared Vehicles / Settings holders in production, a fake in tests), never to a concrete
 * repository or the network. Every read is a cache-then-network `Resource` flow (the web read hooks); the refresh is a
 * non-throwing suspend `Result` (the web mutation). No HTTP touches the view.
 */
interface TeslaChargingSessionsPageSource {
    /** The cache-then-network `GET /vehicles` list feed for the VIN selector (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * The cache-then-network `GET /tesla/charging/sessions[?vin={vin}]` feed (web `useTeslaChargingSessions`). A `null`
     * [vin] fetches every business-account session ("All Vehicles").
     */
    fun teslaChargingSessions(vin: String?): Flow<Resource<JsonElement>>

    /**
     * The same `GET /tesla/charging/sessions` feed decoded to the map's session rows (web's `mapPoints` source), so the
     * embedded session-location map binds to the same fetch the page reads, scoped to the same [vin].
     */
    fun mapSessions(vin: String?): Flow<Resource<List<TeslaChargingSession>>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` / `useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>

    /**
     * Pulls fresh fleet charging sessions from Tesla (`POST /tesla/charging/sessions/refresh[?vin]`,
     * web `useRefreshTeslaChargingSessions`). Non-throwing: a business-account-only failure surfaces as an
     * [io.teslasync.shared.core.net.ApiError.Http] `403` the view-model maps to the "Business account required" hint.
     */
    suspend fun refreshTeslaChargingSessions(vin: String?): Result<JsonElement>
}

/**
 * Binds the surface to the shared **S7** [ChargingRepository] + the shared **S8** [VehiclesStore] / [SettingsStore] —
 * the memoized, multi-observer cache-then-network feeds every surface shares app-wide. The live values flow through
 * unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale / offline). No
 * HTTP touches the view.
 */
fun teslaChargingSessionsPageSourceOf(
    chargingRepository: ChargingRepository,
    vehiclesStore: VehiclesStore,
    settingsStore: SettingsStore,
): TeslaChargingSessionsPageSource =
    object : TeslaChargingSessionsPageSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun teslaChargingSessions(vin: String?): Flow<Resource<JsonElement>> =
            chargingRepository.teslaChargingSessions(vin)

        override fun mapSessions(vin: String?): Flow<Resource<List<TeslaChargingSession>>> =
            chargingRepository.teslaChargingSessions(vin).map { it.toChargingSessions() }

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override suspend fun refreshTeslaChargingSessions(vin: String?): Result<JsonElement> =
            chargingRepository.refreshTeslaChargingSessions(vin = vin)
    }
