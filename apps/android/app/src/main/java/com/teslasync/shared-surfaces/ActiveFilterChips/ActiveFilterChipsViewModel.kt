// The UI-thread-free state holder backing the ActiveFilterChips shared surface — the native port of the web
// component's local `overflowOpen` state, the two `useEffect`s that close it, and the a11y announcer wiring
// (web/src/components/forms/ActiveFilterChips.tsx). It owns the overflow-popover open flag, collapses it when the
// active filters drop to zero (web effect lines 103-105), routes localized announcements through the bound
// [FilterAnnouncer], and exposes the one PII-safe `view.opened` diagnostic. The view performs NO business logic —
// it only collects [overflowOpen] / [announcement] and calls [setOverflowOpen] / [toggleOverflow] /
// [syncFilterCount] / [announce] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.activefilterchips

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
 * @param announcer the polite live-region announcer (web `removalAnnouncement` state + `announceCounterRef`); a
 *   [LiveFilterAnnouncer] in production, a fake in tests. The view-model owns no Compose state — it delegates the
 *   re-announce mechanic to this port.
 * @param logger the single sanctioned redacting logger (ADR-016); receives only the PII-safe `view.opened`
 *   event carrying the non-PII surface slug (never a filter value or any user content).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ActiveFilterChipsViewModel(
    private val announcer: FilterAnnouncer,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val overflowOpenState = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** Whether the "+N more" overflow popover is open — the web `overflowOpen` state. */
    val overflowOpen: StateFlow<Boolean> = overflowOpenState.asStateFlow()

    /** The polite live-region text the view renders, delegated to the bound [FilterAnnouncer]. */
    val announcement: StateFlow<String> = announcer.announcement

    /** Opens or closes the overflow popover — web `setOverflowOpen(open)`. */
    fun setOverflowOpen(open: Boolean) {
        overflowOpenState.value = open
    }

    /** Toggles the overflow popover — web `setOverflowOpen(v => !v)` on the "+N more" trigger. */
    fun toggleOverflow() {
        overflowOpenState.value = !overflowOpenState.value
    }

    /**
     * Collapses the overflow popover when the active filters drop to zero — the web effect
     * `if (filters.length === 0 && overflowOpen) setOverflowOpen(false)` (lines 103-105). A no-op otherwise, so a
     * host can call it on every filter change without thrashing the open flag.
     */
    fun syncFilterCount(count: Int) {
        if (count == 0 && overflowOpenState.value) overflowOpenState.value = false
    }

    /**
     * Publishes an already-localized [message] to the live region — web `announceRemoval` / the clear-all branch.
     * The render boundary composes the translated string (P1/S10); the [FilterAnnouncer] applies the re-announce
     * padding so assistive tech re-reads a repeated message.
     */
    fun announce(message: String) {
        announcer.announce(message)
    }

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per holder. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordActiveFilterChipsViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            announcer: FilterAnnouncer,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ActiveFilterChipsViewModel(announcer, logger) }
            }
    }
}
