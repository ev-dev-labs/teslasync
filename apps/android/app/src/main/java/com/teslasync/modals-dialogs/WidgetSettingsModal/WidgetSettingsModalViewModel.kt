// UI-thread-free state holder backing the WidgetSettingsModal surface — the native port of the web component's only
// data hook (web/src/features/dashboard/components/WidgetSettingsModal.tsx: `useVehicles`). It binds the shared
// enrolled-vehicle feed (P1/S8) through [WidgetSettingsVehiclesSource], projects each cache-then-network emission onto
// the shared [UiState] surface (loading / content / empty / stale / offline / error) for the vehicle dropdown, exposes
// the single refresh action backing the dropdown's retry affordance, and emits the PII-safe `view.opened` diagnostic.
// The view never performs HTTP — it only collects [vehicles] and calls [refresh] / [recordViewOpened]. The edited
// widget config is local Compose state owned by the screen (web `useState`), exactly as the web hook composition keeps
// it, so it is intentionally NOT mirrored here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/WidgetSettingsModal) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.widgetsettingsmodal

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [WidgetSettingsModal]. It keeps the screen a stateless dialog that
 * renders + gathers input: the working config lives in the composable (web `useState`), while this holder owns the one
 * part the web hooks owned — the `useVehicles` feed projected onto the dropdown's render surface.
 *
 * It owns no networking — it only projects the [source] feed. [vehicles] re-shares the cache-then-network feed as a
 * lifecycle-aware [UiState]; [refresh] re-collects it (the dropdown's offline/error retry, web `refetch`);
 * [recordViewOpened] emits the one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the enrolled-vehicle read seam (the S8 [io.teslasync.shared.core.presentation.vehicles.VehiclesStore]
 *   binding in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WidgetSettingsModalViewModel(
    source: WidgetSettingsVehiclesSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the dropdown's retry affordance), exactly as the
    // web `useVehicles` query re-runs on invalidation.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The enrolled-vehicle feed as a lifecycle-aware [UiState]: loading (first open, no cache) / content / empty (no
     * enrolled vehicles) / stale / offline (cached after a failed refresh) / error (no cache), carrying the freshness
     * stamp + error kind. The composable folds [UiState.data] into the dropdown options; the "all vehicles" sentinel
     * is always offered regardless of phase, so the control stays usable while the list loads or fails.
     */
    val vehicles: StateFlow<UiState<List<Vehicle>>> =
        refreshTrigger
            .flatMapLatest { source.vehicles() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Re-runs the cache-then-network vehicle load (the dropdown's offline/error retry affordance). */
    fun refresh() {
        logger.info("widgetSettings.refreshVehicles")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no widget id or config value. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordWidgetSettingsModalOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: WidgetSettingsVehiclesSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { WidgetSettingsModalViewModel(source, logger) }
            }
    }
}
