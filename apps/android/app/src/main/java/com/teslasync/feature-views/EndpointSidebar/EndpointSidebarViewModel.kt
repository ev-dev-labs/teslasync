// UI-thread-free state holder backing the Compose [EndpointSidebar] — the native port of the web
// component's data binding (web/src/features/admin/components/EndpointSidebar.tsx + its parent's
// `useQuery(['openapi-spec'])`). It binds the injected [EndpointSidebarSource] (the P1/S8 shared-layer
// seam) to a lifecycle-aware [UiState] of the operations snapshot via [BaseFeedViewModel.asUiState],
// covering every state the surface can render: loading (spec fetch in flight, no cache), content,
// data-empty (the spec had no operations), hard error + retry, and — through the ADR-013 freshness
// contract — stale / offline (the cached operations stay visible with the staleness + error flags). The
// composable further narrows to the search empty state ("No matching endpoints") when the filter leaves no
// rows (web `filtered.length === 0`). It owns no networking (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EndpointSidebar) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.endpointsidebar

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
 * State holder backing the Compose [EndpointSidebar].
 *
 * It consumes the injected [EndpointSidebarSource] (P1/S8) and re-shares it as a single [UiState] stream
 * (loading / content / empty / stale / offline / error), exposing the refresh + retry actions plus the
 * PII-safe `view.opened` diagnostic. A snapshot whose catalog carried no operations maps to the data-empty
 * surface; the composable further narrows to the "No matching endpoints" empty state when the search filter
 * leaves no rows (web `filtered.length === 0`). It owns no networking.
 *
 * @param source the shared OpenAPI-operations seam (the live `/system/openapi` feed in production, a fake
 *   in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EndpointSidebarViewModel(
    private val source: EndpointSidebarSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val restart = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The parsed operations as cache-then-network UI state (no operations → empty). */
    val state: StateFlow<UiState<EndpointSidebarSnapshot>> =
        restart
            .flatMapLatest { endpointSidebarResource(source) }
            .asUiState { it.isEmpty }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, surface slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to EndpointSidebarRegistration.SLUG))
    }

    /** Re-collects the operations feed and asks the source to re-fetch the spec (web TanStack refetch). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to EndpointSidebarRegistration.SLUG))
        restart.update { it + 1 }
        launch { source.refresh() }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "endpointSidebar.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: EndpointSidebarSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { EndpointSidebarViewModel(source, logger) }
            }
    }
}
