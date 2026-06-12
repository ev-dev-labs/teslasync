// UI-thread-free state holder backing the ComputedMetricEditor feature view — the native port of the two
// hooks the web component owns (web/src/features/notifications/components/ComputedMetricEditor.tsx +
// web/src/api/hooks/useNotifications.ts): the `useAlertMetrics` registry feed (threaded into the web component
// as the `metrics` prop) and the `usePreviewComputedMetric` mutation. It binds the shared Notifications domain
// (P1/S8 NotificationsStore / S7 NotificationsRepository) through [ComputedMetricEditorSource]: it collects the
// cache-then-network `GET /alerts/metrics` [Resource] and projects it to a [UiState], owns the controlled
// editor value (the web parent's `useState`), and re-fires the `POST /alerts/test` preview whenever the value
// becomes ready or changes — exactly the web `useEffect` that calls `previewMut.mutate(...)`. The view never
// performs HTTP — it only collects the exposed flows and calls the trigger methods.
//
// Two render-layer concerns the web owns are reproduced here: the lazy `ready` gate (the preview only fires
// once a metric, window, operator, and finite threshold are all present — web `if (!ready) return`) and the
// in-flight cancellation (changing any operand cancels a stale preview and starts a fresh one — web's effect
// re-run, here `flatMapLatest`). [refreshMetrics] re-collects the registry feed (the web `invalidateQueries`
// / error-retry analogue).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ComputedMetricEditor) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.computedmetriceditor

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.ComputedMetricPreview
import io.teslasync.shared.core.presentation.notifications.ComputedMetricPreviewInput
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * The data port the editor binds to — the native analogue of the web `useAlertMetrics` + `usePreviewComputedMetric`
 * hooks. A concrete adapter over the shared Notifications data layer (or a test fake) drives this seam; the
 * view never performs HTTP.
 */
interface ComputedMetricEditorSource {
    /** The cache-then-network `GET /alerts/metrics` registry feed (web `useAlertMetrics`). */
    fun alertMetrics(): Flow<Resource<List<ComputedMetricSummary>>>

    /** The `POST /alerts/test` computed-metric preview (web `usePreviewComputedMetric`); never throws. */
    suspend fun previewComputedMetric(input: ComputedMetricPreviewInput): Result<ComputedMetricPreview>
}

/**
 * Binds the editor to the shared **S8** [NotificationsStore] — the memoized, multi-observer registry feed
 * every Notifications surface shares, and its non-throwing preview mutation. Use this when a host wants the
 * editor to fold into the same shared collection as the rest of the Alert Studio screens. No HTTP touches the
 * view.
 */
fun NotificationsStore.asComputedMetricEditorSource(): ComputedMetricEditorSource {
    val store = this
    return object : ComputedMetricEditorSource {
        override fun alertMetrics(): Flow<Resource<List<ComputedMetricSummary>>> = store.alertMetrics()

        override suspend fun previewComputedMetric(input: ComputedMetricPreviewInput): Result<ComputedMetricPreview> =
            store.previewComputedMetric(input)
    }
}

/**
 * Binds the editor to the shared **S7** [NotificationsRepository] — the cold cache-then-network registry
 * `Flow` and the direct preview mutation. Re-collecting the feed performs a genuine cache-then-network
 * re-fetch, which backs the editor's metric-registry retry. No HTTP touches the view.
 */
fun NotificationsRepository.asComputedMetricEditorSource(): ComputedMetricEditorSource {
    val repo = this
    return object : ComputedMetricEditorSource {
        override fun alertMetrics(): Flow<Resource<List<ComputedMetricSummary>>> = repo.alertMetrics()

        override suspend fun previewComputedMetric(input: ComputedMetricPreviewInput): Result<ComputedMetricPreview> =
            repo.previewComputedMetric(input)
    }
}

/**
 * @param source the cache-then-network Notifications seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only collects the registry feed and runs the preview mutation.
 * @param logger the single sanctioned redacting logger (ADR-016); receives only the PII-safe `view.opened` event.
 * @param vehicleId scopes the preview to one vehicle (web `vehicle_id`), or null for the whole fleet.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ComputedMetricEditorViewModel(
    private val source: ComputedMetricEditorSource,
    logger: Logger,
    vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val valueState = MutableStateFlow(ComputedMetricEditorValue(vehicleId = vehicleId))
    private var viewOpenedRecorded = false

    /** The controlled editor value (the web parent's `useState`); a host observes it as the `onChange` analogue. */
    val value: StateFlow<ComputedMetricEditorValue> = valueState

    /**
     * The metric-registry feed as a lifecycle-aware [UiState] (web `useAlertMetrics`). Empty registries map to
     * [io.teslasync.android.data.UiPhase.Empty]; bumping [refreshMetrics] re-collects the cache-then-network feed.
     */
    val metricsState: StateFlow<UiState<List<ComputedMetricSummary>>> =
        refreshTrigger
            .flatMapLatest { source.alertMetrics() }
            .asUiState { it.isEmpty() }

    /**
     * The live-preview state derived from the editor value (web `usePreviewComputedMetric` + its driving
     * `useEffect`). A not-ready value emits [PreviewUiState.Idle]; a ready value emits [PreviewUiState.Computing]
     * then the resolved [PreviewUiState.Value] / [PreviewUiState.Failure]. `flatMapLatest` cancels a stale
     * preview when any operand changes, exactly as the web effect re-runs.
     */
    val previewState: StateFlow<PreviewUiState> =
        valueState
            .map { previewRequest(it) }
            .distinctUntilChanged()
            .flatMapLatest { request -> previewFlow(request) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = PreviewUiState.Idle,
            )

    /** Selects [metricId], resetting the window/operator from the metric's definition (web `handleMetric`). */
    fun selectMetric(metricId: String) {
        val metrics = metricsState.value.data ?: emptyList()
        valueState.value = handleMetricSelection(valueState.value, metricId, metrics)
    }

    /** Selects the diagnostic [window] (web `onChange={... metric_window ...}`). */
    fun selectWindow(window: String) {
        valueState.update { it.copy(metricWindow = window) }
    }

    /** Selects the comparison [op] (web `onChange={... metric_op ...}`). */
    fun selectOperator(op: String) {
        valueState.update { it.copy(metricOp = op) }
    }

    /** Updates the raw threshold text (web `onChange={... metric_threshold ...}`); kept as a string for parity. */
    fun setThreshold(threshold: String) {
        valueState.update { it.copy(metricThreshold = threshold) }
    }

    /** Re-collects the metric-registry feed (the web error-retry / `invalidateQueries` analogue). */
    fun refreshMetrics() {
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no metric id, threshold, operator, or preview value. Call from the composable's first-composition
     * effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        ComputedMetricEditorDiagnostics.recordViewOpened(logger)
    }

    /**
     * The preview pipeline for one [request]: a null request (not ready) stays [PreviewUiState.Idle]; a present
     * request emits [PreviewUiState.Computing], runs the non-throwing mutation, then emits the resolved value or
     * a failure. The mutation is the only outbound call and lives entirely in the holder, never the view.
     */
    private fun previewFlow(request: ComputedMetricPreviewInput?): Flow<PreviewUiState> =
        if (request == null) {
            flowOf(PreviewUiState.Idle)
        } else {
            flow {
                emit(PreviewUiState.Computing)
                val result = source.previewComputedMetric(request)
                emit(result.fold({ PreviewUiState.Value(it) }, { PreviewUiState.Failure }))
            }
        }

    private companion object {
        /** Keep the upstream feeds alive briefly across config changes / fast re-subscribes. */
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
