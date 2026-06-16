// The data seam the ClimateControlPage surface binds to, plus its production binding over the shared resilient
// client, the app-scoped active-vehicle selection and the shared Settings holder. The view (composable) performs
// NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web page's reads:
// the `useSelectedVehicle` scope, the `useClimate`/`useClimateHistory`/`useChargingTelemetryLatest` queries, and
// `useUnits` (the `/settings` document).
//
// None of the three climate reads has a shared **S7** repository port (the web page issues them inline through its
// `request()` client rather than a domain hook with a store, and no repository carries a climate method), so —
// exactly as the sibling TemperatureImpactPage source does for its inline analytics read — each goes through the
// SAME shared resilient [ApiHttpClient] (`safeRequest`) every repository runs on, wrapped here into the
// cache-then-network [Resource] shape the view-model projects to [io.teslasync.android.data.UiState]
// (loading → success/error). The Android module adds no networking of its own. The settings feed is the shared
// [SettingsStore] cache-then-network stream; the selection is the global active-vehicle scope. A narrow seam so the
// view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete client or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.climatecontrol

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [ClimateControlPageViewModel] depends on so it binds to an abstraction (the shared resilient
 * client + the app-scoped selection + the shared settings holder in production, fakes in tests), never to a concrete
 * client or the network. The three climate reads are the page's cache-then-network `Resource` feeds (the web
 * queries); the selection is the global active-vehicle scope; settings backs the display units. No HTTP touches the
 * view.
 */
interface ClimateControlPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /**
     * The `GET /climate/latest?vehicle_id={id}` snapshot feed (web `useClimate`), surfaced as a cache-then-network
     * [Resource] stream: [Resource.Loading] first, then exactly one terminal [Resource.Success] (the raw climate
     * map) or [Resource.Error].
     */
    fun climateLatest(vehicleId: String): Flow<Resource<JsonElement>>

    /** The `GET /climate?vehicle_id={id}` history feed (web `useClimateHistory`), as a cache-then-network stream. */
    fun climateHistory(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * The `GET /charging-telemetry/latest?vehicle_id={id}` feed (web `useChargingTelemetryLatest`); only its
     * `not_enough_power_to_heat` flag is read, for the HVAC banner alert.
     */
    fun chargingTelemetryLatest(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` source). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared resilient [api] + the app-scoped [SelectedVehicleStore] + the shared
 * [SettingsStore]. Each climate read runs on the same `safeRequest` client every repository uses (so the resilience
 * + auth seams are identical) and is folded into a one-shot loading → success/error [Resource] stream; the settings
 * + selection flow through unchanged so the view-model renders the full state matrix (loading / content / empty /
 * error). No HTTP touches the view.
 */
fun climateControlPageSourceOf(
    api: ApiHttpClient,
    selectedVehicleStore: SelectedVehicleStore,
    settingsStore: SettingsStore,
): ClimateControlPageSource =
    object : ClimateControlPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun climateLatest(vehicleId: String): Flow<Resource<JsonElement>> =
            jsonGet(api, "/climate/latest", vehicleId)

        override fun climateHistory(vehicleId: String): Flow<Resource<JsonElement>> =
            jsonGet(api, "/climate", vehicleId)

        override fun chargingTelemetryLatest(vehicleId: String): Flow<Resource<JsonElement>> =
            jsonGet(api, "/charging-telemetry/latest", vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }

/**
 * Issues `GET {path}?vehicle_id={vehicleId}` on the shared resilient [api] and folds it into a one-shot
 * cache-then-network [Resource] stream (loading → success/error). The same shape the repositories emit, so the
 * view-model projects every read through one [io.teslasync.android.data.UiState] path.
 */
private fun jsonGet(
    api: ApiHttpClient,
    path: String,
    vehicleId: String,
): Flow<Resource<JsonElement>> =
    flow {
        emit(Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false))
        val result =
            api.safeRequest<JsonElement>(
                path = path,
                query = mapOf("vehicle_id" to vehicleId),
            )
        result.fold(
            onSuccess = { payload ->
                emit(Resource.Success(payload, fetchedAt = System.currentTimeMillis(), stale = false))
            },
            onFailure = { error ->
                emit(Resource.Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = error))
            },
        )
    }
