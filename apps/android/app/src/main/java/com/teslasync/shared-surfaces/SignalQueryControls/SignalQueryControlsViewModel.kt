// UI-thread-free state holder backing the SignalQueryControls surface — the native port of the web
// `SignalMultiSelect`'s `useSignals` read (web/src/components/SignalQueryControls.tsx). It binds the shared
// available-signals feed through [SignalQueryControlsSource] and performs no HTTP itself (ADR-002): the view
// collects [availableSignals] and folds it through the pure [SignalQueryControlsProjection]. The available-
// signals feed is the genuine async dependency the toolkit resolves, so its cache-then-network lifecycle
// drives the surface's loading / content / empty / error / stale / offline states. The query state itself
// (selected signals, From/To range, page size, the loaded page of rows) stays controlled by the host (the web
// pages own the server-side query), so it is intentionally NOT owned here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SignalQueryControls) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.signalquerycontrols

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder for the SignalQueryControls surface.
 *
 * The available-signals feed is re-shared as a lifecycle-aware [UiState] so the composable can switch the
 * picker surface — loading (first fetch), content (the chips + multi-select), empty (the resolved-but-no-
 * signals note), a hard error with retry, and the stale/offline freshness envelope — without re-deriving the
 * cache-then-network contract. [retry]/[refresh] re-collect the feed (web `useSignals` refetch), and
 * [onViewOpened] emits the one PII-safe `view.opened` diagnostic (P1/S11) — slug only, never a vehicle id or
 * any signal name (which can fingerprint a vehicle's capabilities).
 *
 * @param source the available-signals seam (a shared-store/-repository adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param vehicleId the vehicle whose available signals the picker lists (web `vehicleId` prop).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalQueryControlsViewModel(
    private val source: SignalQueryControlsSource,
    logger: Logger,
    private val vehicleId: Long,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The available signal names as lifecycle-aware [UiState]; a feed with no signals is structurally empty. */
    val availableSignals: StateFlow<UiState<List<String>>> =
        refreshTrigger
            .flatMapLatest { source.availableSignals(vehicleId) }
            .asUiState { it.isEmpty() }

    /** Re-fetches the available-signals feed after a hard error (web `refetch`); backs the retry affordance. */
    fun retry() {
        logger.info(
            SignalQueryControlsRegistration.EVENT_REFRESH,
            mapOf(SignalQueryControlsRegistration.SURFACE_KEY to SignalQueryControlsRegistration.SLUG),
        )
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the available-signals feed; backs the stale freshness chip's silent auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id and no signal names. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(
            SignalQueryControlsRegistration.EVENT_VIEW_OPENED,
            mapOf(SignalQueryControlsRegistration.SURFACE_KEY to SignalQueryControlsRegistration.SLUG),
        )
    }

    companion object {
        /** Wires the surface from the shared **S8** [TelemetryStore] available-signals feed (web `useSignals`). */
        fun create(
            telemetryStore: TelemetryStore,
            logger: Logger,
            vehicleId: Long,
        ): SignalQueryControlsViewModel = SignalQueryControlsViewModel(telemetryStore.asSignalQueryControlsSource(), logger, vehicleId)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: SignalQueryControlsSource,
            logger: Logger,
            vehicleId: Long,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SignalQueryControlsViewModel(source, logger, vehicleId) }
            }
    }
}
