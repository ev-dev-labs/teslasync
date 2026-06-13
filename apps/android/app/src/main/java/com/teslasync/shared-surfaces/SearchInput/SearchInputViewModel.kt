// UI-thread-free state holder backing the SearchInput surface — the native port of the web component's
// `historyScope` binding (web/src/components/forms/SearchInput.tsx reads `getRecentSearches` and writes via
// `recordSearch` / `removeSearch` / `clearScope`). It binds the shared recent-search feed through
// [SearchInputSource] and performs no IO itself (ADR-002): the view collects [state] and folds it through the
// pure [SearchInputProjection]. The recent-search list is re-shared as a lifecycle-aware [UiState] so the
// composable can switch the dropdown across loading / content / empty / error / stale / offline without
// re-deriving the cache-then-network contract.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SearchInput) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.searchinput

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
 * State holder for the SearchInput surface.
 *
 * The recent-search feed is re-shared as a lifecycle-aware [UiState] so the composable can switch the history
 * dropdown — loading (first read), content/empty (the recent list vs the friendly empty state), a hard error
 * with retry, and the stale/offline freshness envelope — without re-deriving the cache-then-network contract.
 * [record]/[remove]/[clearAll] drive the bound seam's mutations (web `recordSearch` / `removeSearch` /
 * `clearScope`); [retry]/[refresh] re-collect the feed; and [onViewOpened] emits the one PII-safe `view.opened`
 * diagnostic (P1/S11) — slug only, never the user's query text or scope.
 *
 * @param source the recent-search seam (a shared-store adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SearchInputViewModel(
    private val source: SearchInputSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The recent-search list as lifecycle-aware [UiState]. An empty list is treated as structurally empty so
     * the dropdown's empty state is honest rather than a blank frame.
     */
    val state: StateFlow<UiState<List<String>>> =
        refreshTrigger
            .flatMapLatest { source.recentSearches() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Re-collects the recent-search feed after a hard error; backs the retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /** Re-collects the recent-search feed; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /** Records [query] into the bound scope (web `recordSearch`); below-minimum noise is ignored by the seam. */
    fun record(query: String) = launch { source.record(query) }

    /** Removes [query] from the bound scope (web `removeSearch`). */
    fun remove(query: String) = launch { source.remove(query) }

    /** Wipes every recent search in the bound scope (web `clearScope`). */
    fun clearAll() = launch { source.clearAll() }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no query text or scope. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSearchInputOpened(logger)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to SearchInputRegistration.SLUG)

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_REFRESH = "searchInput.refresh"

        /** Wires the surface from the shared **P1/S8** [InMemorySearchHistoryStore] for [scope]. */
        fun create(
            store: InMemorySearchHistoryStore,
            scope: String,
            logger: Logger,
            maxHistory: Int = SearchInputRegistration.DEFAULT_MAX_HISTORY,
        ): SearchInputViewModel = SearchInputViewModel(store.source(scope, maxHistory), logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: SearchInputSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SearchInputViewModel(source, logger) }
            }
    }
}
