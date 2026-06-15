// The data seam the SharedDrivePage sharing surface binds to, plus its production binding over the shared resilient
// client and the shared Settings holder. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web page's reads: the public, unauthenticated
// `useSharedDrive(token)` (`request<SharedDriveData>('/share/{token}')`) and `useUnits` (the `/settings` document).
//
// The share read has no shared **S7** repository port (the web page issues it inline through its `request()` client
// rather than a domain hook, and no sharing repository exists), so — exactly as the sibling TemperatureImpactPage /
// GeofencesPage sources do for their inline reads — it goes through the SAME shared resilient [ApiHttpClient]
// (`safeRequest`) every repository runs on, wrapped here into the cache-then-network [Resource] shape the view-model
// projects to [io.teslasync.android.data.UiState] (loading → success/error). The Android module adds no networking
// of its own. The settings feed is the shared [SettingsStore] cache-then-network stream. A narrow seam so the
// view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete client or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/sharing) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharing.shareddrive

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [SharedDrivePageViewModel] depends on so it binds to an abstraction (the shared resilient
 * client + the shared settings holder in production, fakes in tests), never to a concrete client or the network.
 * The share read is the page's one cache-then-network `Resource` feed (the web `useSharedDrive`); settings backs the
 * display units. No HTTP touches the view.
 */
interface SharedDrivePageSource {
    /**
     * The `GET /share/{token}` feed (web public `useSharedDrive` ▸ `request(...)`), surfaced as a cache-then-network
     * [Resource] stream: [Resource.Loading] first, then exactly one terminal [Resource.Success] (the raw shared-drive
     * envelope) or [Resource.Error] (an expired / revoked / missing token).
     */
    fun sharedDrive(token: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` source). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared resilient [api] + the shared [SettingsStore]. The public share read runs on the
 * same `safeRequest` client every repository uses (so the resilience seam is identical) and is folded into a
 * one-shot loading → success/error [Resource] stream; the settings flow through unchanged so the view-model renders
 * the full state matrix (loading / content / unavailable). The read is unauthenticated by route (the backend mounts
 * `/share/{token}` before the auth middleware), so no token is required. No HTTP touches the view.
 */
fun sharedDrivePageSourceOf(
    api: ApiHttpClient,
    settingsStore: SettingsStore,
): SharedDrivePageSource =
    object : SharedDrivePageSource {
        override fun sharedDrive(token: String): Flow<Resource<JsonElement>> =
            flow {
                emit(Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false))
                val result = api.safeRequest<JsonElement>(path = "/share/$token")
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
