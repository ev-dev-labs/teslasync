// UI-thread-free state holder backing the PollingEngine surface — the native port of the two `useQuery`
// reads the web component composes (web/src/components/data-display/PollingEngine.tsx → `getPollingStatus` +
// `getPollingSavings`). It binds both shared cache-then-network feeds through [PollingEngineSource] and
// performs no HTTP itself (ADR-002): the view collects [status] + [savings] and folds them through the pure
// [PollingProjection]. Each feed's cache-then-network lifecycle drives the surface's loading / stale /
// offline / error states.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PollingEngine) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pollingengine

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder for the PollingEngine surface.
 *
 * The two feeds are re-shared as lifecycle-aware [UiState] streams so the composable can switch surfaces —
 * loading (first status fetch), content/empty (the vehicle list vs the "no vehicles" hint), a hard error with
 * retry, and the stale/offline freshness envelope — without re-deriving the cache-then-network contract.
 * [refresh]/[retry] re-collect both feeds (web `refetch`), and [onViewOpened] emits the one PII-safe
 * `view.opened` diagnostic (P1/S11) — slug only, never a VIN, value, or cost figure.
 *
 * @param source the polling feeds seam (a host-wired shared-feed adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PollingEngineViewModel(
    private val source: PollingEngineSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The adaptive-polling engine state as lifecycle-aware [UiState]. Structural emptiness is decided by the
     * projection (an enabled engine with no vehicles), not by this feed, so a disabled engine still flows
     * through as content for the gate to resolve.
     */
    val status: StateFlow<UiState<PollingStatusData>> =
        refreshTrigger
            .flatMapLatest { source.status() }
            .asUiState(isEmpty = { false })

    /** The cost snapshot as lifecycle-aware [UiState]; the savings card renders whenever this has any value. */
    val savings: StateFlow<UiState<PollingSavingsData>> =
        refreshTrigger
            .flatMapLatest { source.savings() }
            .asUiState(isEmpty = { false })

    /** Re-fetches both feeds after a hard error (web `refetch`); backs the retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches both feeds; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no VIN, vehicle id, or cost figure. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, surfaceField)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to PollingEngineRegistration.SLUG)

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "pollingEngine.refresh"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: PollingEngineSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { PollingEngineViewModel(source, logger) }
            }
    }
}
