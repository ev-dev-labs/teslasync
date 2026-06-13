// UI-thread-free state holder backing the ComboboxMulti surface — the native port of the internal state the web
// component owns (web/src/components/forms/ComboboxMulti.tsx: `open`, `activeIndex`, `inputText`, the async
// `asyncOptions`/`asyncLoading`, and the debounced abort-on-keystroke effect). It binds the caller's options
// through [ComboboxMultiOptionsSource] and performs no HTTP itself (ADR-002): the view collects [interaction] +
// [options] and folds them with the controlled selection through the pure [ComboboxMultiProjection]. The async
// options loader is the genuine async dependency, so its cache-then-network lifecycle drives the surface's
// loading / content / empty / error / stale / offline states.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ComboboxMulti) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.comboboxmulti

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update

/**
 * The ephemeral interaction state the surface owns — the native port of the web `open` / `inputText` /
 * `activeIndex` `useState`s. Hoisted into the ViewModel (rather than `remember`ed in the view) because
 * [query] is the async-fetch key, so the view stays a thin render layer driven by a single state holder.
 *
 * @property open whether the dropdown is expanded (web `open`).
 * @property query the filter / add-next text (web `inputText`).
 * @property activeIndex the highlighted option index, or -1 for none (web `activeIndex`).
 */
data class ComboboxMultiInteraction(
    val open: Boolean = false,
    val query: String = "",
    val activeIndex: Int = -1,
)

/**
 * State holder for the ComboboxMulti surface.
 *
 * [interaction] re-shares the open / query / active-index UI state; [options] re-shares the caller's options
 * feed as a lifecycle-aware [UiState], keyed on the debounced filter query so a keystroke cancels the prior
 * in-flight load (`flatMapLatest`, the web `AbortController`). When the dropdown is closed AND the query is
 * empty no load is issued (web `if (!open && !inputText) return`), an empty result is surfaced instead.
 * [retry]/[refresh] re-collect the feed; [onViewOpened] emits the one PII-safe `view.opened` diagnostic
 * (P1/S11) — slug only, never a value.
 *
 * @param source the options seam (a static/async adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param debounceMs the async keystroke debounce window (web `asyncDebounceMs`); 0 for the static case.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
class ComboboxMultiViewModel(
    private val source: ComboboxMultiOptionsSource,
    logger: Logger,
    private val debounceMs: Long = ComboboxMultiRegistration.DEFAULT_ASYNC_DEBOUNCE_MS,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val interactionState = MutableStateFlow(ComboboxMultiInteraction())
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The dropdown open / filter query / active-index UI state (web `open`/`inputText`/`activeIndex`). */
    val interaction: StateFlow<ComboboxMultiInteraction> = interactionState.asStateFlow()

    /** The options feed as lifecycle-aware [UiState] — empty collection ⇒ the dropdown's empty branch. */
    val options: StateFlow<UiState<List<ComboboxMultiOption>>> =
        combine(interactionState, refreshTrigger) { state, attempt ->
            FetchKey(state.open, state.query, attempt)
        }.distinctUntilChanged()
            .debounce { key -> if (key.query.isEmpty()) IMMEDIATE else debounceMs }
            .flatMapLatest { key -> loadFor(key) }
            .asUiState { it.isEmpty() }

    private fun loadFor(key: FetchKey): Flow<Resource<List<ComboboxMultiOption>>> =
        if (!key.open && key.query.isEmpty()) {
            flowOf(Resource.Success(emptyList(), fetchedAt = IDLE_STAMP, stale = false))
        } else {
            source.load(key.query)
        }

    /** Updates the filter text and opens the dropdown (web `handleInputChange`). */
    fun setQuery(text: String) = interactionState.update { it.copy(query = text, open = true) }

    /** Opens the dropdown (web `handleInputFocus`). */
    fun openDropdown() = interactionState.update { it.copy(open = true) }

    /** Closes the dropdown and clears the highlight (web `closeDropdown`). */
    fun closeDropdown() = interactionState.update { it.copy(open = false, activeIndex = -1) }

    /** Toggles the dropdown (web chevron button). */
    fun toggleDropdown() =
        interactionState.update {
            if (it.open) it.copy(open = false, activeIndex = -1) else it.copy(open = true)
        }

    /** Highlights the option at [index] (web `onMouseEnter`). */
    fun setActiveIndex(index: Int) = interactionState.update { it.copy(activeIndex = index) }

    /** Moves the highlight down with wrap-around, opening the dropdown if needed (web ArrowDown). */
    fun moveActiveDown(size: Int) =
        interactionState.update {
            it.copy(open = true, activeIndex = ComboboxMultiProjection.nextActiveIndex(it.activeIndex, size))
        }

    /** Moves the highlight up with wrap-around, opening the dropdown if needed (web ArrowUp). */
    fun moveActiveUp(size: Int) =
        interactionState.update {
            it.copy(open = true, activeIndex = ComboboxMultiProjection.previousActiveIndex(it.activeIndex, size))
        }

    /** Jumps the highlight to the first option (web Home). */
    fun moveActiveToStart() = interactionState.update { it.copy(activeIndex = 0) }

    /** Jumps the highlight to the last option (web End). */
    fun moveActiveToEnd(size: Int) = interactionState.update { it.copy(activeIndex = (size - 1).coerceAtLeast(-1)) }

    /** Clears the filter text and highlight after a chip is added, keeping the dropdown open (web `addOption`). */
    fun onOptionCommitted() = interactionState.update { it.copy(query = "", activeIndex = -1) }

    /** Re-clamps the highlight when the visible options change (web reset effect). */
    fun syncActiveIndex(size: Int) =
        interactionState.update {
            it.copy(activeIndex = ComboboxMultiProjection.reconcileActiveIndex(it.activeIndex, it.open, size))
        }

    /** Re-fetches the options after a hard error; backs the retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the options; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no option value, label, or query. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, surfaceField)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to ComboboxMultiRegistration.SLUG)

    /** The debounce + retry fetch key; [attempt] busts the distinct-until-changed gate on a manual retry. */
    private data class FetchKey(
        val open: Boolean,
        val query: String,
        val attempt: Int,
    )

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "comboboxMulti.refresh"
        private const val IMMEDIATE = 0L
        private const val IDLE_STAMP = 0L

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: ComboboxMultiOptionsSource,
            logger: Logger,
            debounceMs: Long = ComboboxMultiRegistration.DEFAULT_ASYNC_DEBOUNCE_MS,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ComboboxMultiViewModel(source, logger, debounceMs) }
            }
    }
}
