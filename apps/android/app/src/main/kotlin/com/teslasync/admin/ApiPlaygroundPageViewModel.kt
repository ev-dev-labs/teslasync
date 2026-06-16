// The state holder backing the ApiPlaygroundPage admin surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook (web/src/features/admin/pages/ApiPlaygroundPage.tsx). It owns three things the
// web page holds in `useState` + `useQuery`: the parsed OpenAPI catalog as a lifecycle-aware [UiState] (web
// `useQuery(['openapi-spec'])`), the currently-selected endpoint (web `selected`), and the last dispatched request
// (web `lastRequestRef`, used to render the code snippet). All derivation lives in the framework-free model
// (ApiPlaygroundPageModel.kt) + the shared feature-view projections; this holder performs no HTTP.
//
// The catalog feed is shared (`shareIn`, replay 1) so the single `/system/openapi` fetch fans out to BOTH the page's
// own [catalog] state (for its loading / error branches) AND the embedded EndpointSidebar feature view (via
// [endpointsFeed]) without a second network round-trip.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.apiplayground

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.endpointsidebar.ParsedEndpoint
import io.teslasync.android.featureviews.requestbuilder.RequestDraft
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.shareIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [ApiHttpClient][io.teslasync.shared.core.net.ApiHttpClient] binding ↔
 *   test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + a PII-safe `send`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ApiPlaygroundPageViewModel(
    private val source: ApiPlaygroundSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    // The single `/system/openapi` fetch, shared so the page state + the embedded sidebar both observe one round-trip.
    private val feed: Flow<Resource<List<ParsedEndpoint>>> =
        refreshTrigger
            .flatMapLatest { source.endpoints() }
            .shareIn(stateScope, SharingStarted.WhileSubscribed(SHARE_STOP_TIMEOUT_MILLIS), replay = 1)

    /**
     * The OpenAPI catalog as cache-then-network UI state (loading / content / empty / error). The empty predicate is
     * the web `endpoints.length === 0` guard — a spec that parses to zero operations resolves to the data-empty
     * surface rather than content.
     */
    val catalog: StateFlow<UiState<List<ParsedEndpoint>>> = feed.asUiState { it.isEmpty() }

    private val mutableSelected = MutableStateFlow<ParsedEndpoint?>(null)

    /** The currently-selected endpoint (web `selected`); `null` is the "select an endpoint" prompt. */
    val selected: StateFlow<ParsedEndpoint?> = mutableSelected.asStateFlow()

    private val mutableLastRequest = MutableStateFlow<RequestDraft?>(null)

    /** The last request the user dispatched (web `lastRequestRef`); backs the code-snippet panel. */
    val lastRequest: StateFlow<RequestDraft?> = mutableLastRequest.asStateFlow()

    /** The shared catalog feed the embedded EndpointSidebar's source streams from (web `endpoints` prop). */
    fun endpointsFeed(): Flow<Resource<List<ParsedEndpoint>>> = feed

    /** Selects an endpoint (web `handleSelect`): records it and clears any prior response/snippet (web `setResponse(null)`). */
    fun select(endpoint: ParsedEndpoint) {
        if (mutableSelected.value?.identity == endpoint.identity) return
        mutableSelected.value = endpoint
        mutableLastRequest.value = null
    }

    /**
     * Records a dispatched request (web `handleSend`): stores the draft so the snippet panel renders the runnable
     * cURL/JS/Python/Go for it. The diagnostic carries only the HTTP verb — never the substituted path or body, which
     * can contain user-entered identifiers (PII).
     */
    fun onSend(draft: RequestDraft) {
        logger.info(EVENT_SEND, mapOf(FIELD_METHOD to draft.method))
        mutableLastRequest.value = draft
    }

    /** Re-fetches the OpenAPI spec (web query `refetch`): clears the selection + snippet and re-collects the feed. */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to ApiPlaygroundPageRegistration.SLUG))
        mutableSelected.value = null
        mutableLastRequest.value = null
        refreshTrigger.update { it + 1 }
        launch { source.refresh() }
    }

    /** Retry affordance for the hard-error surface — identical to [refresh]. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordApiPlaygroundPageOpened(logger)
    }

    companion object {
        // Keep the shared catalog feed's upstream alive briefly across config changes / fast re-subscribes.
        private const val SHARE_STOP_TIMEOUT_MILLIS = 5_000L
        private const val EVENT_SEND = "apiPlayground.send"
        private const val EVENT_REFRESH = "apiPlayground.refresh"
        private const val FIELD_METHOD = "method"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] the host uses to construct this surface's ViewModel. */
        fun factory(
            source: ApiPlaygroundSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ApiPlaygroundPageViewModel(source, logger) }
            }
    }
}
