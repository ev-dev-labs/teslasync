// UI-thread-free state holder backing the Compose [HttpStatusTool] — the native port of the web tool's
// state (web/src/features/admin/components/devtools/tools/HttpStatusTool.tsx). It binds the injected
// [HttpStatusToolSource] (the P1/S8 shared-layer seam) to a lifecycle-aware [UiState] of the catalog
// snapshot via [BaseFeedViewModel.asUiState], covering every state the surface can render: loading (no
// cache), content, data-empty (no catalog rows), hard error + retry, and — through the ADR-013 freshness
// contract — stale / offline (the cached catalog stays visible with the staleness + error flags). The
// static catalog resolves immediately to content; the other phases are reachable via a fake source (tests
// / previews), so no state is hidden. The view performs no HTTP (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HttpStatusTool) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.httpstatus

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
 * State holder backing the Compose [HttpStatusTool].
 *
 * It consumes the injected [HttpStatusToolSource] (P1/S8) and re-shares it as a single [UiState] stream
 * (loading / content / empty / stale / offline / error), exposing the refresh + retry actions plus the
 * PII-safe `view.opened` diagnostic. A snapshot whose catalog carried no rows maps to the data-empty
 * surface; the composable further narrows to the search empty state when the filter leaves no rows (web
 * `filtered.length === 0`). It owns no networking.
 *
 * @param source the shared HTTP-status-catalog seam (the static catalog in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HttpStatusToolViewModel(
    private val source: HttpStatusToolSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val restart = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The catalog as cache-then-network UI state (no catalog rows → empty). */
    val state: StateFlow<UiState<HttpStatusSnapshot>> =
        restart
            .flatMapLatest { httpStatusResource(source) }
            .asUiState { it.isEmpty }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, surface slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to HttpStatusToolRegistration.SLUG))
    }

    /** Re-collects the catalog feed (web has no refetch; the static binding re-emits the same catalog). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to HttpStatusToolRegistration.SLUG))
        restart.update { it + 1 }
        launch { source.refresh() }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "httpStatus.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: HttpStatusToolSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { HttpStatusToolViewModel(source, logger) }
            }
    }
}
