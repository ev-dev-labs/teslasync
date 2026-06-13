// UI-thread-free state holder backing the DateRangeFilter surface — the native port of the web component's
// URL-state binding (web/src/components/forms/DateRangeFilter.tsx reading `startDate`/`endDate` and writing
// through `useUrlBatch`). It binds the [DateRangeFilterSource] seam (P1/S8) for the current selection,
// re-shares it as a lifecycle-aware [UiState] so the composable can switch surfaces — loading (first read),
// content (the filled control), empty (no range chosen yet), a hard error with retry, and the stale/offline
// freshness envelope — without re-deriving the cache-then-network contract, and routes every edit back through
// the seam. The view never performs work of its own (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DateRangeFilter) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed because the file follows the surface's `{Surface}ViewModel.kt` naming while declaring the
// concise [DateRangeFilterViewModel] — the same divergence the sibling surface files document.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.daterangefilter

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
import java.time.LocalDate

/**
 * State holder for the DateRangeFilter surface.
 *
 * The selection feed (the `from`/`to` URL-state read the surface binds through [source]) is re-shared as a
 * lifecycle-aware [UiState] so the composable can switch surfaces — loading (first read), content/empty (a
 * filled vs an unset selection), a hard error with retry, and the stale/offline freshness envelope — without
 * re-deriving the cache-then-network contract. The edit methods ([onStartDateChange] / [onEndDateChange] /
 * [onRangeChange] / [onPresetSelected]) persist back through the seam (web `useUrlBatch`), the feed re-emits,
 * and the surface re-renders. [refresh]/[retry] re-read the selection (web revalidation), and [onViewOpened]
 * emits the one PII-safe `view.opened` diagnostic (P1/S11) — slug only, never a date.
 *
 * @param source the URL-state selection seam (the process store in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DateRangeFilterViewModel(
    private val source: DateRangeFilterSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The current selection as lifecycle-aware [UiState]. An unset selection (both bounds blank) is treated
     * as structurally empty so the surface's empty state is honest (the control still renders, with a prompt),
     * rather than presenting a blank window as content.
     */
    val state: StateFlow<UiState<DateRangeSelection>> =
        refreshTrigger
            .flatMapLatest { source.range() }
            .asUiState(isEmpty = { it.isUnset })

    /** Persists a new start bound (web `onStartDateChange`); the feed re-emits and the surface re-renders. */
    fun onStartDateChange(start: String) {
        source.setStart(start)
    }

    /** Persists a new end bound (web `onEndDateChange`). */
    fun onEndDateChange(end: String) {
        source.setEnd(end)
    }

    /** Persists both bounds atomically (web `onRangeChange`). */
    fun onRangeChange(
        start: String,
        end: String,
    ) {
        source.setRange(start, end)
    }

    /**
     * Resolves [presetId]'s window for [today] and persists it atomically (web `handlePreset` →
     * `onRangeChange`). An unknown id is a no-op, so a stale chip set never corrupts the selection.
     */
    fun onPresetSelected(
        presetId: String,
        today: LocalDate,
    ) {
        val window = getDatePreset(presetId)?.resolve(today) ?: return
        source.setRange(window.start, window.end)
    }

    /** Re-reads the selection after a hard error (web revalidation); backs the retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        source.refresh()
        refreshTrigger.update { it + 1 }
    }

    /** Re-reads the selection; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no selected dates, VIN, or vehicle id. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDateRangeFilterOpened(logger)
    }

    private val surfaceField: Map<String, String> get() = mapOf(FIELD_SURFACE to DateRangeFilterRegistration.SLUG)

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: DateRangeFilterSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DateRangeFilterViewModel(source, logger) }
            }
    }
}
