// UI-thread-free state holder backing the Cost Breakdown widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/CostBreakdownWidget.tsx). It binds the shared
// data feeds (P1/S8) through [CostBreakdownSource]: when no explicit vehicle is configured it resolves
// the default vehicle from the `useVehicles` list (web `vehicleId ?? vehicles?.[0]?.id`), then projects
// the `useCostBreakdown` cache-then-network TCO envelope onto the shared [UiState] surface (loading /
// content / empty / stale / offline / error). The display preferences (currency + distance unit +
// precision) are derived separately from the live `/settings` feed (web `useUnits`/`useFormatting`). It
// exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The view never performs
// HTTP — it only collects [state] / [displayPrefs] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/CostBreakdownWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.costbreakdown

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
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * @param source the cache-then-network seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only resolves the default vehicle and projects the
 *   feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-
 *   positive the first enrolled vehicle is used, exactly as the web `vehicles?.[0]?.id` fallback does.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CostBreakdownWidgetViewModel(
    private val source: CostBreakdownSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The TCO payload as cache-then-network UI state (loading / content / empty / stale / offline /
     * error), carrying the freshness stamp + error kind. Empty mirrors the web
     * `monthlyEntries.length > 0` gate — a payload with no `monthly_breakdown` rows resolves to empty.
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { costFeed() }
            .asUiState(isEmpty = { !parseCostBreakdown(it).hasData })

    /** The live display preferences (currency + distance unit + precision), re-derived as settings change. */
    val displayPrefs: StateFlow<CostBreakdownDisplayPrefs> =
        source
            .settings()
            .map { resource -> CostBreakdownDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = CostBreakdownDisplayPrefs.METRIC_DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("costBreakdown.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no cost / savings / vehicle payload, so a diagnostics line can never leak the
     * owner's spending. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to CostBreakdownRegistration.SLUG))
    }

    /**
     * The rendered feed: the explicit vehicle's TCO when one is configured, otherwise the first enrolled
     * vehicle's TCO resolved from the live vehicles list. While the list is loading (no cached vehicle)
     * the surface stays in loading; an empty list resolves to an empty TCO payload (no vehicle ⇒ "No
     * cost data") rather than issuing a bogus `vehicle_id=0` request; a list error with no cache
     * surfaces as an error — all without ever issuing HTTP from the view.
     */
    private fun costFeed(): Flow<Resource<JsonElement>> {
        val explicit = vehicleId
        return if (explicit != null && explicit > 0L) {
            source.costBreakdown(explicit.toString())
        } else {
            source.vehicles().flatMapLatest { vehiclesResource ->
                val firstId = vehiclesResource.cached?.firstOrNull()?.id
                if (firstId != null && firstId > 0L) {
                    source.costBreakdown(firstId.toString())
                } else {
                    flowOf(noVehicleResource(vehiclesResource))
                }
            }
        }
    }

    /**
     * Folds a vehicles feed that yields no usable vehicle onto the TCO surface: a list still loading
     * stays loading; a hard list error becomes a TCO error (retry); a resolved-but-empty list becomes an
     * empty-object success so the widget shows its friendly empty state rather than spinning forever.
     */
    private fun noVehicleResource(resource: Resource<List<*>>): Resource<JsonElement> =
        when (resource) {
            is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
            is Resource.Error ->
                Resource.Error(cached = null, fetchedAt = resource.fetchedAt, stale = resource.stale, error = resource.error)
            is Resource.Success ->
                Resource.Success(EMPTY_PAYLOAD, fetchedAt = resource.fetchedAt, stale = false)
        }

    private companion object {
        /** The "no decodable payload" envelope, surfaced when no vehicle resolves (web `data: undefined`). */
        val EMPTY_PAYLOAD: JsonElement = JsonObject(emptyMap())
    }
}
