// The data seam the MediaPlayerPage vehicle-systems surface binds to, plus its production binding over the shared
// resilient client, the app-scoped active-vehicle selection and the shared Settings holder. The view (composable)
// performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web page's
// reads: `useQuery(['media','latest'])` (`GET /media/latest?vehicle_id=`), `useQuery(['media','history'])`
// (`GET /media?vehicle_id=&limit=500`), the global `useSelectedVehicle` scope, and `useUnits`/`useFormatting` (the
// `/settings` document).
//
// The two media reads have no shared **S7** repository port (the web page issues them inline through its `request()`
// client rather than domain hooks, and no media repository exists), so — exactly as the sibling SharedDrivePage /
// TemperatureImpactPage sources do for their inline reads — they go through the SAME shared resilient [ApiHttpClient]
// (`safeRequest`) every repository runs on, wrapped here into the cache-then-network [Resource] shape the view-model
// projects to [io.teslasync.android.data.UiState] (loading → success/error). The Android module adds no networking of
// its own. The settings feed is the shared [SettingsStore] cache-then-network stream. A narrow seam so the view-model
// depends on an abstraction (real adapter ↔ test fake), never on a concrete client or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.mediaplayer

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
 * The single seam the [MediaPlayerPageViewModel] depends on so it binds to an abstraction (the shared resilient client
 * + the app-scoped selection + the shared settings holder in production, fakes in tests), never to a concrete client
 * or the network. The latest-snapshot + history reads are the page's two cache-then-network `Resource` feeds (the web
 * `useQuery` reads); the selection is the global active-vehicle scope; settings backs the display locale. No HTTP
 * touches the view.
 */
interface MediaPlayerPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /**
     * The `GET /media/latest?vehicle_id={id}` feed (web `useQuery(['media','latest'])`), surfaced as a
     * cache-then-network [Resource] stream: [Resource.Loading] first, then exactly one terminal [Resource.Success]
     * (the raw snapshot envelope) or [Resource.Error].
     */
    fun latestMedia(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * The `GET /media?vehicle_id={id}&limit=500` listening-history feed (web `useQuery(['media','history'])`), surfaced
     * as a cache-then-network [Resource] stream.
     */
    fun mediaHistory(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`/`useFormatting` source). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared resilient [api] + the app-scoped [SelectedVehicleStore] + the shared [SettingsStore].
 * The two media reads run on the same `safeRequest` client every repository uses (so the resilience seam is identical)
 * and are each folded into a one-shot loading → success/error [Resource] stream; the settings flow through unchanged so
 * the view-model renders the full state matrix (loading / content / empty / error). No HTTP touches the view.
 */
fun mediaPlayerPageSourceOf(
    api: ApiHttpClient,
    selectedVehicleStore: SelectedVehicleStore,
    settingsStore: SettingsStore,
): MediaPlayerPageSource =
    object : MediaPlayerPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun latestMedia(vehicleId: String): Flow<Resource<JsonElement>> =
            resourceFlow {
                api.safeRequest<JsonElement>(
                    path = "/media/latest",
                    query = mapOf("vehicle_id" to vehicleId),
                )
            }

        override fun mediaHistory(vehicleId: String): Flow<Resource<JsonElement>> =
            resourceFlow {
                api.safeRequest<JsonElement>(
                    path = "/media",
                    query =
                        mapOf(
                            "vehicle_id" to vehicleId,
                            "limit" to MediaPlayerPageRegistration.HISTORY_LIMIT.toString(),
                        ),
                )
            }

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }

/** Wraps a one-shot `safeRequest` into the cache-then-network [Resource] stream the view-model projects to UiState. */
private fun resourceFlow(request: suspend () -> Result<JsonElement>): Flow<Resource<JsonElement>> =
    flow {
        emit(Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false))
        request().fold(
            onSuccess = { payload ->
                emit(Resource.Success(payload, fetchedAt = System.currentTimeMillis(), stale = false))
            },
            onFailure = { error ->
                emit(Resource.Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = error))
            },
        )
    }
