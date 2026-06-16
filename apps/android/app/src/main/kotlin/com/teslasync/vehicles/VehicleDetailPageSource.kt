// The data seam the VehicleDetailPage vehicles surface binds to, plus its production binding over the shared resilient
// client and the shared Settings holder. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web page's declared reads: `useVehicleSettings(vehicleId)`
// (`GET /vehicles/{vehicleId}/settings`, web/src/api/hooks/useVehicleSettings.ts) + the `findEffectiveSetting`
// selector, plus `useFormatting`/`useUnits` (the `/settings` document) for the display locale and the inline wake
// mutation (web `request('/vehicles/{id}/wake', { method: 'POST' })`).
//
// The per-vehicle settings read goes through the shared **S7** [HttpVehiclesRepository]'s underlying resilient
// [ApiHttpClient] (`safeRequest`) — exactly as the sibling SharedDrivePage / MediaPlayerPage sources do for their
// inline reads, since the page issues these through its `request()` client rather than a dedicated domain store —
// wrapped here into the cache-then-network [Resource] shape the view-model projects to
// [io.teslasync.android.data.UiState] (loading -> success/error). The Android module adds no networking of its own.
// The settings feed is the shared [SettingsStore] cache-then-network stream. A narrow seam so the view-model depends
// on an abstraction (real adapter <-> test fake), never on a concrete client or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.vehicles.vehicledetail

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [VehicleDetailPageViewModel] depends on so it binds to an abstraction (the shared resilient
 * client + the shared settings holder in production, fakes in tests), never to a concrete client or the network. The
 * per-vehicle settings read is the page's one cache-then-network `Resource` feed (the web `useVehicleSettings`);
 * settings backs the display locale; [wakeVehicle] is the page's one-shot wake mutation (web `onWake`). No HTTP
 * touches the view.
 */
interface VehicleDetailPageSource {
    /**
     * The `GET /vehicles/{vehicleId}/settings` feed (web `useVehicleSettings` ▸ `request(...)`), surfaced as a
     * cache-then-network [Resource] stream: [Resource.Loading] first, then exactly one terminal [Resource.Success]
     * (the raw resolver envelope) or [Resource.Error].
     */
    fun vehicleSettings(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useFormatting`/`useUnits` source). */
    fun settings(): Flow<Resource<JsonElement>>

    /**
     * Fires the `POST /vehicles/{vehicleId}/wake` command (web `wakeMutation`), returning success or the transport
     * failure so the view-model can surface the localized wake-success / wake-failure toast (web `toast`).
     */
    suspend fun wakeVehicle(vehicleId: Long): Result<Unit>
}

/**
 * Binds the surface to the shared resilient [api] + the shared [SettingsStore]. The settings read + the wake command
 * run on the same `safeRequest` client every repository uses (so the resilience seam is identical); the settings read
 * is folded into a one-shot loading -> success/error [Resource] stream, the settings document flows through unchanged
 * so the view-model renders the full state matrix (loading / content / error), and the wake POST collapses to a
 * `Result<Unit>`. No HTTP touches the view.
 */
fun vehicleDetailPageSourceOf(
    api: ApiHttpClient,
    settingsStore: SettingsStore,
): VehicleDetailPageSource =
    object : VehicleDetailPageSource {
        override fun vehicleSettings(vehicleId: Long): Flow<Resource<JsonElement>> =
            resourceFlow {
                api.safeRequest<JsonElement>(path = "/vehicles/$vehicleId/settings")
            }

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override suspend fun wakeVehicle(vehicleId: Long): Result<Unit> =
            api
                .safeRequest<JsonElement>(method = HttpMethodKind.POST, path = "/vehicles/$vehicleId/wake")
                .map { }
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
