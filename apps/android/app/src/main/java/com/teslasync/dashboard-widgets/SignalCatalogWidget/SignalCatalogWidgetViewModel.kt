// UI-thread-free state holder backing the Compose [SignalCatalogWidget] — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/SignalCatalogWidget.tsx). It binds the
// injected [SignalCatalogSource] (the P1/S8 shared-layer seam) to a lifecycle-aware [UiState] of the
// catalog snapshot via [BaseFeedViewModel.asUiState], covering every state the web widget renders: loading
// (no cache), content, empty (no catalog entries), hard error, and — through the ADR-013 freshness
// contract — stale / offline (the cached catalog stays visible with the staleness + error flags). The
// view stays a thin renderer; it performs no HTTP and owns no business logic (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SignalCatalogWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.signalcatalog

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
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [SignalCatalogWidget].
 *
 * It consumes the injected cache-then-network [SignalCatalogSource] (P1/S8) and re-shares it as a single
 * [UiState] stream (loading / content / empty / stale / offline / error), exposing the refresh + retry
 * actions plus the PII-safe `view.opened` diagnostic. A snapshot whose catalog carried no entries maps to
 * the empty surface (web `entries.length === 0`); the composable further narrows the standard layout to a
 * "No matching signals" empty state when the search filter leaves no rows (web `filtered.length === 0`).
 *
 * It owns no networking. [refresh] re-collects a fresh upstream (the web `refetch()`) and asks the source
 * to re-fetch the catalog + the resolved vehicle's observations, and [onAppear] emits the one-shot
 * `view.opened` diagnostics event with the surface [SignalCatalogRegistration.SLUG] (P1/S11) at most once
 * per holder.
 *
 * @param source the shared cache-then-network catalog + vehicles + observations seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null` defaults to the first
 *   enrolled vehicle for the observation counts.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalCatalogWidgetViewModel(
    private val source: SignalCatalogSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The catalog as cache-then-network UI state (no catalog entries → empty). */
    val state: StateFlow<UiState<SignalCatalogSnapshot>> =
        refreshTrigger
            .flatMapLatest { signalCatalogResource(source, vehicleId) }
            .asUiState { it.isEmpty }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SignalCatalogRegistration.SLUG))
    }

    /**
     * Re-fetches the catalog + the resolved vehicle's observations (web `refetchCatalog()`): re-collects a
     * fresh cache-then-network upstream (so a repository-backed binding re-fetches) and asks the source to
     * bump its store triggers (so a store-backed binding re-fetches). The vehicle id is resolved exactly
     * like the read path (the bound id, else the first enrolled vehicle).
     */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to SignalCatalogRegistration.SLUG))
        refreshTrigger.update { it + 1 }
        launch {
            val id = vehicleId?.takeIf { it > 0L } ?: firstVehicleId(source.vehicles().firstOrNull()?.cached)
            source.refresh(id)
        }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SURFACE = "surface"
        private const val EVENT_REFRESH = "signalCatalog.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: SignalCatalogSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SignalCatalogWidgetViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
