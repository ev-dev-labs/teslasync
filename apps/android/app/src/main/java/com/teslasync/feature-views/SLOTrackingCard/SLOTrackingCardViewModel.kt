// UI-thread-free state holder backing the SLOTrackingCard feature view — the native port of the web
// component's `useQuery` + local target/window/edit state
// (web/src/features/system/components/status/SLOTrackingCard.tsx). It binds the [SLOTrackingCardSource]
// read seam (P1/S8) and the persisted [SloTargetStore], owns the selected window, projects each fetch onto
// the shared cache-then-network [UiState] (with last-known retention so a failed refresh shows the previous
// value as offline rather than blanking), exposes the personal target + the `setWindow` / `setTarget` /
// `refresh` actions, and emits the PII-safe one-shot `view.opened` diagnostic. The view performs NO HTTP —
// it only collects [uptime] / [window] / [target] and calls these actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SLOTrackingCard) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.slotrackingcard

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * @param source the `/status/uptime` read seam (a shared-client adapter in production, a fake in tests).
 *   The view-model owns no networking — it only drives this seam and projects the outcome.
 * @param targetStore the persisted personal-SLO target seam (SharedPreferences in production, in-memory in
 *   tests/previews) — the web localStorage analogue.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` carrying only the
 *   non-PII surface slug (never the uptime value, counts, or target).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param now wall-clock seam for the freshness stamp; injectable for deterministic tests.
 */
class SLOTrackingCardViewModel(
    private val source: SLOTrackingCardSource,
    private val targetStore: SloTargetStore,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val now: () -> Long = System::currentTimeMillis,
) : BaseFeedViewModel(logger, scope) {
    private val uptimeState = MutableStateFlow<UiState<UptimeWindow>>(UiState.loading())

    /** The cache-then-network uptime feed projected onto the shared [UiState] (loading/content/empty/error/offline). */
    val uptime: StateFlow<UiState<UptimeWindow>> = uptimeState.asStateFlow()

    private val windowState = MutableStateFlow(StatusWindow.DEFAULT)

    /** The selected uptime window (web `win`); changing it triggers a fresh per-window load. */
    val window: StateFlow<StatusWindow> = windowState.asStateFlow()

    /** The persisted personal SLO target (web localStorage), surfaced for the headline tone + label. */
    val target: StateFlow<Double> = targetStore.target

    private var lastValue: UptimeWindow? = null
    private var lastFetchedAt: Long? = null
    private var loadJob: Job? = null
    private var viewOpenedRecorded = false

    init {
        reload(resetCache = true)
    }

    /**
     * Selects [next] and reloads for it. A different window is a fresh load (the web `useQuery` keys by
     * window with no `keepPreviousData`, so the previous window's value is not shown as the new window's),
     * hence the cache reset; re-selecting the current window is a no-op.
     */
    fun setWindow(next: StatusWindow) {
        if (windowState.value == next) return
        windowState.value = next
        reload(resetCache = true)
    }

    /**
     * Re-fetches the current window keeping the last value as cache — the manual analogue of the web 60 s
     * `refetchInterval`. Backs both the screen's live-poll loop and the error-surface retry, so a failed
     * refresh keeps the previous value visible (offline) rather than blanking it.
     */
    fun refresh() {
        reload(resetCache = false)
    }

    /** Persists [value] as the personal target (web `setTargetState`); the store clamps to the valid range. */
    fun setTarget(value: Double) {
        targetStore.setTarget(value)
        logger.info("slo.target.set")
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no uptime value/counts/target, so a diagnostics line can never leak fleet posture.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        SLOTrackingCardDiagnostics.recordViewOpened(logger)
    }

    private fun reload(resetCache: Boolean) {
        loadJob?.cancel()
        if (resetCache) {
            lastValue = null
            lastFetchedAt = null
        }
        uptimeState.value = project(Resource.Loading(cached = lastValue, fetchedAt = lastFetchedAt, stale = false))
        val requested = windowState.value
        loadJob =
            launchJob {
                source.uptime(requested).fold(
                    onSuccess = { value ->
                        val stamp = now()
                        lastValue = value
                        lastFetchedAt = stamp
                        uptimeState.value = project(Resource.Success(data = value, fetchedAt = stamp, stale = false))
                    },
                    onFailure = { error ->
                        uptimeState.value =
                            project(
                                Resource.Error(
                                    cached = lastValue,
                                    fetchedAt = lastFetchedAt,
                                    stale = lastValue != null,
                                    error = error,
                                ),
                            )
                    },
                )
            }
    }

    private fun launchJob(block: suspend () -> Unit): Job = stateScope.launch { block() }

    private fun project(resource: Resource<UptimeWindow>): UiState<UptimeWindow> =
        resource.toUiState { SLOTrackingCardProjection.isEmpty(it) }

    companion object {
        /** A [ViewModelProvider.Factory] a status host uses to construct this surface's ViewModel. */
        fun factory(
            source: SLOTrackingCardSource,
            targetStore: SloTargetStore,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SLOTrackingCardViewModel(source, targetStore, logger) }
            }
    }
}
