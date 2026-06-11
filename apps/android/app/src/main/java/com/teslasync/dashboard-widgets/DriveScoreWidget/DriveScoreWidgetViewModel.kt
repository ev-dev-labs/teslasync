// UI-thread-free state holder backing the Drive Score widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/DriveScoreWidget.tsx). It binds the shared data
// feeds (P1/S8) through [DriveScoreSource]: it projects the `useFleetAnalytics(7)` cache-then-network
// `/analytics/fleet` envelope onto the shared [UiState] surface (loading / content / empty / stale /
// offline / error), and derives the display preferences (distance unit) separately from the live
// `/settings` feed (web `useUnits`). It exposes the single refresh action plus the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] / [displayPrefs] and calls
// [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DriveScoreWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivescore

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
 * @param source the cache-then-network seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only projects the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DriveScoreWidgetViewModel(
    private val source: DriveScoreSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The fleet-analytics payload as cache-then-network UI state (loading / content / empty / stale /
     * offline / error), carrying the freshness stamp + error kind. Empty mirrors the web `analytics ?`
     * gate — a null/empty payload resolves to empty (the friendly "No data yet" state).
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.fleetAnalytics() }
            .asUiState(isEmpty = { !parseDriveScore(it).hasData })

    /** The live display preferences (distance unit), re-derived as settings change (web `useUnits`). */
    val displayPrefs: StateFlow<DriveScoreDisplayPrefs> =
        source
            .settings()
            .map { resource -> DriveScoreDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = DriveScoreDisplayPrefs.METRIC_DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("driveScore.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no efficiency / score payload, so a diagnostics line can never leak driving
     * behaviour. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to DriveScoreRegistration.SLUG))
    }
}
