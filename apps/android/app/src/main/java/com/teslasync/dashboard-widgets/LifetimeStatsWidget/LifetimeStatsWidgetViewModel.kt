// UI-thread-free state holder backing the Lifetime Stats widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx). It binds the shared
// data feeds (P1/S8) through [LifetimeStatsSource]: when no explicit vehicle is configured it resolves
// the default vehicle from the `useVehicles` list (web `vehicleId ?? vehicles?.[0]?.id`) and otherwise
// requests the fleet-wide lifetime totals (web `?? 0` ⇒ no `vehicle_id`), then projects the
// `useLifetimeStats` cache-then-network envelope onto the shared [UiState] surface (loading / content /
// empty / stale / offline / error). The display preferences (currency + distance unit + precision) are
// derived separately from the live `/settings` feed (web `useUnits`/`useFormatting`). It exposes the
// single refresh action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it
// only collects [state] / [displayPrefs] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LifetimeStatsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.lifetimestats

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
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
 *   tests). The view-model owns no networking — it only resolves the default vehicle and projects the
 *   feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-
 *   positive the first enrolled vehicle is used, and when there is none the fleet-wide lifetime totals
 *   are requested — exactly as the web `vehicleId ?? vehicles?.[0]?.id ?? 0` fallback resolves.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LifetimeStatsWidgetViewModel(
    private val source: LifetimeStatsSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The lifetime payload as cache-then-network UI state (loading / content / empty / stale / offline /
     * error), carrying the freshness stamp + error kind. Empty mirrors the sibling `hasData` gate — an
     * all-zero payload (no drives / distance / energy / ownership days) resolves to the empty surface.
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { lifetimeFeed() }
            .asUiState(isEmpty = { !parseLifetimeStats(it).hasData })

    /** The live display preferences (currency + distance unit + precision), re-derived as settings change. */
    val displayPrefs: StateFlow<LifetimeStatsDisplayPrefs> =
        source
            .settings()
            .map { resource -> LifetimeStatsDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = LifetimeStatsDisplayPrefs.METRIC_DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("lifetimeStats.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no distance / energy / cost / vehicle payload, so a diagnostics line can never
     * leak the owner's lifetime totals. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to LifetimeStatsRegistration.SLUG))
    }

    /**
     * The rendered feed: the explicit vehicle's lifetime totals when one is configured, otherwise the
     * first enrolled vehicle's totals resolved from the live vehicles list, falling back to the
     * fleet-wide totals when no vehicle resolves (list loading, empty, or errored). The lifetime query is
     * never blocked on the vehicles list — mirroring the web, where `id` collapses to `0` ⇒ a fleet-wide
     * request — so the surface still loads its totals when the vehicles list is unavailable.
     */
    private fun lifetimeFeed(): Flow<Resource<JsonElement>> {
        val explicit = vehicleId
        return if (explicit != null && explicit > 0L) {
            source.lifetimeStats(explicit.toString())
        } else {
            source.vehicles().flatMapLatest { vehiclesResource ->
                val firstId = vehiclesResource.cached?.firstOrNull()?.id
                source.lifetimeStats(firstId?.takeIf { it > 0L }?.toString())
            }
        }
    }
}
