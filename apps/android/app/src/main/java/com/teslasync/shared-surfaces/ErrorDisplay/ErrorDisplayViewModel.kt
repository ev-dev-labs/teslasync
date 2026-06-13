// UI-thread-free state holder backing the ErrorDisplay banner — the native port of the web component's
// status branching (web/src/components/feedback/ErrorDisplay.tsx). It binds the representative cache-then-
// network feed (P1/S8) through [ErrorDisplaySource], combines each failure emission with the connectivity
// signal (web `useOnlineStatus`), and folds the pair into the PII-free [ErrorSnapshot] the composable
// projects. It exposes the single retry action (web `onRetry` / `query.refetch()`) plus the one-shot
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [snapshot] and calls
// [retry] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ErrorDisplay) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.errordisplay

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose `ErrorDisplay` banner — the Android port of the web `ErrorDisplay` over an
 * `error` + `useOnlineStatus()`.
 *
 * It re-collects the injected [source]'s cache-then-network feed for [vehicleId] (the P1/S8 boundary),
 * combines it with the connectivity flow, projects the pair onto the shared
 * [io.teslasync.android.data.UiState] + online flag, and re-shares the folded [ErrorSnapshot] as a
 * lifecycle-aware [snapshot] flow — so the banner reflects the latest failure without owning any state
 * itself. The snapshot is PII-free: it carries the HTTP status and the transport / offline signals, never the
 * charging rows.
 *
 * [retry] re-runs the cache-then-network load (web `onRetry` / `query.refetch()`) and emits the PII-safe
 * retry diagnostic; [recordViewOpened] emits the P1/S11 `view.opened` event exactly once per surface open.
 *
 * @param source the cache-then-network failure feed + connectivity seam (a shared-data-layer adapter in
 *   production, a fake in tests). The view-model owns no networking — it only projects the feed's failures.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `retry` events.
 * @param vehicleId the vehicle whose feed failures are surfaced (web `useChargingHistory(id)`).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ErrorDisplayViewModel(
    private val source: ErrorDisplaySource,
    logger: Logger,
    private val vehicleId: Long,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the retry affordance), exactly as the
    // shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val retryTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The feed's failure as a lifecycle-aware [ErrorSnapshot]: present / httpStatus / transport / online,
     * carrying no rows. Collected only while the banner is on-screen
     * ([SharingStarted.WhileSubscribed]); the initial value is the no-failure snapshot so the first frame is
     * never an artificial banner.
     */
    val snapshot: StateFlow<ErrorSnapshot> =
        combine(
            retryTrigger.flatMapLatest { source.failures(vehicleId).map { it.toUiState() } },
            source.online(),
        ) { uiState, online -> uiState.toErrorSnapshot(online) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = ErrorSnapshot.none(),
            )

    /** Re-runs the cache-then-network load (the web `onRetry` affordance) and logs the PII-safe diagnostic. */
    fun retry() {
        recordErrorDisplayRetry(logger)
        retryTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no vehicle id / status / failure payload, so a diagnostics line can never leak which
     * feed the user was viewing. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordErrorDisplayOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel for [vehicleId]. */
        fun factory(
            source: ErrorDisplaySource,
            logger: Logger,
            vehicleId: Long,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ErrorDisplayViewModel(source, logger, vehicleId) }
            }
    }
}
