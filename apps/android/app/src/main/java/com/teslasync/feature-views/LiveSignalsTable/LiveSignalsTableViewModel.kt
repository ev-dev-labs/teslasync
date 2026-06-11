// UI-thread-free state holder backing the LiveSignalsTable feature view — the native port of the single
// `useVehicleLiveSignals` query the web parent owns and passes down as `data`/`loading`
// (web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx +
// web/src/api/hooks/useTelemetry.ts). It binds the shared Telemetry feed (P1/S8) through
// [LiveSignalsTableSource]: it collects the cache-then-network `GET /signals/{id}/live` [Resource] for the
// configured vehicle and projects it onto a single [LiveSignalsTableState] (cached snapshot + freshness +
// classified error). The view never performs HTTP — it only collects [state] and calls
// [refresh] / [recordViewOpened]. Vehicle selection is the host page's concern (web parity), so a
// non-positive id holds the neutral empty state rather than opening a feed.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveSignalsTable) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livesignalstable

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
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

/**
 * The data port the table binds to — the native analogue of the web `useVehicleLiveSignals` hook. A concrete
 * adapter over the shared Telemetry data layer (or a test fake) drives this seam; the view never performs
 * HTTP. The snapshot is carried as the raw SI [VehicleLiveSignalsResponse] the backend serves, untouched.
 */
interface LiveSignalsTableSource {
    /** The cache-then-network `GET /signals/{vehicleId}/live` feed (web `useVehicleLiveSignals`). */
    fun vehicleLiveSignals(vehicleId: Long): Flow<Resource<VehicleLiveSignalsResponse>>
}

/**
 * Binds the table to the shared **S7** [TelemetryRepository] — the cold cache-then-network `Flow` the S8
 * [TelemetryStore] also wraps. Re-collecting the feed performs a genuine cache-then-network re-fetch, which
 * backs the table's manual refresh / error-retry affordance. No HTTP touches the view.
 */
fun TelemetryRepository.asLiveSignalsTableSource(): LiveSignalsTableSource {
    val repo = this
    return object : LiveSignalsTableSource {
        override fun vehicleLiveSignals(vehicleId: Long): Flow<Resource<VehicleLiveSignalsResponse>> = repo.vehicleLiveSignals(vehicleId)
    }
}

/**
 * Binds the table to the shared **S8** [TelemetryStore] — the memoized, multi-observer feed every Telemetry
 * surface shares. Use this when a host wants the table to fold into the same shared collection as the rest
 * of the app; the live values (incl. the store's background refresh) flow through unchanged. No HTTP touches
 * the view.
 */
fun TelemetryStore.asLiveSignalsTableSource(): LiveSignalsTableSource {
    val store = this
    return object : LiveSignalsTableSource {
        override fun vehicleLiveSignals(vehicleId: Long): Flow<Resource<VehicleLiveSignalsResponse>> = store.vehicleLiveSignals(vehicleId)
    }
}

/**
 * @param source the cache-then-network Telemetry seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only collects + projects the feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param vehicleId the host-selected vehicle (web parent's vehicle picker). A `null`/non-positive id holds
 *   [LiveSignalsTableState.EMPTY] so the table renders its friendly empty state rather than spinning.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveSignalsTableViewModel(
    private val source: LiveSignalsTableSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The projected live-signal table surface as a lifecycle-aware [StateFlow]. While no vehicle is selected
     * (web `enabled:false`) it stays [LiveSignalsTableState.EMPTY], so the table shows its friendly empty
     * state rather than spinning forever.
     */
    val state: StateFlow<LiveSignalsTableState> =
        refreshTrigger
            .flatMapLatest { resolvedFeed() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = LiveSignalsTableState.EMPTY,
            )

    /** Re-runs the cache-then-network load (the web parent's poll/refetch + the freshness/error retry). */
    fun refresh() {
        logger.info("liveSignalsTable.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no signal name or value, so a diagnostics line can never leak the vehicle's live
     * state. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordLiveSignalsTableOpened(logger)
    }

    /**
     * The rendered feed: the configured vehicle's live signals, or [LiveSignalsTableState.EMPTY] when no
     * vehicle is selected (web disabled-query branch), all without ever issuing HTTP from the view.
     */
    private fun resolvedFeed(): Flow<LiveSignalsTableState> {
        val id = vehicleId
        return if (id != null && id > 0L) {
            source.vehicleLiveSignals(id).map { it.toState() }
        } else {
            flowOf(LiveSignalsTableState.EMPTY)
        }
    }

    /** Project a feed emission onto the render state, retaining the cached snapshot across error/refetch. */
    private fun Resource<VehicleLiveSignalsResponse>.toState(): LiveSignalsTableState =
        LiveSignalsTableState(
            response = cached,
            updatedAtMillis = fetchedAtMillis(),
            isFetching = this is Resource.Loading,
            isStale = stale,
            isError = this is Resource.Error,
            errorKind = if (this is Resource.Error) LiveSignalsTableProjection.queryErrorKindOf(error) else null,
        )

    /** The freshness stamp of a feed emission (web `dataUpdatedAt`), across loading / success / error. */
    private fun Resource<VehicleLiveSignalsResponse>.fetchedAtMillis(): Long? =
        when (this) {
            is Resource.Loading -> fetchedAt
            is Resource.Success -> fetchedAt
            is Resource.Error -> fetchedAt
        }

    private companion object {
        /** Keep the upstream alive briefly across config changes / fast re-subscribes. */
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
