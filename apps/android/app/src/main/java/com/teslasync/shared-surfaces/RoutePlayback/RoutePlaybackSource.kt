// The data seam the RoutePlayback surface binds to for the replay track, plus its production binding over
// the shared S8 Driving holder. The view (composable) performs NO HTTP — it only collects state from the
// ViewModel, which drives this seam, satisfying the "no direct HTTP from the view" contract (ADR-002) while
// reproducing the web data path that produces the widget's `points` prop.
//
// In the web app the widget is *controlled*: its `points` come from the drive's GPS feed — the
// `MapOverviewPage`/`TripReplayPage` build `PlaybackPoint[]` from `useDrivePositions(driveId)`
// (`GET /drives/{id}/positions`). The native self-contained surface reproduces that exact path: this seam
// binds the shared [io.teslasync.shared.core.presentation.driving.DrivingStore] `drivePositions` feed (the
// P1/S8 holder, web `useDrivePositions`) and projects each cache-then-network [Resource] of raw positions
// JSON onto a [Resource] of the built [RoutePlaybackTrack]. Because it is the real cache-then-network feed,
// every prompt state — loading / content / empty / stale / offline / error — renders from a genuine
// `Resource` lifecycle rather than being fabricated (covenant: no silent drift). A test fake / a static host
// source stand in for the whole layer so the surface is verified off-device and previewed deterministically.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RoutePlayback) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located binding adapters.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.routeplayback

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.driving.DrivingStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [RoutePlaybackViewModel] depends on, so it binds to an abstraction (real S8 adapter ↔
 * test fake ↔ static host source) rather than to a concrete client — the Android counterpart of the web
 * `useDrivePositions → points` data path (P1/S8 state-holder boundary). [track] streams the drive's replay
 * track as a cache-then-network [Resource]; transport faults surface as [Resource.Error] (keeping any cached
 * track visible), never as a thrown exception. No HTTP touches the view.
 */
fun interface RoutePlaybackSource {
    /** Streams the replay track for the bound drive (web `useDrivePositions(driveId)`, mapped to samples). */
    fun track(): Flow<Resource<RoutePlaybackTrack>>
}

/**
 * Binds the surface to the shared S8 [DrivingStore] — the same holder every Driving screen observes. The
 * `drivePositions(driveId)` feed (web `useDrivePositions`, `safeArray`-guarded `GET /drives/{id}/positions`)
 * is projected from a [Resource] of raw positions JSON onto a [Resource] of the built [RoutePlaybackTrack],
 * preserving the cache / freshness / error semantics so the widget shows last-known frames offline and a
 * classified retry on a hard failure.
 */
fun DrivingStore.asRoutePlaybackSource(driveId: String): RoutePlaybackSource =
    RoutePlaybackSource { drivePositions(driveId).map { it.toTrackResource() } }

/**
 * A host-provided source for a drive whose positions are already in hand (the web "controlled" case where
 * the parent passes the built `points` straight to the widget). Emits a single fresh [Resource.Success] —
 * used by previews, tests, and any caller that already holds the track.
 */
fun staticRoutePlaybackSource(
    track: RoutePlaybackTrack,
    fetchedAtMillis: Long = 0L,
): RoutePlaybackSource = RoutePlaybackSource { flowOf(Resource.Success(track, fetchedAtMillis, stale = false)) }

/**
 * Projects a [Resource] of raw `/drives/{id}/positions` JSON onto a [Resource] of the built
 * [RoutePlaybackTrack] via [RoutePlaybackTrack.fromPositions], carrying cache / freshness / error through
 * 1:1 so the data layer's `Resource → UiState` contract keeps working unchanged.
 */
private fun Resource<JsonElement>.toTrackResource(): Resource<RoutePlaybackTrack> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(RoutePlaybackTrack::fromPositions),
                fetchedAt = fetchedAt,
                stale = stale,
            )
        is Resource.Success ->
            Resource.Success(
                data = RoutePlaybackTrack.fromPositions(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )
        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(RoutePlaybackTrack::fromPositions),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }
