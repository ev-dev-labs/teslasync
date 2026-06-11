// UI-thread-free state holder backing the Climate Status widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/ClimateStatusWidget.tsx). It binds the shared
// vehicles + latest-climate feeds (P1/S8) through [ClimateStatusSource], projects each cache-then-network
// emission onto the shared [UiState] surface (loading / content / empty / stale / offline / error), and
// exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The view never performs
// HTTP — it only collects [state] and calls [refresh]/[retry]/[onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ClimateStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.climatestatus

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
import kotlinx.serialization.json.JsonElement

/**
 * @param source the cache-then-network vehicles + latest-climate seam (a shared-data-layer adapter in
 *   production, a fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null` defaults to the first
 *   enrolled vehicle.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ClimateStatusWidgetViewModel(
    private val source: ClimateStatusSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's latest climate snapshot as a lifecycle-aware [UiState]: loading / content /
     * empty (no climate object) / stale / offline / error, carrying the freshness stamp + error kind.
     * Empty mirrors the web `climateData ? … : <EmptyState/>` gate — a `JsonNull`/non-object snapshot is
     * the empty surface.
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { climateStatusResource(source.vehicles(), vehicleId, source::climate) }
            .asUiState { ClimateStatusProjection.isEmptySnapshot(it) }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no temperature/HVAC payload, so a diagnostics line can never leak cabin state. Call
     * from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to ClimateStatusRegistration.SLUG))
    }

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the header refresh control). */
    fun refresh() {
        logger.info("climateStatus.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: ClimateStatusSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ClimateStatusWidgetViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
