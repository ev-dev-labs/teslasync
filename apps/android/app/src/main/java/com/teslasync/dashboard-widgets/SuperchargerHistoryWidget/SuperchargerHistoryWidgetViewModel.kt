// UI-thread-free state holder backing the Supercharger History widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx). It binds
// the shared data feeds (P1/S8) through [SuperchargerHistorySource]: it projects the
// `useTeslaChargingHistory()` cache-then-network envelope onto the shared [UiState] surface (loading /
// content / empty / stale / offline / error), where empty mirrors the web `entries.length > 0` gate. The
// display preferences (energy unit + currency symbol + precision) are derived separately from the live
// `/settings` feed (web `useUnits`/`useFormatting`). It exposes the single refresh action plus the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] / [displayPrefs] and
// calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SuperchargerHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.superchargerhistory

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * Lifecycle-aware state holder backing the Compose [SuperchargerHistoryWidget]. It consumes the
 * cache-then-network [SuperchargerHistorySource] (P1/S8) and re-shares the history feed as a single
 * [UiState] stream (loading / content / empty / stale / offline / error), while deriving the live display
 * preferences from the settings feed. It exposes the single refresh action plus the PII-safe `view.opened`
 * diagnostic.
 *
 * It owns no networking. [refresh] re-collects the source (the web `refetch`) and [recordViewOpened] emits
 * the one-shot `view.opened` diagnostics event with the surface [SuperchargerHistoryRegistration.SLUG]
 * (P1/S11).
 *
 * @param source the cache-then-network seam (a shared-data-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only projects these feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SuperchargerHistoryWidgetViewModel(
    private val source: SuperchargerHistorySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The Supercharger history as cache-then-network UI state (loading / content / empty / stale / offline
     * / error), carrying the freshness stamp + error kind. Empty mirrors the web `entries.length > 0` gate
     * — a payload with no entries resolves to empty regardless of the summary.
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.chargingHistory() }
            .asUiState(isEmpty = { !parseSuperchargerHistory(it).hasEntries })

    /** The live display preferences (energy unit + currency symbol + precision), re-derived as settings change. */
    val displayPrefs: StateFlow<SuperchargerHistoryDisplayPrefs> =
        source
            .settings()
            .map { resource -> SuperchargerHistoryDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = SuperchargerHistoryDisplayPrefs.METRIC_DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no site / energy / cost payload, so a diagnostics line can never leak where a vehicle
     * has charged or what it spent. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SuperchargerHistoryRegistration.SLUG))
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SURFACE = "surface"
        private const val EVENT_REFRESH = "superchargerHistory.refresh"
    }
}
