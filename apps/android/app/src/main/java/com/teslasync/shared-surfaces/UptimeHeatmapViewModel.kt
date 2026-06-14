// UI-thread-free state holder backing the UptimeHeatmap surface — the native port of the web component's
// single derivation over its `days` prop (web/src/components/status/UptimeHeatmap.tsx). It binds the rolling
// window through [UptimeHeatmapSource] and performs no HTTP or persistence itself (ADR-002): the view
// collects [state] and folds it through the pure [UptimeHeatmapProjection]. The window is the surface's only
// async dependency, so its cache-then-network lifecycle drives the shell's loading / content / empty / error
// / stale / offline states.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/UptimeHeatmap) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.uptimeheatmap

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder for the UptimeHeatmap surface.
 *
 * The window feed is re-shared as a lifecycle-aware [UiState] so the composable can switch the surface —
 * loading (skeleton grid), content (the squares + uptime caption), the empty branch (a friendly empty state
 * instead of the web's blank grid), a hard error with retry, and the stale/offline freshness envelope —
 * without re-deriving the cache-then-network contract. [refresh]/[retry] re-request the window from the
 * source, and [onViewOpened] emits the one PII-safe `view.opened` diagnostic (P1/S11) — the surface slug
 * only, never a date, status, or summary.
 *
 * @param source the window seam (a shared-store adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UptimeHeatmapViewModel(
    private val source: UptimeHeatmapSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The host-fed rolling window as lifecycle-aware [UiState] — the surface's primary feed. An empty window
     * is treated as the structurally-empty phase (a friendly empty state) via the
     * [UptimeHeatmapProjection.isEmpty] predicate, so the empty state is honest rather than a blank panel.
     */
    val state: StateFlow<UiState<UptimeWindow>> =
        refreshTrigger
            .flatMapLatest { source.window() }
            .asUiState(isEmpty = { UptimeHeatmapProjection.isEmpty(it) })

    /** Re-requests the window after a hard error or to refresh stale data; backs retry + auto-refresh. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        source.refresh()
        refreshTrigger.update { it + 1 }
    }

    /** Re-requests the window; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no date, status, or summary. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, surfaceField)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to UptimeHeatmapRegistration.SLUG)

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "uptimeHeatmap.refresh"

        /** Wires the surface from the shared [UptimeHeatmapStore] (the host's window pipeline). */
        fun create(
            store: UptimeHeatmapStore,
            logger: Logger,
        ): UptimeHeatmapViewModel = UptimeHeatmapViewModel(StoreUptimeHeatmapSource(store), logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: UptimeHeatmapSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { UptimeHeatmapViewModel(source, logger) }
            }
    }
}
