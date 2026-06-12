// The data seam the Backend Status feature view binds to, plus its production bindings over the shared
// state holders / repositories. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, satisfying the "no direct HTTP from the view" contract while
// reproducing the web component's three hooks (`useQuery(getExtendedHealth)`, `useConnectionPool`,
// `useQuery(getVersionInfo)`).
//
// Two of the three feeds are the raw verbatim server JSON the shared S8 AdminStore already exposes
// (`/system/health` ▸ systemHealth, `/dev-tools/runtime-info` ▸ connectionPool). The third
// (`/system/version`) has no raw-JSON holder — the canonical S8 SettingsStore decodes it into the typed
// VersionInfo — so, exactly like the sibling VersionInfoWidget, the binding re-encodes that typed payload
// back to its JSON form and the seam exposes JSON. The pure projection then reads the web's exact snake_case
// field names: go_version / os / arch render live (the contract carries them) while uptime_seconds /
// goroutines collapse to absent and fall through to extHealth.system — the web `version?.x ?? system?.x`
// chain — and the surface lights up automatically if the contract ever grows the field.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackendStatusSection) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backendstatussection

import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.settings.VersionInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.SerializationStrategy
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Streams the three cache-then-network feeds the surface needs, each as raw JSON: the extended-health
 * envelope (`GET /system/health`, web `getExtendedHealth`), the connection-pool / runtime-info envelope
 * (`GET /dev-tools/runtime-info`, web `useConnectionPool`), and the re-encoded version envelope
 * (`GET /system/version`, web `getVersionInfo`). A narrow seam so the view-model depends on an abstraction
 * (real adapter ↔ test fake), never on a concrete store/repository or the network. Each (re)collection is a
 * fresh cache-then-network [Resource] stream, so the view-model's refresh trigger re-subscribing performs
 * the web `refetch()`.
 */
interface BackendStatusSectionSource {
    /** The cache-then-network, raw-JSON `GET /system/health` feed (web `getExtendedHealth`). */
    fun systemHealth(): Flow<Resource<JsonElement>>

    /** The cache-then-network, raw-JSON `GET /dev-tools/runtime-info` feed (web `useConnectionPool`). */
    fun connectionPool(): Flow<Resource<JsonElement>>

    /** The cache-then-network version feed as JSON (web `getVersionInfo`), re-encoded from the typed payload. */
    fun versionInfo(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** holders — the memoized, multi-observer feeds every Admin/Settings
 * surface shares (incl. their standard-cadence background refresh). Use this when a host wants the surface to
 * fold into the same shared collections as the rest of the app; the live values flow through unchanged. The
 * typed version payload is re-encoded to its JSON form so the projection reads the web's field set. No HTTP
 * touches the view.
 */
fun AdminStore.asBackendStatusSectionSource(settings: SettingsStore): BackendStatusSectionSource {
    val admin = this
    return object : BackendStatusSectionSource {
        override fun systemHealth(): Flow<Resource<JsonElement>> = admin.systemHealth()

        override fun connectionPool(): Flow<Resource<JsonElement>> = admin.connectionPool()

        override fun versionInfo(): Flow<Resource<JsonElement>> = settings.versionInfo().map { it.toJson(VersionInfo.serializer()) }
    }
}

/**
 * Binds the surface to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 holders
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * surface's manual refresh / error-retry affordance (the web `refetch()`). The typed version payload is
 * re-encoded to its JSON form for the projection. No HTTP touches the view.
 */
fun AdminRepository.asBackendStatusSectionSource(settings: SettingsRepository): BackendStatusSectionSource {
    val admin = this
    return object : BackendStatusSectionSource {
        override fun systemHealth(): Flow<Resource<JsonElement>> = admin.systemHealth()

        override fun connectionPool(): Flow<Resource<JsonElement>> = admin.connectionPool()

        override fun versionInfo(): Flow<Resource<JsonElement>> = settings.versionInfo().map { it.toJson(VersionInfo.serializer()) }
    }
}

// Default Json (encodeDefaults = false): a field left at its model default — i.e. absent on the wire — is
// omitted from the re-encoded object, so the projection reads it as absent and applies the web `?? '—'`
// / `?? 0`, exactly as the web reads it off the raw response.
private val backendStatusJson = Json

private fun <T> Resource<T>.toJson(serializer: SerializationStrategy<T>): Resource<JsonElement> =
    mapResource { backendStatusJson.encodeToJsonElement(serializer, it) }

/**
 * Apply [transform] to the value carried by a [Resource], preserving the freshness flags
 * (cached / refreshing / stale / offline + error) exactly. A non-present cached value stays absent so a
 * first-load Loading slot is never fabricated into empty content.
 */
internal fun <T, R> Resource<T>.mapResource(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
