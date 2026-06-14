// UI-thread-free state holder backing the StickyChipBar surface — the native port of the web component's only
// local state (web/src/components/status/StickyChipBar.tsx: `useState(chips[0]?.id ?? '')` plus the
// `IntersectionObserver` effect and the click handler that both call `setActiveId`). It owns the tracked
// [activeId], seeds + re-derives it as the chip set changes ([syncChips]), updates it on a chip tap
// ([selectChip], the web `handleClick` `setActiveId`) and on a scroll-driven visibility change
// ([onSectionsVisible], the web `IntersectionObserver` callback), and emits the PII-safe one-shot
// `view.opened` diagnostic (P1/S11). The view performs NO business logic — it only collects [activeId] and
// calls these reducers; the scroll side effect itself is delegated to the host (the web reaches into
// `#main-content`, the Android host owns the scrollable), keeping the surface a pure presentation layer.
//
// There is no loading / empty / error / stale / offline feed lifecycle to model here: the surface fetches
// nothing (it renders the controlled collection the parent passes). The surface's real empty / populated
// branches are derived per-render by [StickyChipBarProjection.project]. The view stays a thin renderer (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/StickyChipBar) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickychipbar

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * State holder backing the Compose [io.teslasync.android.sharedsurfaces.stickychipbar.StickyChipBar] — the
 * Android port of the web `StickyChipBar`'s local `activeId` state.
 *
 * It owns the tracked [activeId] (the web `useState(chips[0]?.id ?? '')`), the P1/S8 boundary for this
 * surface, so the view never holds the selection itself. The bar fetches nothing; its empty / populated
 * branches are a pure projection of the parent-supplied collection, so there is no feed lifecycle to model.
 *
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param logger the single sanctioned redacting logger (ADR-016); receives only the PII-safe `view.opened`
 *   event carrying the non-PII surface slug (never a chip id or label).
 * @param scope test seam forwarded to the base holder; production passes nothing and uses `viewModelScope`.
 */
class StickyChipBarViewModel(
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val activeIdState = MutableStateFlow("")
    private var viewOpenedRecorded = false

    /** The currently-active chip id — the web `activeId` state; the empty string until the first chip seeds it. */
    val activeId: StateFlow<String> = activeIdState.asStateFlow()

    /**
     * Seeds and keeps the active id valid as the chip set changes — the web `useState(chips[0]?.id ?? '')`
     * seed, extended to drop a stale highlight when the named chip leaves the list (see [resolveActiveId]).
     * Idempotent, so the host may call it on every render without thrashing the selection.
     */
    fun syncChips(chips: List<ChipItem>) {
        activeIdState.value = resolveActiveId(chips, activeIdState.value)
    }

    /** Marks [id] active on a chip tap — the web `handleClick` `setActiveId(id)`. The scroll is the host's. */
    fun selectChip(id: String) {
        activeIdState.value = id
    }

    /**
     * Highlights the top-most visible anchored section as the host scrolls — the web `IntersectionObserver`
     * callback. [visibleIds] is the set of currently-visible chip anchors the host reports; [order] is the
     * chip id sequence (document order). Leaves the active id unchanged when nothing is visible (web
     * `if (visible.length > 0)`), so a fully-scrolled-past region never clears the highlight.
     */
    fun onSectionsVisible(
        visibleIds: List<String>,
        order: List<String>,
    ) {
        val top = topMostVisibleId(visibleIds, order) ?: return
        activeIdState.value = top
    }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordStickyChipBarOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(logger: Logger): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { StickyChipBarViewModel(logger) }
            }
    }
}
