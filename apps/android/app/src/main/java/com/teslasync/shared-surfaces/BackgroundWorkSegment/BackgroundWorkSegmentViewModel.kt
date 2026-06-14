// UI-thread-free state holder backing the BackgroundWorkSegment surface — the native port of the state the web
// component owns across its hook composition (web/src/components/layout/status-bar/BackgroundWorkSegment.tsx +
// web/src/hooks/useBackgroundJobs.ts). It binds the two signal seams (P1/S8, ADR-002): the export feed through
// [BackgroundExportsSource] (no HTTP touches the view) and the mutation + custom jobs through the module-scoped
// [BackgroundJobRegistry]. It folds them into the single [BackgroundWorkState] the composable renders, exposes
// the error-surface retry action, and emits the one PII-safe `view.opened` diagnostic (P1/S11). The view never
// performs HTTP — it only collects [state] and forwards [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/BackgroundWorkSegment) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.backgroundworksegment

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * State holder for the footer background-work segment — the Android port of the web component over its
 * `useBackgroundJobs()` aggregation.
 *
 * It re-collects the injected [source]'s cache-then-network export feed (the P1/S8 boundary), projects each
 * emission onto the shared [io.teslasync.android.data.UiState], and [combine]s it with the live
 * [BackgroundJobRegistry] mutation + custom jobs through [foldBackgroundWork] — re-sharing the merged
 * [BackgroundWorkState] as a lifecycle-aware [state] flow so the segment reflects the latest work without
 * owning any state itself. The state is PII-free: it carries only the work rows' titles/kinds, never a payload.
 *
 * [retry] re-runs the cache-then-network export load (backing the error surface's retry affordance) and emits
 * the PII-safe retry diagnostic; [onViewOpened] emits the P1/S11 `view.opened` event exactly once per surface
 * open.
 *
 * @param source the cache-then-network export seam (a shared-data-layer adapter in production, a fake in tests).
 * @param registry the module-scoped mutation + custom-job store (defaults to the process-wide [backgroundJobs]).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the retry event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BackgroundWorkSegmentViewModel(
    private val source: BackgroundExportsSource,
    private val registry: BackgroundJobRegistry = backgroundJobs,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network export feed (the error surface's retry), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val exportsUi: Flow<UiState<List<BackgroundJob>>> =
        refreshTrigger
            .flatMapLatest { source.activeExports() }
            .map { it.toUiState() }

    /**
     * The merged work as a lifecycle-aware [BackgroundWorkState]: loading / content / empty / error, carrying
     * the stale / offline / refreshing freshness flags over any cached export rows. Collected only while the
     * segment is on-screen ([SharingStarted.WhileSubscribed]); the initial value folds a first-load export
     * state with whatever is already registered, so the first frame is never an artificial blank.
     */
    val state: StateFlow<BackgroundWorkState> =
        combine(exportsUi, registry.jobs) { exports, registered -> foldBackgroundWork(exports, registered) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = foldBackgroundWork(UiState.loading(), registry.jobs.value),
            )

    /** Re-runs the cache-then-network export load (the error surface's retry) and logs the PII-safe diagnostic. */
    fun retry() {
        BackgroundWorkSegmentDiagnostics.recordRetry(logger)
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no job label, count, or payload, so a diagnostics line can never leak what work was in flight.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        BackgroundWorkSegmentDiagnostics.recordViewOpened(logger)
    }

    companion object {
        /** Wires the surface from the shared S8 [ExportsStore] (the export signal) + the module-scoped registry. */
        fun create(
            exports: ExportsStore,
            logger: Logger,
            registry: BackgroundJobRegistry = backgroundJobs,
        ): BackgroundWorkSegmentViewModel =
            BackgroundWorkSegmentViewModel(
                source = exports.asBackgroundExportsSource(),
                registry = registry,
                logger = logger,
            )

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: BackgroundExportsSource,
            logger: Logger,
            registry: BackgroundJobRegistry = backgroundJobs,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { BackgroundWorkSegmentViewModel(source, registry, logger) }
            }
    }
}
