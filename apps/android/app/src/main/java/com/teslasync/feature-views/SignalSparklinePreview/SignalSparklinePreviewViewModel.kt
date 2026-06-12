// UI-thread-free state holder backing the SignalSparklinePreview feature view — the native port of the single
// `useSignalHistory(vehicleId, signal, { hours: 1, limit: 30 })` query the web component owns
// (web/src/features/telemetry/components/SignalSparklinePreview.tsx + web/src/api/hooks/useSignals.ts). It
// binds the shared Signals feed (P1/S8) through [SignalSparklinePreviewSource]: it collects the
// cache-then-network `GET /signals/{id}/{signal}/history` [Resource] and projects it onto a single
// [SignalSparklinePreviewState] via [SignalSparklineProjection]. The view never performs HTTP — it only
// collects [state] and calls [refresh] / [recordViewOpened].
//
// The feed is opened only when it would actually produce a trend (web's "don't fire 600+ requests on mount"
// intent): the parent flips [enabled] on as a signal category expands, and a sparkline is only meaningful for
// a numeric kind against a real vehicle/signal — so a disabled, non-numeric, or unaddressed preview holds its
// projected state without ever opening a network feed.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalSparklinePreview) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalsparklinepreview

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalsRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalsStore
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
 * The data port the preview binds to — the native analogue of the web `useSignalHistory` hook. A concrete
 * adapter over the shared Signals data layer (or a test fake) drives this seam; the view never performs HTTP.
 * The series is carried as the raw SI [SignalHistoryResponse] the backend serves, untouched.
 */
interface SignalSparklinePreviewSource {
    /** The cache-then-network `GET /signals/{vehicleId}/{signalName}/history` feed (web `useSignalHistory`). */
    fun signalHistory(
        vehicleId: Long,
        signalName: String,
    ): Flow<Resource<SignalHistoryResponse>>
}

/**
 * Binds the preview to the shared **S8** [SignalsStore] — the memoized, multi-observer feed every Signals
 * surface shares. The history feed pins the [SPARKLINE_RANGE] trailing window (web's `{ hours: 1, limit: 30 }`),
 * so two previews of the same signal fold into one upstream collection. No HTTP touches the view.
 */
fun SignalsStore.asSignalSparklinePreviewSource(): SignalSparklinePreviewSource {
    val store = this
    return object : SignalSparklinePreviewSource {
        override fun signalHistory(
            vehicleId: Long,
            signalName: String,
        ): Flow<Resource<SignalHistoryResponse>> = store.signalHistory(vehicleId, signalName, SPARKLINE_RANGE)
    }
}

/**
 * Binds the preview to the shared **S7** [SignalsRepository] — the cold cache-then-network `Flow` the S8
 * [SignalsStore] also wraps. Re-collecting the feed performs a genuine cache-then-network re-fetch, which
 * backs the preview's error-retry / stale auto-refresh affordance. No HTTP touches the view.
 */
fun SignalsRepository.asSignalSparklinePreviewSource(): SignalSparklinePreviewSource {
    val repo = this
    return object : SignalSparklinePreviewSource {
        override fun signalHistory(
            vehicleId: Long,
            signalName: String,
        ): Flow<Resource<SignalHistoryResponse>> = repo.signalHistory(vehicleId, signalName, SPARKLINE_RANGE)
    }
}

/**
 * The signal-identity + gate inputs a preview binds to — the web component's `vehicleId` / `signal` /
 * `valueKind` / `enabled` props bundled into one value so the view-model takes a small, stable argument set.
 */
data class SignalSparklinePreviewArgs(
    val vehicleId: Long,
    val signal: String,
    val valueKind: SignalKind,
    val enabled: Boolean,
)

/**
 * @param source the cache-then-network Signals seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only collects + projects the feed.
 * @param args the signal identity + the parent's per-leaf gate (web `vehicleId` / `signal` / `valueKind` /
 *   `enabled` props); a disabled, non-numeric, or unaddressed preview never opens the feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalSparklinePreviewViewModel(
    private val source: SignalSparklinePreviewSource,
    private val args: SignalSparklinePreviewArgs,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the error retry + the stale auto-refresh),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * True only when a network feed should be opened: the parent has enabled the leaf, the kind is numeric
     * (so a trend line is meaningful), and there is a real vehicle + signal to query. Disabled / non-numeric /
     * unaddressed previews never fire a request (the web "don't fire 600+ requests" intent).
     */
    private val feedWillOpen: Boolean =
        args.enabled && isNumericKind(args.valueKind) && args.vehicleId > 0L && args.signal.isNotBlank()

    /**
     * The projected preview surface as a lifecycle-aware [StateFlow]. Pre-seeded so the first frame is the
     * honest branch — a loading skeleton when a feed will open, otherwise the gated (disabled / non-numeric /
     * empty) state — rather than an artificial blank.
     */
    val state: StateFlow<SignalSparklinePreviewState> =
        refreshTrigger
            .flatMapLatest { resolvedFeed() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = initialState(),
            )

    /** Re-runs the cache-then-network load (the error retry + the stale auto-refresh). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to SIGNAL_SPARKLINE_PREVIEW_SLUG))
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no signal name or value, so a diagnostics line can never leak the vehicle's live state. Call
     * from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSignalSparklinePreviewOpened(logger)
    }

    /** The rendered feed: the signal's trailing-hour history, or the gated state when no feed should open. */
    private fun resolvedFeed(): Flow<SignalSparklinePreviewState> =
        if (feedWillOpen) {
            source.signalHistory(args.vehicleId, args.signal).map { project(it) }
        } else {
            flowOf(project(null))
        }

    /** The pre-collection seed: a loading skeleton when a feed will open, otherwise the gated state. */
    private fun initialState(): SignalSparklinePreviewState =
        if (feedWillOpen) {
            project(Resource.Loading(cached = null, fetchedAt = null, stale = false))
        } else {
            project(null)
        }

    /** Project a feed emission (or the gated `null`) onto the render state via the pure projection. */
    private fun project(resource: Resource<SignalHistoryResponse>?): SignalSparklinePreviewState =
        SignalSparklineProjection.fromResource(args.enabled, args.valueKind, args.signal, resource)

    private companion object {
        /** Keep the upstream alive briefly across config changes / fast re-subscribes. */
        const val STOP_TIMEOUT_MILLIS = 5_000L
        const val EVENT_REFRESH = "signalSparklinePreview.refresh"
        const val FIELD_SURFACE = "surface"
    }
}
