// UI-thread-free state holder backing the Compose [RequestBuilder] — the native port of the web component's
// data binding (web/src/features/admin/components/RequestBuilder.tsx + its parent's
// `useQuery(['openapi-spec'])` and selection state). It binds the injected [RequestBuilderSource] (the
// P1/S8 shared-layer seam) to a lifecycle-aware [UiState] of the selected-endpoint snapshot via
// [BaseFeedViewModel.asUiState], covering every state the surface can render: loading (spec fetch in flight,
// no cache), content (the request form), data-empty (no endpoint selected yet — the parent's "select an
// endpoint" prompt), hard error + retry, and — through the ADR-013 freshness contract — stale / offline
// (the cached selection stays visible with the staleness + error flags). It owns no networking (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RequestBuilder) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.requestbuilder

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
 * State holder backing the Compose [RequestBuilder].
 *
 * It consumes the injected [RequestBuilderSource] (P1/S8) and re-shares it as a single [UiState] stream
 * (loading / content / empty / stale / offline / error), exposing the refresh + retry actions plus the
 * PII-safe `view.opened` diagnostic. A snapshot with no selected endpoint maps to the data-empty surface
 * (the parent's "select an endpoint" prompt). It owns no networking.
 *
 * @param source the shared selected-endpoint seam (the live `/system/openapi` + selection feed in
 *   production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RequestBuilderViewModel(
    private val source: RequestBuilderSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val restart = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The selected endpoint as cache-then-network UI state (no selection → empty). */
    val state: StateFlow<UiState<RequestBuilderSnapshot>> =
        restart
            .flatMapLatest { requestBuilderResource(source) }
            .asUiState { it.isEmpty }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, surface slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to RequestBuilderRegistration.SLUG))
    }

    /** Re-collects the selection feed and asks the source to re-fetch the spec (web TanStack refetch). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to RequestBuilderRegistration.SLUG))
        restart.update { it + 1 }
        launch { source.refresh() }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "requestBuilder.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: RequestBuilderSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { RequestBuilderViewModel(source, logger) }
            }
    }
}
