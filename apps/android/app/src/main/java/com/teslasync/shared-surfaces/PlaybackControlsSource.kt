// The data seam the PlaybackControls surface binds to for the replay timeline, plus its production
// binding over the shared S8 Driving holder. The view (composable) performs NO HTTP — it only collects
// state from the ViewModel, which drives this seam, satisfying the "no direct HTTP from the view"
// contract (ADR-002) while reproducing the web data path that produces the bar's props.
//
// In the web app the bar is *controlled*: its `progress/elapsed/total/isPlaying` props come from
// `useTripReplay`, which consumes `useDrivePositions(driveId)` (`GET /drives/{id}/positions`). The native
// self-contained surface reproduces that exact path: this seam binds the shared
// [io.teslasync.shared.core.presentation.driving.DrivingStore] `drivePositions` feed (the P1/S8 holder,
// web `useDrivePositions`) and projects each cache-then-network [Resource] of raw positions JSON onto a
// [Resource] of the built [ReplayTimeline]. Because it is the real cache-then-network feed, every prompt
// state — loading / content / empty / stale / offline / error — renders from a genuine `Resource`
// lifecycle rather than being fabricated (covenant: no silent drift). A test fake / a static host source
// stand in for the whole layer so the surface is verified off-device and previewed deterministically.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PlaybackControls) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located binding adapters.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.playbackcontrols

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.driving.DrivingStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [PlaybackControlsViewModel] depends on, so it binds to an abstraction (real S8
 * adapter ↔ test fake ↔ static host source) rather than to a concrete client — the Android counterpart of
 * the web `useDrivePositions → useTripReplay` data path (P1/S8 state-holder boundary). [timeline] streams
 * the drive's replay timeline as a cache-then-network [Resource]; transport faults surface as
 * [Resource.Error] (keeping any cached track visible), never as a thrown exception. No HTTP touches the
 * view.
 */
fun interface ReplayTimelineSource {
    /** Streams the replay timeline for the bound drive (web `useDrivePositions(driveId)`, mapped to offsets). */
    fun timeline(): Flow<Resource<ReplayTimeline>>
}

/**
 * Binds the surface to the shared S8 [DrivingStore] — the same holder every Driving screen observes. The
 * `drivePositions(driveId)` feed (web `useDrivePositions`, `safeArray`-guarded `GET /drives/{id}/positions`)
 * is projected from a [Resource] of raw positions JSON onto a [Resource] of the built [ReplayTimeline],
 * preserving the cache / freshness / error semantics so the bar shows last-known frames offline and a
 * classified retry on a hard failure.
 */
fun DrivingStore.asReplayTimelineSource(driveId: String): ReplayTimelineSource =
    ReplayTimelineSource { drivePositions(driveId).map { it.toTimelineResource() } }

/**
 * A host-provided source for a drive whose positions are already in hand (the web "controlled" case where
 * the parent passes `useTripReplay`'s output straight to the bar). Emits a single fresh [Resource.Success]
 * — used by previews, tests, and any caller that already holds the timeline.
 */
fun staticReplayTimelineSource(
    timeline: ReplayTimeline,
    fetchedAtMillis: Long = 0L,
): ReplayTimelineSource = ReplayTimelineSource { flowOf(Resource.Success(timeline, fetchedAtMillis, stale = false)) }

/**
 * Projects a [Resource] of raw `/drives/{id}/positions` JSON onto a [Resource] of the built
 * [ReplayTimeline] via [ReplayTimeline.fromPositions], carrying cache / freshness / error through 1:1 so
 * the data layer's `Resource → UiState` contract keeps working unchanged.
 */
private fun Resource<JsonElement>.toTimelineResource(): Resource<ReplayTimeline> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(ReplayTimeline::fromPositions),
                fetchedAt = fetchedAt,
                stale = stale,
            )
        is Resource.Success ->
            Resource.Success(
                data = ReplayTimeline.fromPositions(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )
        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(ReplayTimeline::fromPositions),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }
