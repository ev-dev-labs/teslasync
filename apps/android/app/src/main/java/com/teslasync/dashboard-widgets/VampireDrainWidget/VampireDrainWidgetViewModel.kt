// UI-thread-free state holder backing the Compose [VampireDrainWidget] — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/VampireDrainWidget.tsx). It binds the
// injected [VampireDrainSource] (the P1/S8 shared-layer seam) to a lifecycle-aware [UiState] of the
// vampire-drain snapshot via [BaseFeedViewModel.asUiState], covering every state the web widget renders:
// loading (no cache), content, empty (no vehicle / no stats / no events), and — through the ADR-013
// freshness contract — stale / offline (the cached feed stays visible with the staleness + error flags).
// The view stays a thin renderer; it performs no HTTP and owns no business logic (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VampireDrainWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vampiredrain

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [VampireDrainWidget].
 *
 * It consumes the injected cache-then-network [VampireDrainSource] (P1/S8) and re-shares it as a single
 * [UiState] stream (loading / content / empty / stale / offline / error), exposing the single refresh
 * action plus the PII-safe `view.opened` diagnostic. A snapshot whose stats card is absent AND whose events
 * are empty maps to the empty surface (web `hasData` gate → "No vampire drain data").
 *
 * It owns no networking. [refresh] bumps a trigger that restarts a fresh upstream collection (the web
 * `handleRefresh` → `refetch()`), and [onAppear] emits the one-shot `view.opened` diagnostics event with
 * the surface [VampireDrainRegistration.SLUG] (P1/S11) at most once per holder — carrying no drain payload,
 * so a diagnostics line can never leak the vehicle's energy data.
 *
 * @param source the shared cache-then-network vampire-drain seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VampireDrainWidgetViewModel(
    private val source: VampireDrainSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The vampire-drain payload as cache-then-network UI state (no stats + no events → empty). */
    val state: StateFlow<UiState<VampireDrainSnapshot>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState { !it.hasData }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to VampireDrainRegistration.SLUG))
    }

    /** Re-fetches the stats + events (web `handleRefresh`); restarts a fresh cache-then-network collection. */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SURFACE = "surface"
        private const val EVENT_REFRESH = "vampireDrain.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: VampireDrainSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { VampireDrainWidgetViewModel(source, logger) }
            }

        /**
         * Wire the surface from the shared **S8** [EnergyStore] + [VehiclesStore] (P1/S8). An explicit
         * [vehicleId] overrides the first-enrolled-vehicle fallback (web `vehicleId` prop precedence).
         */
        fun create(
            energyStore: EnergyStore,
            vehiclesStore: VehiclesStore,
            logger: Logger,
            vehicleId: Long? = null,
            scope: CoroutineScope? = null,
        ): VampireDrainWidgetViewModel =
            VampireDrainWidgetViewModel(
                source = vampireDrainSource(energyStore, vehiclesStore, vehicleId),
                logger = logger,
                scope = scope,
            )
    }
}
