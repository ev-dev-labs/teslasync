// The state holder backing the FleetTelemetryCoveragePage admin surface (P1/S8) — the native counterpart of
// the web page's React state + TanStack-Query hook (web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx).
// It owns the page's lone local interaction (the free-text [filter], web `useState('')`) and projects the
// single cache-then-network read (`/tesla/fleet-telemetry/coverage`) onto the shared lifecycle-aware
// [UiState] surface via [BaseFeedViewModel.asUiState]. All derivation logic lives in the framework-free model
// (FleetTelemetryCoveragePageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.fleettelemetry

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryCoverageResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class FleetTelemetryCoveragePageViewModel(
    private val source: FleetTelemetryCoverageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableFilter = MutableStateFlow("")
    private var viewOpenedRecorded = false

    /** The page's free-text filter over category / field / destination / column (web `filter` `useState`). */
    val filter: StateFlow<String> = mutableFilter.asStateFlow()

    /**
     * The coverage snapshot as cache-then-network UI state (loading / content / empty / stale / offline /
     * error). Empty is the web `categories.length === 0` guard. The shared store self-restarts on
     * [refresh], so re-collection here needs no local trigger.
     */
    val state: StateFlow<UiState<FleetTelemetryCoverageResponse>> =
        source.coverage().asUiState(isEmpty = { it.isEmptyCoverage })

    /** Set the free-text filter (web `setFilter(e.target.value)`). */
    fun setFilter(value: String) {
        mutableFilter.update { value }
    }

    /** Re-fetch the coverage snapshot (the web Refresh button / error retry affordance). */
    fun refresh() {
        logger.info("fleetTelemetryCoverage.refresh")
        source.refresh()
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordCoveragePageOpened(logger)
    }
}
