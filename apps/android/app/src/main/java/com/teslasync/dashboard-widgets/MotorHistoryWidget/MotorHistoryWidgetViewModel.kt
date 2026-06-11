// UI-thread-free state holder backing the Compose [MotorHistoryWidget] — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/MotorHistoryWidget.tsx). It binds the
// injected [MotorHistorySource] (the P1/S8 shared-layer seam) to a lifecycle-aware [UiState] of the
// motor-history snapshot via [BaseFeedViewModel.asUiState], covering every state the web widget renders:
// loading (no cache), content, empty (no vehicle / no samples), hard error, and — through the ADR-013
// freshness contract — stale / offline (the cached chart stays visible with the staleness + error
// flags). The view stays a thin renderer; it performs no HTTP and owns no business logic (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MotorHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.motorhistory

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
 * State holder backing the Compose [MotorHistoryWidget].
 *
 * It consumes the injected cache-then-network [MotorHistorySource] (P1/S8) and re-shares it as a single
 * [UiState] stream (loading / content / empty / stale / offline / error), exposing the single refresh
 * action plus the PII-safe `view.opened` diagnostic. A snapshot whose response carried no rows maps to
 * the empty surface; the composable further narrows to the empty state when no row yields a chartable
 * sample, mirroring the web `hasData = chartData.length > 0` gate.
 *
 * It owns no networking. [refresh] bumps a trigger that restarts a fresh upstream collection (the web
 * `refetch()`), and [onAppear] emits the one-shot `view.opened` diagnostics event with the surface
 * [MotorHistoryRegistration.SLUG] (P1/S11) at most once per holder.
 *
 * @param source the shared cache-then-network motor-history seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MotorHistoryWidgetViewModel(
    private val source: MotorHistorySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The recent motor history as cache-then-network UI state (no samples → empty). */
    val state: StateFlow<UiState<MotorHistorySnapshot>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState { !it.hasRows }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to MotorHistoryRegistration.SLUG))
    }

    /** Re-fetches the motor history (web `refetch()`); restarts a fresh cache-then-network collection. */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SURFACE = "surface"
        private const val EVENT_REFRESH = "motorHistory.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: MotorHistorySource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { MotorHistoryWidgetViewModel(source, logger) }
            }
    }
}
