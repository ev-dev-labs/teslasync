package io.teslasync.shared.core.presentation.analytics

import io.teslasync.shared.core.data.repo.AnalyticsRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * UI-free shared state holder for the Analytics read-model surface — the cross-platform port
 * of the web `useAnalytics` hook domain (web/src/api/hooks/useAnalytics.ts). Every native
 * Analytics screen (Android/Apple via KMP, Windows via the C# port) binds to this single
 * holder rather than re-implementing endpoints, query keys, or the array-guard derivations.
 *
 * Reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each is
 * lazily created on first access, shared so every observer of the same `(feed, params)` folds
 * into one upstream collection, and refreshable via [refresh]. The domain is read-only — the
 * web hook file declares zero mutations — so the holder exposes no mutation/invalidation API;
 * a generic [refresh] is provided so a platform pull-to-refresh can re-collect a feed.
 *
 * The holder makes no network calls itself — it delegates entirely to the injected
 * [AnalyticsRepository] (S7), which performs the endpoint calls, the SI-verbatim caching, and
 * the `safeArray`/`unwrapArray` derivations. Values stay SI; conversion is display-only (S5).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally
 * synchronised; create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class AnalyticsStore(
    private val repo: AnalyticsRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    // ---- Reads (11) ---------------------------------------------------------------

    /** Shared, refreshable `GET /analytics/fleet?days={days}` summary feed (web `useAnalyticsSummary`). */
    public fun analyticsSummary(days: Int = 30): StateFlow<Resource<JsonElement>> =
        feed("$KEY_SUMMARY:$days") { repo.analyticsSummary(days) }

    /** Shared, refreshable `GET /analytics/fleet` deep-analytics feed (web `useFleetAnalytics`). */
    public fun fleetAnalytics(
        days: Int? = null,
        start: String? = null,
        end: String? = null,
    ): StateFlow<Resource<JsonElement>> = feed("$KEY_FLEET:$days:$start:$end") { repo.fleetAnalytics(days, start, end) }

    /** Shared, refreshable `GET /mileage/stats` feed for [vehicleId] (web `useMileageStats`). */
    public fun mileageStats(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed("$KEY_MILEAGE:$vehicleId") { repo.mileageStats(vehicleId) }

    /** Shared, refreshable `GET /mileage/monthly` feed for [vehicleId] (web `useMonthlyMileage`). */
    public fun monthlyMileage(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed("$KEY_MONTHLY:$vehicleId") { repo.monthlyMileage(vehicleId) }

    /** Shared, refreshable `GET /mileage/daily` feed for [vehicleId]/[days] (web `useDailyMileage`). */
    public fun dailyMileage(
        vehicleId: String,
        days: Int = 90,
    ): StateFlow<Resource<JsonElement>> = feed("$KEY_DAILY:$vehicleId:$days") { repo.dailyMileage(vehicleId, days) }

    /** Shared, refreshable `GET /analytics/tco` feed for [vehicleId] (web `useCostBreakdown`). */
    public fun costBreakdown(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed("$KEY_COST:$vehicleId") { repo.costBreakdown(vehicleId) }

    /** Shared, refreshable `GET /vehicle-states/timeline` feed for [vehicleId] (web `useTimeline`). */
    public fun timeline(vehicleId: String): StateFlow<Resource<JsonElement>> = feed("$KEY_TIMELINE:$vehicleId") { repo.timeline(vehicleId) }

    /** Shared, refreshable `GET /vehicle-states/summary` feed for [vehicleId] (web `useStateSummary`). */
    public fun stateSummary(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed("$KEY_STATE_SUMMARY:$vehicleId") { repo.stateSummary(vehicleId) }

    /** Shared, refreshable `GET /vehicles/{vehicleId}/weekly-digest` feed (web `useWeeklyDigest`). */
    public fun weeklyDigest(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed("$KEY_WEEKLY_DIGEST:$vehicleId") { repo.weeklyDigest(vehicleId) }

    /** Shared, refreshable `GET /analytics/lifetime` feed for the optional [vehicleId] (web `useLifetimeStats`). */
    public fun lifetimeStats(vehicleId: String? = null): StateFlow<Resource<JsonElement>> =
        feed("$KEY_LIFETIME:$vehicleId") { repo.lifetimeStats(vehicleId) }

    /** Shared, refreshable `GET /analytics/year-review` feed for [year]/[vehicleId] (web `useYearReview`). */
    public fun yearReview(
        year: Int,
        vehicleId: String? = null,
    ): StateFlow<Resource<JsonElement>> = feed("$KEY_YEAR_REVIEW:$year:$vehicleId") { repo.yearReview(year, vehicleId) }

    // ---- Refresh ------------------------------------------------------------------

    /** Re-fetches the [analyticsSummary] feed for [days] if it is being observed. */
    public fun refreshAnalyticsSummary(days: Int = 30): Unit = refresh("$KEY_SUMMARY:$days")

    /** Re-fetches the [fleetAnalytics] feed for the given bounds if it is being observed. */
    public fun refreshFleetAnalytics(
        days: Int? = null,
        start: String? = null,
        end: String? = null,
    ): Unit = refresh("$KEY_FLEET:$days:$start:$end")

    /** Re-fetches the [mileageStats] feed for [vehicleId] if it is being observed. */
    public fun refreshMileageStats(vehicleId: String): Unit = refresh("$KEY_MILEAGE:$vehicleId")

    /** Re-fetches the [monthlyMileage] feed for [vehicleId] if it is being observed. */
    public fun refreshMonthlyMileage(vehicleId: String): Unit = refresh("$KEY_MONTHLY:$vehicleId")

    /** Re-fetches the [dailyMileage] feed for [vehicleId]/[days] if it is being observed. */
    public fun refreshDailyMileage(
        vehicleId: String,
        days: Int = 90,
    ): Unit = refresh("$KEY_DAILY:$vehicleId:$days")

    /** Re-fetches the [costBreakdown] feed for [vehicleId] if it is being observed. */
    public fun refreshCostBreakdown(vehicleId: String): Unit = refresh("$KEY_COST:$vehicleId")

    /** Re-fetches the [timeline] feed for [vehicleId] if it is being observed. */
    public fun refreshTimeline(vehicleId: String): Unit = refresh("$KEY_TIMELINE:$vehicleId")

    /** Re-fetches the [stateSummary] feed for [vehicleId] if it is being observed. */
    public fun refreshStateSummary(vehicleId: String): Unit = refresh("$KEY_STATE_SUMMARY:$vehicleId")

    /** Re-fetches the [weeklyDigest] feed for [vehicleId] if it is being observed. */
    public fun refreshWeeklyDigest(vehicleId: String): Unit = refresh("$KEY_WEEKLY_DIGEST:$vehicleId")

    /** Re-fetches the [lifetimeStats] feed for the optional [vehicleId] if it is being observed. */
    public fun refreshLifetimeStats(vehicleId: String? = null): Unit = refresh("$KEY_LIFETIME:$vehicleId")

    /** Re-fetches the [yearReview] feed for [year]/[vehicleId] if it is being observed. */
    public fun refreshYearReview(
        year: Int,
        vehicleId: String? = null,
    ): Unit = refresh("$KEY_YEAR_REVIEW:$year:$vehicleId")

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active.
     */
    private fun feed(
        key: String,
        source: () -> Flow<Resource<JsonElement>>,
    ): StateFlow<Resource<JsonElement>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        }

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        const val KEY_SUMMARY = "summary"
        const val KEY_FLEET = "fleet"
        const val KEY_MILEAGE = "mileage"
        const val KEY_MONTHLY = "monthly-mileage"
        const val KEY_DAILY = "daily-mileage"
        const val KEY_COST = "cost"
        const val KEY_TIMELINE = "timeline"
        const val KEY_STATE_SUMMARY = "state-summary"
        const val KEY_WEEKLY_DIGEST = "weekly-digest"
        const val KEY_LIFETIME = "lifetime"
        const val KEY_YEAR_REVIEW = "year-review"
    }
}
