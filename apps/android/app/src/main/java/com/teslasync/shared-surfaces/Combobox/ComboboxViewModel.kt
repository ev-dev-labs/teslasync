// UI-thread-free state holder backing the Combobox surface — the native port of the web component's internal
// state (web/src/components/forms/Combobox.tsx): the typed text, the open/closed listbox, the active
// descendant, the current selection, and the debounced abort-on-keystroke option fetch. It binds the option
// feed through [ComboboxSource] and performs no HTTP itself (ADR-002): the view collects [uiModel] (already
// folded through the pure [ComboboxProjection]) and calls the intent methods below. The option feed is the
// genuine async dependency the surface resolves, so its cache-then-network lifecycle drives the surface's
// loading / results / empty / error / stale / offline states.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Combobox) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.combobox

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.components.forms.ComboOption
import io.teslasync.android.components.forms.nextActiveIndex
import io.teslasync.android.components.forms.prevActiveIndex
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * State holder for the Combobox surface.
 *
 * The option feed is re-shared as a lifecycle-aware [UiState] and combined with the interaction state into a
 * single [uiModel] the composable renders without re-deriving the cache-then-network contract. Typing
 * ([onQueryChange]) debounces into the feed via `flatMapLatest`, so a newer keystroke cancels the previous
 * in-flight request (the web AbortController contract); [select]/[clear] update the selection; [retry] and
 * [refresh] re-fetch the feed; and [onViewOpened] emits the one PII-safe `view.opened` diagnostic (P1/S11) —
 * slug only, never the typed query or any picked option.
 *
 * @param source the option-feed seam (a static/store-backed adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param maxVisibleOptions the dropdown row cap (web `maxVisibleOptions`, default 50).
 * @param debounceMillis the async fetch debounce (web `asyncDebounceMs`, default 200).
 */
@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
class ComboboxViewModel(
    private val source: ComboboxSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val maxVisibleOptions: Int = ComboboxRegistration.DEFAULT_MAX_VISIBLE_OPTIONS,
    private val debounceMillis: Long = DEFAULT_DEBOUNCE_MILLIS,
) : BaseFeedViewModel(logger, scope) {
    private val queryFlow = MutableStateFlow("")
    private val expandedFlow = MutableStateFlow(false)
    private val activeIndexFlow = MutableStateFlow(ComboboxRegistration.NO_ACTIVE_INDEX)
    private val selectedFlow = MutableStateFlow<ComboOption?>(null)
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The user's current selection (web `value`); a host observes it to react to picks. */
    val selected: StateFlow<ComboOption?> = selectedFlow.asStateFlow()

    private val optionsState: StateFlow<UiState<List<ComboOption>>> =
        combine(queryFlow, refreshTrigger) { query, _ -> query }
            .debounce(debounceMillis)
            .flatMapLatest { query -> source.options(query) }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The single render-ready model the composable collects — the dropdown + interaction state combined. */
    val uiModel: StateFlow<ComboboxUiModel> =
        combine(optionsState, queryFlow, expandedFlow, activeIndexFlow, selectedFlow) { options, query, expanded, activeIndex, selection ->
            ComboboxProjection.project(
                state = options,
                interaction =
                    ComboboxInteraction(
                        selected = selection,
                        query = query,
                        expanded = expanded,
                        activeIndex = activeIndex,
                    ),
                maxVisibleOptions = maxVisibleOptions,
            )
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = initialModel(),
        )

    private fun initialModel(): ComboboxUiModel =
        ComboboxProjection.project(
            state = UiState.loading(),
            interaction =
                ComboboxInteraction(
                    selected = selectedFlow.value,
                    query = queryFlow.value,
                    expanded = expandedFlow.value,
                    activeIndex = activeIndexFlow.value,
                ),
            maxVisibleOptions = maxVisibleOptions,
        )

    /** Raises typed text into the feed and opens the listbox (web `handleInputChange`). */
    fun onQueryChange(text: String) {
        queryFlow.value = text
        expandedFlow.value = true
        activeIndexFlow.value = ComboboxRegistration.NO_ACTIVE_INDEX
    }

    /** Opens/closes the listbox (web focus/chevron/Esc), clearing the active descendant on close. */
    fun setExpanded(expanded: Boolean) {
        expandedFlow.value = expanded
        if (!expanded) activeIndexFlow.value = ComboboxRegistration.NO_ACTIVE_INDEX
    }

    /** Sets the active descendant to a specific row (web pointer hover over an option). */
    fun setActiveIndex(index: Int) {
        activeIndexFlow.value = index
    }

    /** Moves the active descendant down one row, clamped to the last option (web ArrowDown). */
    fun moveActiveDown() {
        expandedFlow.value = true
        val model = uiModel.value
        activeIndexFlow.value = nextActiveIndex(model.activeIndex, model.rows.size)
    }

    /** Moves the active descendant up one row, clamped to the first option (web ArrowUp). */
    fun moveActiveUp() {
        expandedFlow.value = true
        val model = uiModel.value
        activeIndexFlow.value = prevActiveIndex(model.activeIndex, model.rows.size)
    }

    /** Commits the highlighted option if one is active (web Enter/Tab on an active descendant). */
    fun commitActive() {
        val model = uiModel.value
        model.rows.getOrNull(model.activeIndex)?.let { select(it.option) }
    }

    /** Picks [option], setting the selection, clearing the query, and closing the listbox (web `commitOption`). */
    fun select(option: ComboOption) {
        selectedFlow.value = option
        queryFlow.value = ""
        expandedFlow.value = false
        activeIndexFlow.value = ComboboxRegistration.NO_ACTIVE_INDEX
    }

    /** Clears the selection + text and re-opens the listbox (web `handleClear`). */
    fun clear() {
        selectedFlow.value = null
        queryFlow.value = ""
        activeIndexFlow.value = ComboboxRegistration.NO_ACTIVE_INDEX
        expandedFlow.value = true
    }

    /** Re-fetches the option feed after an error/stale chip (web `refetch`); backs the retry affordance. */
    fun retry() {
        ComboboxDiagnostics.recordRefresh(logger)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the option feed; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no query text or option label/value. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        ComboboxDiagnostics.recordViewOpened(logger)
    }

    companion object {
        /** Default async fetch debounce in milliseconds (web `asyncDebounceMs = 200`). */
        const val DEFAULT_DEBOUNCE_MILLIS: Long = 200

        /** Wires the surface from a concrete [source] (a static array or a store-backed async loader). */
        fun create(
            source: ComboboxSource,
            logger: Logger,
            maxVisibleOptions: Int = ComboboxRegistration.DEFAULT_MAX_VISIBLE_OPTIONS,
        ): ComboboxViewModel = ComboboxViewModel(source, logger, maxVisibleOptions = maxVisibleOptions)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: ComboboxSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ComboboxViewModel(source, logger) }
            }
    }
}
