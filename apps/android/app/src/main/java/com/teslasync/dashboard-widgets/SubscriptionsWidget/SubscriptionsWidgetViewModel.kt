// UI-thread-free state holder backing the Subscriptions widget — the native port of the web component's hook
// composition (web/src/features/dashboard/widgets/SubscriptionsWidget.tsx). It binds the shared vehicles +
// per-vehicle subscriptions feeds (P1/S8) through [SubscriptionsSource]: it resolves the active vehicle from
// the `useVehicles` catalog (web `vehicleId ?? vehicles?.[0]?.id`), then projects that vehicle's
// `useVehicleSubscriptions` cache-then-network envelope onto the shared [UiState] surface (loading / content
// / empty / stale / offline / error). It exposes the single refresh action plus the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SubscriptionsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.subscriptions

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
 * @param source the cache-then-network vehicles + subscriptions seam (a shared-data-layer adapter in
 *   production, a fake in tests). The view-model owns no networking — it only resolves the active vehicle and
 *   projects the feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null` defaults to the first
 *   enrolled vehicle.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SubscriptionsWidgetViewModel(
    private val source: SubscriptionsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly as
    // the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's subscriptions envelope as a lifecycle-aware [UiState]: loading / content / empty
     * (no `data` object) / stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors
     * the web `parseSubscriptions(subsData)` ⇒ `[]` ⇒ `<EmptyState/>` gate — a `JsonNull`/dataless envelope is
     * the empty surface, and a hard subscriptions error with no cache raises the retry surface (web `isError`).
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { subscriptionsResource(source.vehicles(), vehicleId, source::subscriptions) }
            .asUiState { subscriptionsData(it) == null }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no subscription/expiry payload, so a diagnostics line can never leak the owner's entitlements.
     * Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to SubscriptionsRegistration.SLUG))
    }

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the header refresh control). */
    fun refresh() {
        logger.info("subscriptions.refresh")
        refreshTrigger.update { it + 1 }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: SubscriptionsSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SubscriptionsWidgetViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
