// UI-thread-free state holder backing the SecurityPanel feature view — the native port of the
// latest-security + vehicle-config feeds the web surface renders
// (web/src/features/vehicles/components/telemetry-panels/SecurityPanel.tsx + web/src/api/hooks/useVehicles.ts).
// It binds the shared vehicles + latest-security + latest-config feeds (P1/S8) through [SecurityPanelSource],
// projects each cache-then-network emission onto the shared [UiState] surface (loading / content / empty /
// stale / offline / error), and exposes the single refresh action plus the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] and calls [refresh]/[retry]/[onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SecurityPanel) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitypanel

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
 * @param source the cache-then-network vehicles + latest-security + latest-config seam (a shared-data-layer
 *   adapter in production, a fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the host-selected vehicle (the web prop's source); a `null`/non-positive id falls back to
 *   the first enrolled vehicle, and when none resolves the surface renders its empty state.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SecurityPanelViewModel(
    private val source: SecurityPanelSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's latest security + remote-start snapshot as a lifecycle-aware [UiState]: loading /
     * content / empty (no security object and no remote-start flag) / stale / offline / error, carrying the
     * freshness stamp + error kind. Empty mirrors the web `hasData ? … : <EmptyState/>` gate — a snapshot
     * with neither input is the empty surface, but the titled panel still renders (never a blank box).
     */
    val state: StateFlow<UiState<SecuritySnapshot>> =
        refreshTrigger
            .flatMapLatest {
                securityPanelResource(source.vehicles(), vehicleId, source::security, source::vehicleConfig)
            }.asUiState { SecurityPanelProjection.isEmptySnapshot(it) }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no lock/sentry/door payload, so a diagnostics line can never leak access state. Call
     * from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSecurityPanelOpened(logger)
    }

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("securityPanel.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: SecurityPanelSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SecurityPanelViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
