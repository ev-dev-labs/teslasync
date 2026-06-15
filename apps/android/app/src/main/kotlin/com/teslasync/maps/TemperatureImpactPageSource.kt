// The data seam the TemperatureImpactPage surface binds to, plus its production binding over the shared resilient
// client, the app-scoped active-vehicle selection and the shared Settings holder. The view (composable) performs
// NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web page's reads:
// the `useSelectedVehicle` scope, the inline `useQuery`/`request<{ points }>('/analytics/temperature-impact?vehicle_id=…')`
// fetch, and `useUnits` (the `/settings` document).
//
// The analytics read has no shared **S7** repository port (the web page issues it inline through its `request()`
// client rather than a `useAnalytics` hook, and `AnalyticsRepository` carries no temperature-impact method), so —
// exactly as the sibling GeofencesPage source does for its single-row create/update — it goes through the SAME
// shared resilient [ApiHttpClient] (`safeRequest`) every repository runs on, wrapped here into the cache-then-network
// [Resource] shape the view-model projects to [io.teslasync.android.data.UiState] (loading → success/error). The
// Android module adds no networking of its own. The settings feed is the shared [SettingsStore] cache-then-network
// stream; the selection is the global active-vehicle scope. A narrow seam so the view-model depends on an
// abstraction (real adapter ↔ test fake), never on a concrete client or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.maps.temperatureimpact

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
 * The single seam the [TemperatureImpactPageViewModel] depends on so it binds to an abstraction (the shared
 * resilient client + the app-scoped selection + the shared settings holder in production, fakes in tests), never to
 * a concrete client or the network. The temperature-impact read is the page's one cache-then-network `Resource`
 * feed (the web `useQuery`); the selection is the global active-vehicle scope; settings backs the display units.
 * No HTTP touches the view.
 */
interface TemperatureImpactPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /**
     * The `GET /analytics/temperature-impact?vehicle_id={vehicleId}` feed (web inline `useQuery` ▸ `request(...)`),
     * surfaced as a cache-then-network [Resource] stream: [Resource.Loading] first, then exactly one terminal
     * [Resource.Success] (the raw `{ points }` envelope) or [Resource.Error].
     */
    fun temperatureImpact(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` source). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared resilient [api] + the app-scoped [SelectedVehicleStore] + the shared
 * [SettingsStore]. The temperature-impact read runs on the same `safeRequest` client every repository uses (so the
 * resilience + auth seams are identical) and is folded into a one-shot loading → success/error [Resource] stream;
 * the settings + selection flow through unchanged so the view-model renders the full state matrix
 * (loading / content / empty / error). No HTTP touches the view.
 */
fun temperatureImpactPageSourceOf(
    api: ApiHttpClient,
    selectedVehicleStore: SelectedVehicleStore,
    settingsStore: SettingsStore,
): TemperatureImpactPageSource =
    object : TemperatureImpactPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun temperatureImpact(vehicleId: String): Flow<Resource<JsonElement>> =
            flow {
                emit(Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false))
                val result =
                    api.safeRequest<JsonElement>(
                        path = "/analytics/temperature-impact",
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

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
