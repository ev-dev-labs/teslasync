package io.teslasync.shared.core.presentation.charging

import io.teslasync.shared.core.api.generated.ChargeTelemetryReading
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.CHARGE_PLANS_FAMILY
import io.teslasync.shared.core.data.repo.CHARGING_SESSIONS_FAMILY
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TESLA_CHARGING_HISTORY_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_CHARGING_SESSIONS_FAMILY
import io.teslasync.shared.core.data.repo.chargePlansKey
import io.teslasync.shared.core.data.repo.chargeTelemetryKey
import io.teslasync.shared.core.data.repo.chargingKeyInFamily
import io.teslasync.shared.core.data.repo.chargingOptimizerKey
import io.teslasync.shared.core.data.repo.chargingPaginatedKey
import io.teslasync.shared.core.data.repo.chargingSessionByIdKey
import io.teslasync.shared.core.data.repo.chargingSessionDetailKey
import io.teslasync.shared.core.data.repo.chargingSessionsKey
import io.teslasync.shared.core.data.repo.costForecastKey
import io.teslasync.shared.core.data.repo.ratePlansKey
import io.teslasync.shared.core.data.repo.teslaChargingHistoryKey
import io.teslasync.shared.core.data.repo.teslaChargingSessionsKey
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
 * UI-free shared state holder for the Charging domain — the cross-platform port of the web
 * `useCharging` hook domain (web/src/api/hooks/useCharging.ts). Every native Charging screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, the `safeArray` guards, or the invalidation families.
 *
 * Reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each is
 * lazily created on first access, shared so every observer of the same `(feed, params)` folds
 * into one upstream collection, and refreshable. The five mutations are non-throwing suspend
 * [Result]s; on success each refreshes EXACTLY the feed family the matching web hook invalidates
 * via `invalidateQueries`:
 *  - [bulkDeleteCharging]          → the `charging-sessions` family (sessions-by-vehicle + the
 *                                    string-id session detail — the same prefix `['charging-sessions']`
 *                                    matches under TanStack, and notably NOT the singular
 *                                    `['charging-session']` numeric detail);
 *  - [applySchedule]              → the `charge-plans` family (NOT the separate rate-plans key);
 *  - [refreshTeslaChargingHistory] → the `tesla-charging-history` family;
 *  - [refreshTeslaChargingSessions]→ the `tesla-charging-sessions` family;
 *  - [optimizeCharge]            → nothing (the web hook only toasts; the plan is returned).
 *
 * Refreshing re-collects the cache-then-network feed, which always re-fetches while replaying the
 * last cached rows first (the web behaviour of keeping prior data during a refetch). The holder
 * makes no network calls itself — it delegates entirely to the injected [ChargingRepository] (S7).
 * A feed nobody is observing is a no-op to refresh.
 *
 * The web `useChargingSessionDetail` `refetchInterval` (poll a live session every few seconds)
 * and the mutation toasts are render-layer concerns and are intentionally NOT reproduced here;
 * a platform pull-to-refresh / live-poll cadence drives re-collection. Values stay SI; conversion
 * is display-only (S5). This holder mirrors the web hook's single-threaded usage and is not
 * internally synchronised; create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class ChargingStore(
    private val repo: ChargingRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val sessionListFeeds = mutableMapOf<String, StateFlow<Resource<List<ChargingSession>>>>()
    private val sessionFeeds = mutableMapOf<String, StateFlow<Resource<ChargingSession>>>()
    private val telemetryFeeds = mutableMapOf<String, StateFlow<Resource<List<ChargeTelemetryReading>>>>()
    private val jsonFeeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    // ---- Reads --------------------------------------------------------------------

    /** Shared, refreshable `GET /charging-sessions?vehicle_id=` feed (web `useChargingSessions`). */
    public fun sessions(vehicleId: Long): StateFlow<Resource<List<ChargingSession>>> =
        feed(chargingSessionsKey(vehicleId), sessionListFeeds) { repo.sessions(vehicleId) }

    /** Shared, refreshable `GET /charging/{id}` feed by string id (web `useChargingSession`). */
    public fun session(id: String): StateFlow<Resource<ChargingSession>> =
        feed(chargingSessionDetailKey(id), sessionFeeds) { repo.session(id) }

    /** Shared, refreshable `GET /charging/{id}` feed by numeric id (web `useChargingSessionDetail`). */
    public fun sessionDetail(id: Long): StateFlow<Resource<ChargingSession>> =
        feed(chargingSessionByIdKey(id), sessionFeeds) { repo.sessionDetail(id) }

    /** Shared, refreshable `GET /charging/{sessionId}/telemetry` feed (web `useChargeTelemetry`). */
    public fun chargeTelemetry(sessionId: Long): StateFlow<Resource<List<ChargeTelemetryReading>>> =
        feed(chargeTelemetryKey(sessionId), telemetryFeeds) { repo.chargeTelemetry(sessionId) }

    /** Shared, refreshable paginated `GET /charging` feed (web `useChargingSessionsPaginated`). */
    public fun sessionsPaginated(
        vehicleId: Long,
        limit: Int = ChargingRepository.DEFAULT_LIMIT,
        offset: Int = 0,
        start: String? = null,
        end: String? = null,
    ): StateFlow<Resource<List<ChargingSession>>> =
        feed(chargingPaginatedKey(vehicleId, start, end, limit, offset), sessionListFeeds) {
            repo.sessionsPaginated(vehicleId, limit, offset, start, end)
        }

    /** Shared, refreshable `GET /analytics/cost-forecast` feed (web `useCostForecast`). */
    public fun costForecast(
        vehicleId: String,
        months: Int = ChargingRepository.DEFAULT_FORECAST_MONTHS,
    ): StateFlow<Resource<JsonElement>> = feed(costForecastKey(vehicleId, months), jsonFeeds) { repo.costForecast(vehicleId, months) }

    /** Shared, refreshable `GET /analytics/charging-optimizer` feed (web `useChargingOptimizer`). */
    public fun chargingOptimizer(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(chargingOptimizerKey(vehicleId), jsonFeeds) { repo.chargingOptimizer(vehicleId) }

    /** Shared, refreshable `GET /tesla/charging/history` feed (web `useTeslaChargingHistory`). */
    public fun teslaChargingHistory(vin: String? = null): StateFlow<Resource<JsonElement>> =
        feed(teslaChargingHistoryKey(vin), jsonFeeds) { repo.teslaChargingHistory(vin) }

    /** Shared, refreshable `GET /tesla/charging/sessions` feed (web `useTeslaChargingSessions`). */
    public fun teslaChargingSessions(vin: String? = null): StateFlow<Resource<JsonElement>> =
        feed(teslaChargingSessionsKey(vin), jsonFeeds) { repo.teslaChargingSessions(vin) }

    /** Shared, refreshable `GET /charge-planner/history` feed (web `useChargePlans`). */
    public fun chargePlans(vehicleId: Long): StateFlow<Resource<JsonElement>> =
        feed(chargePlansKey(vehicleId), jsonFeeds) { repo.chargePlans(vehicleId) }

    /** Shared, refreshable `GET /charge-planner/rate-plans` feed (web `useRatePlans`). */
    public fun ratePlans(): StateFlow<Resource<JsonElement>> = feed(ratePlansKey(), jsonFeeds) { repo.ratePlans() }

    // ---- Mutations ----------------------------------------------------------------

    /** Refreshes Tesla charging history, then re-fetches the history family (web `useRefreshTeslaChargingHistory`). */
    public suspend fun refreshTeslaChargingHistory(
        vin: String? = null,
        startTime: String? = null,
        endTime: String? = null,
    ): Result<JsonElement> =
        repo.refreshTeslaChargingHistory(vin, startTime, endTime).onSuccess { refreshFamily(TESLA_CHARGING_HISTORY_FAMILY) }

    /** Refreshes Tesla fleet charging sessions, then re-fetches the sessions family (web `useRefreshTeslaChargingSessions`). */
    public suspend fun refreshTeslaChargingSessions(
        vin: String? = null,
        dateFrom: String? = null,
        dateTo: String? = null,
    ): Result<JsonElement> =
        repo.refreshTeslaChargingSessions(vin, dateFrom, dateTo).onSuccess { refreshFamily(TESLA_CHARGING_SESSIONS_FAMILY) }

    /**
     * Optimizes a charge schedule and returns the plan (web `useOptimizeCharge`). The web hook
     * invalidates nothing — it only toasts — so no feed is refreshed here.
     */
    public suspend fun optimizeCharge(input: OptimizeChargeInput): Result<JsonElement> = repo.optimizeCharge(input)

    /** Applies an optimized plan, then re-fetches the charge-plans family (web `useApplySchedule`). */
    public suspend fun applySchedule(input: ApplyScheduleInput): Result<JsonElement> =
        repo.applySchedule(input).onSuccess { refreshFamily(CHARGE_PLANS_FAMILY) }

    /** Bulk-deletes charging sessions, then re-fetches the charging-sessions family (web `useBulkDeleteCharging`). */
    public suspend fun bulkDeleteCharging(ids: List<Long>): Result<JsonElement> =
        repo.bulkDeleteCharging(ids).onSuccess { refreshFamily(CHARGING_SESSIONS_FAMILY) }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection (via [refreshFamily]), and
     * [SharingStarted.WhileSubscribed] keeps a single upstream shared across observers while at
     * least one is active.
     */
    private fun <T> feed(
        key: String,
        feeds: MutableMap<String, StateFlow<Resource<T>>>,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                )
        }

    /**
     * Re-fetches every observed feed whose key belongs to [family] under TanStack
     * prefix-invalidation semantics ([chargingKeyInFamily]) — the holder-side analogue of
     * `invalidateQueries({ queryKey: [family] })`. The keys are snapshotted before iterating so a
     * concurrent feed creation cannot disturb the walk; a family nobody observes is a no-op.
     */
    private fun refreshFamily(family: String) {
        triggers.keys
            .filter { chargingKeyInFamily(it, family) }
            .toList()
            .forEach { triggers[it]?.update { n -> n + 1 } }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
