// UI-thread-free state holder backing the Compose [TirePressureHistoryWidget] — the native port of the
// web component's hook composition (web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx). It
// binds the injected [TirePressureHistorySource] (the P1/S8 shared-layer seam) to a lifecycle-aware
// [UiState] of the tire-pressure-history snapshot via [BaseFeedViewModel.asUiState], covering every state
// the web widget renders: loading (no cache), content, empty (no vehicle / no rows), hard error, and —
// through the ADR-013 freshness contract — stale / offline (the cached chart stays visible with the
// staleness + error flags). The view stays a thin renderer; it performs no HTTP and owns no business
// logic (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/TirePressureHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.tirepressurehistory

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
 * State holder backing the Compose [TirePressureHistoryWidget].
 *
 * It consumes the injected cache-then-network [TirePressureHistorySource] (P1/S8) and re-shares it as a
 * single [UiState] stream (loading / content / empty / stale / offline / error), exposing the single
 * refresh action plus the PII-safe `view.opened` diagnostic. A snapshot whose response carried no
 * timestamp-bearing rows maps to the empty surface, mirroring the web `hasData = chartData.length > 0`
 * gate (and the web disabled-query sentinel when no vehicle resolves).
 *
 * It owns no networking. [refresh] bumps a trigger that restarts a fresh upstream collection (the web
 * `refetch()`), and [onAppear] emits the one-shot `view.opened` diagnostics event with the surface
 * [TirePressureHistoryRegistration.SLUG] (P1/S11) at most once per holder. The diagnostic carries no
 * pressure figure, vehicle id, or location, so a diagnostics line can never leak the owner's vehicle.
 *
 * @param source the shared cache-then-network tire-pressure-history seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TirePressureHistoryWidgetViewModel(
    private val source: TirePressureHistorySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The recent tire-pressure history as cache-then-network UI state (no rows → empty). */
    val state: StateFlow<UiState<TirePressureHistorySnapshot>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState { !it.hasData }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to TirePressureHistoryRegistration.SLUG))
    }

    /** Re-fetches the tire-pressure history (web `refetch()`); restarts a fresh cache-then-network collection. */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SURFACE = "surface"
        private const val EVENT_REFRESH = "tirePressureHistory.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: TirePressureHistorySource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TirePressureHistoryWidgetViewModel(source, logger) }
            }
    }
}
