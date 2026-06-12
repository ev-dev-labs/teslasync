// UI-thread-free state holder backing the Compose [SummarySlide] — the native port of the web slide's data
// composition (web/src/features/analytics/components/review/SummarySlide.tsx, fed by the
// web/src/features/analytics/pages/YearReviewPage.tsx query). It binds the shared data feeds (P1/S8)
// through [SummarySlideSource]: when no explicit vehicle is configured it resolves the default vehicle from
// the `useVehicles` list (web `vehicleId ?? vehicles?.[0]?.id`), then projects the `useYearReview`
// cache-then-network envelope onto the shared [UiState] surface (loading / content / empty / stale /
// offline / error). The display preference (distance unit) is derived separately from the live `/settings`
// feed (web `useUnits`). It exposes the single refresh action plus the PII-safe `view.opened` diagnostic.
// The view never performs HTTP — it only collects [state] / [displayPrefs] and calls [refresh] / [onAppear].
//
// No-vehicle parity note (intentional, non-silent): the web `useYearReview` query is `enabled: !!vehicleId`
// with no fleet-wide shape, so when no vehicle resolves the page renders its empty surface and never issues
// a `vehicle_id`-less request. The view-model mirrors that — it requests the feed only for a resolved
// vehicle — and, while the vehicles list is genuinely still loading, surfaces the loading state, honouring
// the prompt's "empty = data resolved, no value" contract.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SummarySlide) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.feature.views.summaryslide

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
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
import kotlinx.serialization.json.JsonNull

/**
 * @param source the cache-then-network seam (a shared-data-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only resolves the default vehicle and projects the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param year the recap year to request (web `new Date().getFullYear()`); injectable for deterministic tests.
 * @param vehicleId the explicitly configured vehicle. When `null`/non-positive the first enrolled vehicle is
 *   used; when no vehicle resolves the empty surface is shown (web `enabled: !!vehicleId` ⇒ disabled query
 *   ⇒ no data), never a fleet-wide request.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SummarySlideViewModel(
    private val source: SummarySlideSource,
    logger: Logger,
    private val year: Int,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The annual recap payload as cache-then-network UI state (loading / content / empty / stale / offline
     * / error), carrying the freshness stamp + error kind. Empty mirrors the web `data ?` gate — an absent
     * payload (no resolvable vehicle, or a null/empty response) resolves to the empty surface, while any
     * populated payload renders the card.
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { yearReviewFeed() }
            .asUiState(isEmpty = { parseSummarySlide(it) == null })

    /** The live display preference (distance unit), re-derived as settings change (web `useUnits`). */
    val displayPrefs: StateFlow<SummarySlideDisplayPrefs> =
        source
            .settings()
            .map { resource -> SummarySlideDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = SummarySlideDisplayPrefs.METRIC_DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no distance / energy / savings / vehicle payload, so a diagnostics line can never
     * leak the owner's annual totals. Call from the composable's first-composition effect.
     */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SummarySlideRegistration.SLUG))
    }

    /**
     * The rendered feed: the explicit vehicle's annual recap when one is configured, otherwise the first
     * enrolled vehicle's recap resolved from the live vehicles list. When no vehicle resolves the feed
     * yields an empty payload (web disabled-query ⇒ no data) once the vehicles list has settled, and the
     * loading state while it is still in flight — the recap is never requested without a vehicle id.
     */
    private fun yearReviewFeed(): Flow<Resource<JsonElement>> {
        val explicit = vehicleId
        return if (explicit != null && explicit > 0L) {
            source.yearReview(year, explicit.toString())
        } else {
            source.vehicles().flatMapLatest { vehiclesResource ->
                val firstId = vehiclesResource.cached?.firstOrNull()?.id
                val resolvable = firstId?.takeIf { it > 0L }
                when {
                    resolvable != null -> source.yearReview(year, resolvable.toString())
                    vehiclesResource is Resource.Loading -> flowOf(LOADING)
                    else -> flowOf(EMPTY)
                }
            }
        }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "summarySlide.refresh"
        private const val FIELD_SURFACE = "surface"

        /** Still resolving the default vehicle — render the loading surface, nothing cached yet. */
        private val LOADING: Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        /** Vehicles settled with no usable vehicle — the web disabled-query "no data" surface. */
        private val EMPTY: Resource<JsonElement> = Resource.Success(JsonNull, fetchedAt = 0L, stale = false)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: SummarySlideSource,
            logger: Logger,
            year: Int,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SummarySlideViewModel(source, logger, year, vehicleId) }
            }
    }
}
