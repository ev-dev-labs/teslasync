// UI-thread-free state holder backing the Mileage Stats widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/MileageStatsWidget.tsx). It binds the shared data
// feeds (P1/S8) through [MileageStatsSource]: when no explicit vehicle is configured it resolves the
// default vehicle from the `useVehicles` list (web `vehicleId ?? vehicles?.[0]?.id`), then projects the
// `useMileageStats` cache-then-network envelope onto the shared [UiState] surface (loading / content /
// empty / stale / offline / error). It exposes the single refresh action plus the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MileageStatsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.mileagestats

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
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
class MileageStatsWidgetViewModel(
    private val source: MileageStatsSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The mileage payload as cache-then-network UI state (loading / content / empty / stale / offline /
     * error), carrying the freshness stamp + error kind. Empty mirrors the web `data ? … : empty` gate —
     * the no-vehicle sentinel (empty object) resolves to the empty surface, a real payload to content.
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { mileageFeed() }
            .asUiState(isEmpty = { !parseMileageStats(it).hasData })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("mileageStats.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no mileage / vehicle payload, so a diagnostics line can never leak the owner's
     * driving distance. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to MileageStatsRegistration.SLUG))
    }

    /**
     * The rendered feed: the explicit vehicle's mileage stats when one is configured, otherwise the first
     * enrolled vehicle's stats resolved from the live vehicles list (web `vehicles?.[0]?.id`, gated by
     * `id > 0`). While the list is loading (no cached vehicle) the surface stays in loading; an empty
     * list resolves to an empty payload (no vehicle ⇒ "No mileage data") rather than issuing a bogus
     * `vehicle_id=0` request; a list error with no cache surfaces as an error — all without ever issuing
     * HTTP from the view.
     */
    private fun mileageFeed(): Flow<Resource<JsonElement>> {
        val explicit = vehicleId
        return if (explicit != null && explicit > 0L) {
            source.mileageStats(explicit.toString())
        } else {
            source.vehicles().flatMapLatest { vehiclesResource ->
                val firstId = vehiclesResource.cached?.firstOrNull()?.id
                if (firstId != null && firstId > 0L) {
                    source.mileageStats(firstId.toString())
                } else {
                    flowOf(noVehicleResource(vehiclesResource))
                }
            }
        }
    }

    /**
     * Folds a vehicles feed that yields no usable vehicle onto the mileage surface: a list still loading
     * stays loading; a hard list error becomes a mileage error (retry); a resolved-but-empty list becomes
     * an empty-object success so the widget shows its friendly empty state rather than spinning forever.
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
