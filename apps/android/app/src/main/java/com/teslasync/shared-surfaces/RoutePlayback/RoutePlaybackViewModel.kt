// UI-thread-free state holder backing the RoutePlayback surface — the native port of the lifecycle the web
// component depends on for its `points` prop (web/src/components/maps/RoutePlayback.tsx fed by
// web/src/api/hooks/useDriving.ts `useDrivePositions`). It binds the drive's GPS feed through the shared S8
// [RoutePlaybackSource] (no HTTP touches the view, ADR-002), folds each cache-then-network [Resource] into
// the surface's [RoutePlaybackState], and emits the one PII-safe `view.opened` diagnostic (P1/S11). The
// replay clock itself is owned by the atomic map widget (a Compose `remember`); the view never performs HTTP
// or timing — it only collects [state] and forwards the retry action.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RoutePlayback) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.routeplayback

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.driving.DrivingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * State holder for the route-replay widget.
 *
 * The replay track is folded from the shared [RoutePlaybackSource] (web `useDrivePositions`) through the
 * data layer's `Resource → UiState` contract, so the surface renders the real loading / content / empty /
 * stale / offline / error lifecycle. [retry] re-collects the feed after a failure (backing the error /
 * offline surface's retry affordance) and [onViewOpened] emits the single PII-safe `view.opened` diagnostic.
 *
 * @param source the replay-track seam (an S8 `DrivingStore` adapter in production, a fake/static in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class RoutePlaybackViewModel(
    private val source: RoutePlaybackSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val trackUi = MutableStateFlow(UiState.loading<RoutePlaybackTrack>())

    private var collectionJob: Job? = null
    private var viewOpenedRecorded = false

    /** The folded surface state, driven by every source emission. */
    private val mutableState = MutableStateFlow(fold(trackUi.value))

    /** The live surface state the view collects; `.value` is always the latest folded snapshot. */
    val state: StateFlow<RoutePlaybackState> = mutableState.asStateFlow()

    init {
        startCollecting()
        stateScope.launch {
            trackUi.collect { mutableState.value = fold(it) }
        }
    }

    /** Re-collects the track feed after a failure — backs the error/offline surface's retry affordance. */
    fun retry() {
        collectionJob?.cancel()
        startCollecting()
    }

    /** Emits the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        RoutePlaybackDiagnostics.recordViewOpened(logger)
    }

    private fun startCollecting() {
        collectionJob =
            stateScope.launch {
                source.track().collect { resource ->
                    trackUi.value = resource.toUiState { it.isEmpty }
                }
            }
    }

    private fun fold(ui: UiState<RoutePlaybackTrack>): RoutePlaybackState =
        RoutePlaybackState(
            phase = ui.phase,
            track = ui.data ?: RoutePlaybackTrack.EMPTY,
            stale = ui.stale,
            refreshing = ui.refreshing,
            errorKind = ui.errorKind,
            httpStatus = ui.httpStatus,
        )

    companion object {
        /**
         * Wires the surface from the shared S8 [DrivingStore] for a specific drive (the web replay route's
         * `:id` param) — `driving.asRoutePlaybackSource(driveId)` binds the `drivePositions` feed.
         */
        fun create(
            driving: DrivingStore,
            driveId: String,
            logger: Logger,
        ): RoutePlaybackViewModel =
            RoutePlaybackViewModel(
                source = driving.asRoutePlaybackSource(driveId),
                logger = logger,
            )

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            driving: DrivingStore,
            driveId: String,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { create(driving, driveId, logger) }
            }
    }
}
