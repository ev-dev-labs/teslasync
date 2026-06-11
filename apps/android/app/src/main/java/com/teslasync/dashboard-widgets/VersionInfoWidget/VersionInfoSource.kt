// The data port the Version Info widget binds to — the native analogue of the two web hooks the component
// composes: `useVersionInfo` (GET /system/version) and `useCaptureStats` (GET
// /dev-tools/telemetry-capture/stats). See web/src/features/dashboard/widgets/VersionInfoWidget.tsx +
// web/src/api/hooks/useSettings.ts. The view never performs HTTP; a concrete adapter over the shared S7/S8
// Settings data layer (or a test fake) drives this seam. Cache-then-network freshness is preserved end to
// end (ADR-013): the view-model projects each emission's cached/stale/error flags onto the render surface.
//
// The canonical S8 Settings feeds decode the wire payload into the typed `VersionInfo` / `CaptureStats`
// contracts. The web component, by contrast, reads `version.data` / `capture.data` as untyped bags and pulls
// several fields that lie OUTSIDE those contracts (`build_date`, `git_commit`, `uptime`, `signals_per_sec`,
// `messages_today`, `bytes_processed`, `avg_processing_latency_ms`). To reproduce the web's reads verbatim,
// the binding helpers re-encode each typed payload back to its JSON form and the seam exposes JSON; the pure
// [VersionInfoProjection] then reads the web's exact snake_case names, so a field outside the contract
// collapses to the web `?? '—'` / `?? 0` while a field the contract carries (chart_version / go_version /
// os / arch) renders live — and the surface lights up automatically if the contract ever grows the field.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VersionInfoWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.versioninfo

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.settings.CaptureStats
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.settings.VersionInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.SerializationStrategy
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Streams the two cache-then-network feeds the widget needs, each as the re-encoded JSON form of its
 * canonical S8 payload: the [versionInfo] envelope (web `useVersionInfo`) and the [captureStats] envelope
 * (web `useCaptureStats`). A narrow two-method seam so the view-model depends on an abstraction (real
 * adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface VersionInfoSource {
    /** The cache-then-network `GET /system/version` feed as JSON (web `useVersionInfo`). */
    fun versionInfo(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /dev-tools/telemetry-capture/stats` feed as JSON (web `useCaptureStats`). */
    fun captureStats(): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S8** [SettingsStore] — the memoized, multi-observer feeds every Settings
 * surface shares. Use this when a host wants the widget to fold into the same shared collections as the rest
 * of the app; the live values (incl. the store's background refresh) flow through unchanged. Each typed
 * payload is re-encoded to its JSON form so the projection reads the web's untyped field set. No HTTP
 * touches the view.
 */
fun SettingsStore.asVersionInfoSource(): VersionInfoSource {
    val store = this
    return object : VersionInfoSource {
        override fun versionInfo(): Flow<Resource<JsonElement>> = store.versionInfo().map { it.toJson(VersionInfo.serializer()) }

        override fun captureStats(): Flow<Resource<JsonElement>> = store.captureStats().map { it.toJson(CaptureStats.serializer()) }
    }
}

/**
 * Binds the widget to the shared **S7** [SettingsRepository] — the cold cache-then-network `Flow`s the S8
 * [SettingsStore] also wraps. Re-collecting either feed performs a genuine cache-then-network re-fetch,
 * which is what backs the widget's manual refresh / error-retry affordance (the web `refetch()`). Each typed
 * payload is re-encoded to its JSON form for the projection. No HTTP touches the view.
 */
fun SettingsRepository.asVersionInfoSource(): VersionInfoSource {
    val repo = this
    return object : VersionInfoSource {
        override fun versionInfo(): Flow<Resource<JsonElement>> = repo.versionInfo().map { it.toJson(VersionInfo.serializer()) }

        override fun captureStats(): Flow<Resource<JsonElement>> = repo.captureStats().map { it.toJson(CaptureStats.serializer()) }
    }
}

// Default Json (encodeDefaults = false): a field left at its model default — i.e. absent on the wire — is
// omitted from the re-encoded object, so the projection reads it as absent and applies the web `?? '—'` /
// `?? 0`, exactly as the web reads it off the raw response.
private val widgetJson = Json

private fun <T> Resource<T>.toJson(serializer: SerializationStrategy<T>): Resource<JsonElement> =
    mapResource { widgetJson.encodeToJsonElement(serializer, it) }

private fun <T, R> Resource<T>.mapResource(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
