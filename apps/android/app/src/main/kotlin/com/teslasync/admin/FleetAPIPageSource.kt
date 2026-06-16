// The data seam the FleetAPIPage admin surface binds to, plus its production binding over the shared S8
// SettingsStore. The view (composable) performs NO HTTP — it only collects state from the view-model, which
// drives this seam, reproducing the web page's four TanStack-Query reads + two mutations (`useSettings`,
// `usePollingConfig`, `useCaptureStats`, `useVersionInfo`, `useToggleAPISuspend`, `useUpdatePollingConfig`).
//
// The reads are the cache-then-network [Resource] streams the shared S8 SettingsStore already exposes (the
// settings document as a verbatim JsonElement, plus the typed PollingConfig / CaptureStats / VersionInfo); the
// two mutations are the store's own non-throwing suspend [Result]s, which each refresh EXACTLY the feeds the
// matching web hook invalidates (toggle-suspend → settings; update-polling-config → polling-config +
// capture-stats). A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never
// on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.fleetapi

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.ApiSuspendResult
import io.teslasync.shared.core.presentation.settings.CaptureStats
import io.teslasync.shared.core.presentation.settings.PollingConfig
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.settings.VersionInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [FleetAPIPageViewModel] depends on so it binds to an abstraction (the shared Settings
 * holder in production, a fake in tests), never to a concrete store or the network. The four reads are
 * cache-then-network `Resource` flows (the web read hooks); the two mutations are the non-throwing patches the
 * web page fires (web `useToggleAPISuspend` / `useUpdatePollingConfig`), each of which refreshes the affected
 * feeds inside the store so the page self-updates. No HTTP touches the view.
 */
interface FleetApiSource {
    /** The raw-JSON `GET /settings` document feed (web `useSettings`); `api_suspended` is the read field. */
    fun settings(): Flow<Resource<JsonElement>>

    /** The typed `GET /settings/polling-config` feed (web `usePollingConfig`). */
    fun pollingConfig(): Flow<Resource<PollingConfig>>

    /** The typed `GET /dev-tools/telemetry-capture/stats` feed (web `useCaptureStats`). */
    fun captureStats(): Flow<Resource<CaptureStats>>

    /** The typed `GET /system/version` feed (web `useVersionInfo`). */
    fun versionInfo(): Flow<Resource<VersionInfo>>

    /** Suspends / resumes Fleet-API polling (web `useToggleAPISuspend`); refreshes the settings feed. */
    suspend fun toggleApiSuspend(suspended: Boolean): Result<ApiSuspendResult>

    /** Saves the full polling config (web `useUpdatePollingConfig`); refreshes polling-config + capture-stats. */
    suspend fun updatePollingConfig(config: PollingConfig): Result<PollingConfig>
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] — the memoized, multi-observer settings feeds the app
 * shares app-wide (it also backs the live unit formatter). The live values flow through unchanged so the
 * view-model renders the full state matrix (loading / content / empty / error / stale / offline). Each mutation
 * already refreshes exactly the feeds the matching web hook invalidates, so the page self-updates. No HTTP
 * touches the view.
 */
fun SettingsStore.asFleetApiSource(): FleetApiSource {
    val store = this
    return object : FleetApiSource {
        override fun settings(): Flow<Resource<JsonElement>> = store.settings()

        override fun pollingConfig(): Flow<Resource<PollingConfig>> = store.pollingConfig()

        override fun captureStats(): Flow<Resource<CaptureStats>> = store.captureStats()

        override fun versionInfo(): Flow<Resource<VersionInfo>> = store.versionInfo()

        override suspend fun toggleApiSuspend(suspended: Boolean): Result<ApiSuspendResult> =
            store.toggleApiSuspend(suspended)

        override suspend fun updatePollingConfig(config: PollingConfig): Result<PollingConfig> =
            store.updatePollingConfig(config)
    }
}
