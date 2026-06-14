// The data port the VersionSegment shared surface binds to — the native analogue of the three hooks the web
// component composes (web/src/components/layout/status-bar/VersionSegment.tsx):
//   • `useVersionInfo`  (GET /system/version)        — the version provenance feed;
//   • `useUpdateCheck`  (GET /system/update-check)   — the "update available" feed;
//   • `useChangelog`    (static catalog + local ack) — the unseen-entries summary.
// The view never performs HTTP; a concrete adapter over the shared S7/S8 layers (or a test fake) drives this
// seam (the P1/S8 boundary, ADR-002).
//
// VERSION PROVENANCE (the app_version / uptime parity bridge). The canonical S8 Settings feed decodes
// /system/version into the typed `VersionInfo` contract (chart_version / go_version / os / arch / endpoints /
// require_cookie_consent), which does NOT carry `app_version` or `uptime_seconds`, and that shared contract is
// outside this surface's allowed files. So — exactly as the sibling VersionInfoWidget reproduces the web's
// untyped reads — this adapter re-encodes each typed payload back to its JSON form and exposes JSON; the pure
// [VersionSegmentProjection] then reads the web's exact snake_case names, so a field outside the contract
// collapses to the web fallback while a field the contract carries renders live, and the surface lights up
// automatically if the contract ever grows the field. Every freshness flag (Loading/Success/Error +
// cached/stale) is preserved end to end (ADR-013).
//
// UPDATE-CHECK. The shared S7/S8 layers do not (yet) expose `/system/update-check`, and its contract is outside
// this surface's allowed files, so the seam takes the feed as a host-provided producer. The default
// [noUpdateAvailable] resolves to "no update" — the same rendered result the web shows when the update-check
// query has no data (`!!updateCheck?.update_available` ⇒ false) — so an unwired host is honest, never bogus; a
// host that owns the endpoint wires the real feed (documented divergence, not silent drift).
//
// CHANGELOG. The unseen summary is read from the shared ChangelogModal state holder (P1/S8) via
// [ChangelogSource.toVersionSegmentStatus], reusing its catalog + the pure useChangelog reducers rather than
// duplicating the semver/seen logic — the honest "bind to the shared holder" path.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/VersionSegment) cannot form a valid Kotlin package; `ktlint:standard:filename`
// / `MatchingDeclarationName` are suppressed for the co-located adapters alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.versionsegment

import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogModalModel
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogSource
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.settings.VersionInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * The seam the [VersionSegmentViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store, repository, or the network. [versionInfo] is the cache-then-network provenance feed
 * (web `useVersionInfo`, projected to JSON); [updateCheck] is the cache-then-network update feed (web
 * `useUpdateCheck`); [changelogStatus] is the snapshot of unseen changelog entries (web `useChangelog`). No HTTP
 * touches the view.
 */
interface VersionSegmentSource {
    /** The `GET /system/version` provenance as a cache-then-network JSON feed (web `useVersionInfo`). */
    fun versionInfo(): Flow<Resource<JsonElement>>

    /** The `GET /system/update-check` result as a cache-then-network feed (web `useUpdateCheck`). */
    fun updateCheck(): Flow<Resource<UpdateCheckInfo>>

    /**
     * The current unseen-changelog summary (web `useChangelog` → `hasUnseen` / `newEntries.length`). Read fresh
     * each call so the surface re-reads it after the changelog is viewed (the native analogue of the web
     * useSyncExternalStore re-render once the seen-version advances).
     */
    fun changelogStatus(): ChangelogStatus
}

/**
 * Builds a [VersionSegmentSource] from explicit producers — the test/host seam used to drive each feed
 * deterministically while exercising the real projection. [updateCheck] defaults to [noUpdateAvailable] and
 * [changelog] to [ChangelogStatus.None] so a caller can wire only the legs it needs.
 */
fun versionSegmentSource(
    versionInfo: () -> Flow<Resource<JsonElement>>,
    updateCheck: () -> Flow<Resource<UpdateCheckInfo>> = ::noUpdateAvailable,
    changelog: () -> ChangelogStatus = { ChangelogStatus.None },
): VersionSegmentSource =
    object : VersionSegmentSource {
        override fun versionInfo(): Flow<Resource<JsonElement>> = versionInfo()

        override fun updateCheck(): Flow<Resource<UpdateCheckInfo>> = updateCheck()

        override fun changelogStatus(): ChangelogStatus = changelog()
    }

/**
 * Binds the surface to the shared **S8** [SettingsStore] — the memoized, multi-observer `versionInfo()` feed
 * every Settings surface shares (the same feed the dashboard VersionInfoWidget reads). Each typed `VersionInfo`
 * emission is re-encoded to its JSON form, preserving every freshness flag. [updateCheck] is the host's update
 * feed (default "no update"); [changelog] is the unseen summary provider (typically a [ChangelogSource]). No
 * HTTP touches the view.
 */
fun SettingsStore.asVersionSegmentSource(
    updateCheck: () -> Flow<Resource<UpdateCheckInfo>> = ::noUpdateAvailable,
    changelog: () -> ChangelogStatus,
): VersionSegmentSource {
    val store = this
    return versionSegmentSource(
        versionInfo = { store.versionInfo().map { it.toVersionJson() } },
        updateCheck = updateCheck,
        changelog = changelog,
    )
}

/**
 * Binds the surface to the shared **S7** [SettingsRepository] — the cold cache-then-network `versionInfo()`
 * `Flow` the S8 [SettingsStore] also wraps. Re-collecting it performs a genuine cache-then-network re-fetch,
 * which backs the surface's refresh / error-retry affordance (the web `refetch()`). Each typed payload is
 * re-encoded to its JSON form. No HTTP touches the view.
 */
fun SettingsRepository.asVersionSegmentSource(
    updateCheck: () -> Flow<Resource<UpdateCheckInfo>> = ::noUpdateAvailable,
    changelog: () -> ChangelogStatus,
): VersionSegmentSource {
    val repo = this
    return versionSegmentSource(
        versionInfo = { repo.versionInfo().map { it.toVersionJson() } },
        updateCheck = updateCheck,
        changelog = changelog,
    )
}

/**
 * The default update feed: a single resolved "no update available" emission — the web `!!updateCheck?.
 * update_available` ⇒ `false` when the query has no data. Used when a host does not (yet) own
 * `/system/update-check`, so the surface honestly renders "up to date" rather than a bogus update.
 */
fun noUpdateAvailable(): Flow<Resource<UpdateCheckInfo>> = flowOf(Resource.Success(UpdateCheckInfo.None, fetchedAt = 0L, stale = false))

/**
 * Projects a [ChangelogSource] (the shared P1/S8 changelog holder) onto the [ChangelogStatus] this surface
 * reads, reusing the pure `useChangelog` reducer: the releases newer than the acknowledged seen-version are the
 * unseen set (web `newEntries`), and their presence + count drive the dot + the tooltip hint. Read on demand so
 * the summary tracks the acknowledgement as it advances.
 */
fun ChangelogSource.toVersionSegmentStatus(): ChangelogStatus {
    val newReleases = ChangelogModalModel.newReleases(releases, ack().seenVersion)
    return ChangelogStatus(hasUnseen = newReleases.isNotEmpty(), newCount = newReleases.size)
}

/**
 * The freshest known update view a `Resource<UpdateCheckInfo>` carries: the fresh value on success, else the
 * cached value replayed during a refresh or after a failed fetch, else [UpdateCheckInfo.None]. So a still-loading
 * or failed update feed never fabricates an update — it resolves to "no update", exactly like the web reading
 * `updateCheck?.update_available` with no data.
 */
fun Resource<UpdateCheckInfo>.latestKnownUpdate(): UpdateCheckInfo =
    when (this) {
        is Resource.Success -> data
        is Resource.Loading -> cached ?: UpdateCheckInfo.None
        is Resource.Error -> cached ?: UpdateCheckInfo.None
    }

// Default Json (encodeDefaults = false): a field left at its model default — i.e. absent on the wire — is
// omitted from the re-encoded object, so the projection reads it as absent and applies the web fallback, exactly
// as the web reads it off the raw response.
private val segmentJson = Json

/**
 * Re-encodes a `Resource<VersionInfo>` (web `useVersionInfo`) onto the `Resource<JsonElement>` provenance feed,
 * preserving every Loading/Success/Error + cached/stale flag so the lifecycle reaches the surface unchanged. The
 * typed contract carries chart_version / go_version / os / arch but not app_version / uptime_seconds, so those
 * names are simply absent in the re-encoded object and the projection applies the web fallback. `internal` so
 * the off-device unit gate exercises the adapter mapping directly.
 */
internal fun Resource<VersionInfo>.toVersionJson(): Resource<JsonElement> =
    mapResource { segmentJson.encodeToJsonElement(VersionInfo.serializer(), it) }

private fun <T, R> Resource<T>.mapResource(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
