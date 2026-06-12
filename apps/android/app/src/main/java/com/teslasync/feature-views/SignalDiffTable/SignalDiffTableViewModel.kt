// UI-thread-free state holder backing the SignalDiffTable feature view — the native port of the single
// `useSignalDiffServer` query the web parent owns and passes down as `rows`/`loading`
// (web/src/features/telemetry/components/SignalDiffTable.tsx + web/src/api/hooks/useTelemetry.ts). It binds
// the shared Telemetry feed (P1/S8) through [SignalDiffTableSource]: it collects the cache-then-network
// `GET /signals/{id}/diff?at_a=&at_b=[&signals=]` [Resource] for the configured window and projects it onto a
// single [SignalDiffTableState] (cached diff + freshness + classified error). The view never performs HTTP —
// it only collects [state] and calls [refresh] / [recordViewOpened]. Window + vehicle selection is the host
// page's concern (web parity), so a non-positive id or a blank window holds the neutral empty state rather
// than opening a feed.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalDiffTable) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signaldifftable

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalDiffServerResponse
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
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
 * The data port the table binds to — the native analogue of the web `useSignalDiffServer` hook. A concrete
 * adapter over the shared Telemetry data layer (or a test fake) drives this seam; the view never performs
 * HTTP. The diff is carried as the raw SI [SignalDiffServerResponse] the backend serves, untouched.
 */
interface SignalDiffTableSource {
    /** The cache-then-network `GET /signals/{vehicleId}/diff?at_a=&at_b=[&signals=]` feed (web hook). */
    fun signalDiff(
        vehicleId: Long,
        atA: String,
        atB: String,
        signalsCsv: String,
    ): Flow<Resource<SignalDiffServerResponse>>
}

/**
 * Binds the table to the shared **S7** [TelemetryRepository] — the cold cache-then-network `Flow` the S8
 * [TelemetryStore] also wraps. Re-collecting the feed performs a genuine cache-then-network re-fetch, which
 * backs the table's manual refresh / error-retry affordance. No HTTP touches the view.
 */
fun TelemetryRepository.asSignalDiffTableSource(): SignalDiffTableSource {
    val repo = this
    return object : SignalDiffTableSource {
        override fun signalDiff(
            vehicleId: Long,
            atA: String,
            atB: String,
            signalsCsv: String,
        ): Flow<Resource<SignalDiffServerResponse>> = repo.signalDiffServer(vehicleId, atA, atB, signalsCsv)
    }
}

/**
 * Binds the table to the shared **S8** [TelemetryStore] — the memoized, multi-observer feed every Telemetry
 * surface shares. Use this when a host wants the table to fold into the same shared collection as the rest of
 * the app; the diff values (incl. the store's background refresh) flow through unchanged. No HTTP touches the
 * view.
 */
fun TelemetryStore.asSignalDiffTableSource(): SignalDiffTableSource {
    val store = this
    return object : SignalDiffTableSource {
        override fun signalDiff(
            vehicleId: Long,
            atA: String,
            atB: String,
            signalsCsv: String,
        ): Flow<Resource<SignalDiffServerResponse>> = store.signalDiffServer(vehicleId, atA, atB, signalsCsv)
    }
}

/**
 * @param source the cache-then-network Telemetry seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only collects + projects the feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param query the host-selected vehicle + snapshot window (web parent's pickers). A non-positive vehicle or
 *   a blank window holds [SignalDiffTableState.EMPTY] so the table renders its friendly empty state rather
 *   than spinning (web `enabled: vehicleId > 0 && atAIso && atBIso`).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalDiffTableViewModel(
    private val source: SignalDiffTableSource,
    logger: Logger,
    private val query: SignalDiffQuery = SignalDiffQuery(),
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The projected diff table surface as a lifecycle-aware [StateFlow]. While no vehicle / window is selected
     * (web `enabled:false`) it stays [SignalDiffTableState.EMPTY], so the table shows its friendly empty state
     * rather than spinning forever.
     */
    val state: StateFlow<SignalDiffTableState> =
        refreshTrigger
            .flatMapLatest { resolvedFeed() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = SignalDiffTableState.EMPTY,
            )

    /** Re-runs the cache-then-network load (the web parent's refetch + the freshness/error retry). */
    fun refresh() {
        logger.info("signalDiffTable.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no signal name or value, so a diagnostics line can never leak the vehicle's compared state. Call
     * from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSignalDiffTableOpened(logger)
    }

    /**
     * The rendered feed: the configured window's server-side diff, or [SignalDiffTableState.EMPTY] when no
     * vehicle / window is selected (web disabled-query branch), all without ever issuing HTTP from the view.
     */
    private fun resolvedFeed(): Flow<SignalDiffTableState> {
        val id = query.vehicleId
        return if (query.isEnabled && id != null) {
            source.signalDiff(id, query.atA, query.atB, query.signalsCsv).map { it.toState() }
        } else {
            flowOf(SignalDiffTableState.EMPTY)
        }
    }

    /** Project a feed emission onto the render state, retaining the cached diff across error/refetch. */
    private fun Resource<SignalDiffServerResponse>.toState(): SignalDiffTableState =
        SignalDiffTableState(
            response = cached,
            updatedAtMillis = fetchedAtMillis(),
            isFetching = this is Resource.Loading,
            isStale = stale,
            isError = this is Resource.Error,
            errorKind = if (this is Resource.Error) SignalDiffTableProjection.queryErrorKindOf(error) else null,
        )

    /** The freshness stamp of a feed emission (web `dataUpdatedAt`), across loading / success / error. */
    private fun Resource<SignalDiffServerResponse>.fetchedAtMillis(): Long? =
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
