// The data seam the ReloadPrompt surface binds to for the update-availability signal it reads — the native
// analogue of the web `useRegisterSW()` registration (web/src/components/feedback/ReloadPrompt.tsx). The view
// (composable) performs NO HTTP — it only collects state from the [ReloadPromptViewModel], which drives this
// seam (ADR-002), satisfying the "no direct HTTP from the view" contract. `useRegisterSW` is a client runtime
// capability rather than a REST hook, so the native seam is likewise a runtime signal: it streams the
// update-availability as a cache-then-network [Resource] so every prompt state — loading / Available /
// up-to-date / stale / offline / error — renders from a genuine `Resource` lifecycle rather than being
// fabricated (covenant: no silent drift). A concrete adapter backs it in production (the version-comparing
// poll, the native mirror of the service worker re-fetching the manifest); a static/host source backs
// previews and unit tests.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ReloadPrompt) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `ReloadPrompt*` filename cannot match the
// `ReloadPromptSource` seam plus its co-located adapter functions.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.reloadprompt

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * The single seam the [ReloadPromptViewModel] depends on, so it binds to an abstraction (real adapter ↔
 * host source ↔ test fake) rather than to a concrete client — the Android counterpart of the web
 * `useRegisterSW` registration (P1/S8 state-holder boundary). [availability] streams the update-availability
 * as a cache-then-network [Resource]; transport faults surface as [Resource.Error] (keeping any last-known
 * value visible), never as a thrown exception. No HTTP touches the view.
 */
fun interface ReloadPromptSource {
    /** Streams whether a newer build is waiting (web `useRegisterSW().needRefresh`). */
    fun availability(): Flow<Resource<ReloadAvailability>>
}

/**
 * A host-provided source for a caller that already holds the availability (previews, unit tests, and any host
 * whose update checker resolves to a single known state). Emits one fresh [Resource.Success] — the analogue
 * of the web `staticReplayTimelineSource` sibling pattern.
 */
fun staticReloadPromptSource(
    availability: ReloadAvailability,
    fetchedAtMillis: Long = 0L,
): ReloadPromptSource = ReloadPromptSource { flowOf(Resource.Success(availability, fetchedAtMillis, stale = false)) }

/**
 * Wraps a host's platform update-check [feed] (e.g. an in-app-update listener or a deployment-version poll)
 * as a [ReloadPromptSource]. The feed already carries the cache / freshness / error envelope, so the surface
 * renders its lifecycle 1:1. This is the seam a host wires its real update checker through without the view
 * ever touching it.
 */
fun reloadPromptSourceOf(feed: Flow<Resource<ReloadAvailability>>): ReloadPromptSource = ReloadPromptSource { feed }

/**
 * Derives availability by comparing the [runningVersion] (the build the app is currently running) against a
 * stream of the [latestVersions] known to the deployment — the native mirror of the web service worker
 * periodically re-fetching the manifest and flagging `needRefresh` when the served build differs from the
 * running one. The cache / freshness / error envelope is carried through 1:1 so the surface shows the
 * last-known answer offline and a classified retry on a hard failure.
 */
fun versionComparingReloadPromptSource(
    runningVersion: String,
    latestVersions: Flow<Resource<String>>,
): ReloadPromptSource = ReloadPromptSource { latestVersions.map { it.toAvailabilityResource(runningVersion) } }

/**
 * Projects a [Resource] of the latest deployed version string onto a [Resource] of [ReloadAvailability] by
 * comparing it to [runningVersion], carrying cache / freshness / error through 1:1 so the data layer's
 * `Resource → UiState` contract keeps working unchanged.
 */
private fun Resource<String>.toAvailabilityResource(runningVersion: String): Resource<ReloadAvailability> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let { it.toAvailability(runningVersion) },
                fetchedAt = fetchedAt,
                stale = stale,
            )
        is Resource.Success ->
            Resource.Success(
                data = data.toAvailability(runningVersion),
                fetchedAt = fetchedAt,
                stale = stale,
            )
        is Resource.Error ->
            Resource.Error(
                cached = cached?.let { it.toAvailability(runningVersion) },
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/** Builds the availability record for a latest-known version string relative to the [runningVersion]. */
private fun String.toAvailability(runningVersion: String): ReloadAvailability =
    ReloadAvailability(updateAvailable = this != runningVersion, version = this)
