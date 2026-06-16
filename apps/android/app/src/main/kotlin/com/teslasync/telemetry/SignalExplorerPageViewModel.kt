// The state holder backing the SignalExplorerPage telemetry surface (P1/S8) — the native counterpart of the web
// page's React client state + TanStack-Query read (web/src/features/telemetry/pages/SignalExplorerPage.tsx). It owns
// the page's local interaction state (selected signals + date range + page size + live toggle) as a single immutable
// [SignalExplorerInteraction] snapshot, and projects the one cache-then-network read (`useSignals`) onto the shared
// lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState]. The catalog feed re-collects whenever the
// selected vehicle changes (a new `/signals/{id}/available` read) and is gated on a selected vehicle (web
// `enabled: vehicleId > 0`) so nothing is fetched until the shell's picker chooses one. All derivation logic lives
// in the framework-free model (SignalExplorerPageModel.kt); this holder is the thin orchestration layer and performs
// no HTTP.
//
// Because the Android DI graph wires no signals store and this artifact may not edit it, the holder OWNS a
// page-local S8 [SignalsStore] built over the injected [SignalsRepository] in its own [stateScope] — so the shared
// catalog feed's memoization + cache-then-network lifecycle follow the view-model scope and survive configuration
// changes (the sibling Diagnostic / Commands / SqlPlayground surfaces document the same page-local-store pattern).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signalexplorer

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.signals.AvailableSignalsResponse
import io.teslasync.shared.core.presentation.signals.SignalsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import java.time.LocalDate

/**
 * @param source the P1/S8 data seam (real S7 [io.teslasync.shared.core.data.repo.SignalsRepository] +
 *   [io.teslasync.android.data.SelectedVehicleStore] ↔ test fakes); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `explore` / `live`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param todayEpochDay the clock seam for the default `today` range (web `useRangeState({ defaultPresetId: 'today' })`).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalExplorerPageViewModel(
    private val source: SignalExplorerPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    todayEpochDay: Long = LocalDate.now().toEpochDay(),
) : BaseFeedViewModel(logger, scope) {
    // Page-local S8 holder over the injected S7 port; its memoized feeds follow this view-model's scope.
    private val signalsStore = SignalsStore(source.signals, stateScope)

    private val mutableInteraction =
        MutableStateFlow(SignalExplorerInteraction(startEpochDay = todayEpochDay, endEpochDay = todayEpochDay))
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `useState` group: signals + range + page size + live toggle). */
    val interaction: StateFlow<SignalExplorerInteraction> = mutableInteraction.asStateFlow()

    /** The active-vehicle id the shell's picker drives (web `useSelectedVehicle`); `null`/0 ⇒ no-vehicle panel. */
    val selectedVehicleId: StateFlow<Long?> = source.selectedVehicleId

    /**
     * The per-vehicle signal catalog as cache-then-network UI state (web `useSignals`). Re-collected whenever the
     * selected vehicle changes. Gated on a selected vehicle (web `enabled: vehicleId > 0`): with no vehicle it parks
     * on a no-data loading sentinel the page never shows (it renders the no-vehicle panel instead). The catalog is
     * normalized to the flat `string[]` of names the controls' selector reads, so the four data states map directly:
     * `Loading` ⇒ spinner, empty list ⇒ the selector's empty note, `Success` ⇒ the populated selector, `Error`
     * ⇒ the error banner + retry.
     */
    val signalsState: StateFlow<UiState<List<String>>> =
        source.selectedVehicleId
            .flatMapLatest { id ->
                if (id == null || id <= 0L) {
                    flowOf(Resource.Loading<List<String>>(cached = null, fetchedAt = null, stale = false))
                } else {
                    signalsStore.availableSignals(id).map { it.mapData(AvailableSignalsResponse::toSignalNames) }
                }
            }
            .asUiState(isEmpty = { it.isEmpty() })

    // ── Interaction setters (web client-state setters) ──────────────────────────────────────────────────────────

    /** Replace the ordered signal selection, clamped to the hard cap (web `setSelectedSignals(next.slice(0, MAX))`). */
    fun setSelectedSignals(next: List<String>): Unit = mutableInteraction.update { it.withSignals(next) }

    /** Set the inclusive `[start, end]` window (web `useRangeState.setRange`). */
    fun setRange(
        startEpochDay: Long?,
        endEpochDay: Long?,
    ): Unit = mutableInteraction.update { it.copy(startEpochDay = startEpochDay, endEpochDay = endEpochDay) }

    /** Choose the page size (web `setPerPage` + reset to page 1). */
    fun setPerPage(value: Int): Unit = mutableInteraction.update { it.copy(perPage = value) }

    /** Run the historical query — web `handleExplore`: leave live, latch the results area open. */
    fun explore() {
        logger.info(EVENT_EXPLORE)
        mutableInteraction.update { it.copy(isLive = false, hasExplored = true) }
    }

    /** Toggle the live SSE stream — web `toggleLive`. */
    fun toggleLive() {
        logger.info(EVENT_TOGGLE_LIVE)
        mutableInteraction.update { it.copy(isLive = !it.isLive) }
    }

    /** Select a vehicle (web `VehicleSelect` onChange). */
    fun selectVehicle(id: Long): Unit = source.selectVehicle(id)

    // ── Refresh / retry (web query `refetch` seam) ──────────────────────────────────────────────────────────────

    /** Re-fetch the catalog feed for the current vehicle — the controls' error-retry affordance (web `refetch()`). */
    fun retry() {
        val id = source.selectedVehicleId.value ?: return
        if (id <= 0L) return
        logger.info(EVENT_RETRY)
        signalsStore.refreshAvailableSignals(id)
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSignalExplorerPageOpened(logger)
    }

    private companion object {
        const val EVENT_EXPLORE = "signalExplorer.explore"
        const val EVENT_TOGGLE_LIVE = "signalExplorer.toggleLive"
        const val EVENT_RETRY = "signalExplorer.retry"
    }
}
