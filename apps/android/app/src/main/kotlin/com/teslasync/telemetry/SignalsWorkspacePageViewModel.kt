// UI-thread-free state holder backing the SignalsWorkspacePage telemetry surface — the native port of the data
// the web page orchestrates (web/src/features/telemetry/pages/SignalsWorkspacePage.tsx): the global
// `useSelectedVehicle()` scope, the `useSignals` available-signal catalog, the `usePinned` / `useTogglePin`
// signal-diff pin store, the `useSignalDiffServer` two-snapshot diff, and the historical `useQuery` that fans a
// bounded set of `/signals/{id}/{signal}/history` reads out and folds them back into one time-ordered series.
//
// It binds the shared P1/S8 holders — the app-scoped [SelectedVehicleStore] (selection, self-healed to the
// first vehicle like the web hook), the [PinnedStore] (web `usePinned`/`useTogglePin`), and a page-local
// [TelemetryStore] built over the injected [TelemetryRepository] (the Android DI graph wires no TelemetryStore
// yet — the SignalGapDetectorPage precedent) — and projects each feed onto a lifecycle-aware [UiState] so the
// composable stays a thin render layer with honest loading / empty / error / content states (ADR-002/013). The
// view performs no HTTP; it only collects these flows and calls [togglePin] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) cannot
// form the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")
@file:OptIn(ExperimentalCoroutinesApi::class)

package io.teslasync.android.telemetry.signalsworkspace

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.signalquerycontrols.SignalLogEntry
import io.teslasync.android.sharedsurfaces.signalquerycontrols.adaptSignalHistoryResp
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import io.teslasync.shared.core.presentation.pinned.PinnedStore
import io.teslasync.shared.core.presentation.telemetry.SignalDiffServerResponse
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryResponse
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose [SignalsWorkspacePage]. It exposes the four manifest data sources the page
 * binds — the available-signal catalog ([signals], web `useSignals`), the unified signal-diff pins ([pinned] +
 * [togglePin], web `usePinned` / `useTogglePin`), and the on-demand server diff ([diffState], web
 * `useSignalDiffServer`) — plus the historical query ([historyState], the web manual-Run `useQuery`) and the
 * resolved active-vehicle scope ([selectedVehicleId], web `useSelectedVehicle`). The selection self-heals from
 * the live fleet so the page defaults to the first vehicle.
 *
 * @param telemetryRepository the shared S7 Telemetry data port; wrapped in a page-local [TelemetryStore].
 * @param pinnedStore the shared S8 unified-pin holder (web `usePinned` / `useTogglePin`).
 * @param selectedVehicleStore the shared active-vehicle selection holder (web `useSelectedVehicle`).
 * @param vehiclesStore the shared enrolled-fleet holder, read only to self-heal the selection.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the one-shot `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class SignalsWorkspacePageViewModel(
    telemetryRepository: TelemetryRepository,
    private val pinnedStore: PinnedStore,
    private val selectedVehicleStore: SelectedVehicleStore,
    private val vehiclesStore: VehiclesStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val telemetryStore = TelemetryStore(telemetryRepository, stateScope)
    private var viewOpenedRecorded = false

    /** The resolved active-vehicle scope (web `useSelectedVehicle`); `null` when none is selected. */
    val selectedVehicleId: StateFlow<Long?> = selectedVehicleStore.selectedId

    /**
     * The available-signal catalog for the selected vehicle (web `useSignals`). Drives the catalog selector,
     * the `signalsCsv` diff narrowing, and the error banner. Resolves to an empty success when no vehicle is
     * selected so the surface never spins (web disabled query).
     */
    val signals: StateFlow<UiState<List<String>>> =
        selectedVehicleStore.selectedId
            .flatMapLatest { id ->
                if (id != null && id > 0L) telemetryStore.signals(id) else flowOf(emptySuccess())
            }
            .asUiState { it.isEmpty() }

    /**
     * The unified signal-diff pin rows for the selected vehicle (web `usePinned('widget', pinContext)`). Drives
     * the "Pinned signals" / "Pinned" StatCards, the pinned chips, and the bulk pin/unpin state.
     */
    val pinned: StateFlow<UiState<List<PinnedItem>>> =
        selectedVehicleStore.selectedId
            .flatMapLatest { id ->
                if (id != null && id > 0L) {
                    pinnedStore.pinned(PinnedItemType.Widget, signalDiffPinContext(id))
                } else {
                    flowOf(emptyPinnedSuccess())
                }
            }
            .asUiState { it.isEmpty() }

    /**
     * The two-snapshot server diff for the given window (web `useSignalDiffServer`). The caller opens it only
     * when Compare mode is active and the window is fully specified (web `enabled`), and remembers the returned
     * flow against its params so recomposition reuses the same shared collection.
     */
    fun diffState(
        vehicleId: Long,
        atA: String,
        atB: String,
        signalsCsv: String,
    ): StateFlow<UiState<SignalDiffServerResponse>> =
        telemetryStore.signalDiffServer(vehicleId, atA, atB, signalsCsv).asUiState { it.data.isEmpty() }

    /**
     * The historical multi-signal series (the web manual-Run `useQuery`): one cache-then-network
     * `/signals/{id}/{signal}/history` read per selected signal, each adapted to [SignalLogEntry]s and folded
     * into one newest-first list. Resolves to an empty state with no vehicle or no selection (web `enabled`).
     * The caller remembers the returned flow against its params.
     */
    fun historyState(
        vehicleId: Long,
        selectedSignals: List<String>,
        hours: Int,
    ): StateFlow<UiState<List<SignalLogEntry>>> {
        if (vehicleId <= 0L || selectedSignals.isEmpty()) {
            return MutableStateFlow(UiState(UiPhase.Empty, emptyList()))
        }
        val feeds = selectedSignals.map { telemetryStore.signalHistory(vehicleId, it, hours) }
        return combine(feeds) { resources -> combineHistory(resources.toList()) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), UiState.loading())
    }

    /**
     * Pins or unpins a single signal in the vehicle's signal-diff bucket (web `useTogglePin`), refreshing every
     * pin feed on success. A non-positive vehicle id is a no-op (no bucket to scope to).
     */
    fun togglePin(
        vehicleId: Long,
        signalName: String,
        pin: Boolean,
    ) {
        if (vehicleId <= 0L) return
        launch {
            pinnedStore.togglePin(
                type = PinnedItemType.Widget,
                itemId = signalPinItemId(signalName),
                pin = pin,
                context = signalDiffPinContext(vehicleId),
            )
        }
    }

    /** Records the one-shot PII-safe `view.opened` diagnostic (P1/S11), at most once per holder. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSignalsWorkspacePageOpened(logger)
    }

    init {
        // Default-to-first: self-heal the app-wide selection from the live list (web `useSelectedVehicle`).
        launch {
            vehiclesStore.vehicles().collect { resource ->
                resource.cached?.let { list -> selectedVehicleStore.reconcile(list.map(Vehicle::id)) }
            }
        }
    }

    /** Folds the per-signal history resources into one [UiState], honest about loading / empty / error. */
    private fun combineHistory(resources: List<Resource<SignalHistoryResponse>>): UiState<List<SignalLogEntry>> {
        val perSignal = resources.map { adaptSignalHistoryResp(it.cached) }
        val merged = mergeHistoryRows(perSignal)
        val anyLoading = resources.any { it is Resource.Loading }
        val anyCached = resources.any { it.cached != null }
        val allError = resources.isNotEmpty() && resources.all { it is Resource.Error }
        val anyError = resources.any { it is Resource.Error }
        val stale = resources.any { it.stale }
        return when {
            !anyCached && anyLoading -> UiState.loading()
            !anyCached && allError -> UiState(UiPhase.Error, errorKind = ErrorKind.Unknown)
            merged.isEmpty() -> UiState(UiPhase.Empty, emptyList(), stale = stale, refreshing = anyLoading)
            else ->
                UiState(
                    phase = UiPhase.Content,
                    data = merged,
                    stale = stale,
                    refreshing = anyLoading,
                    errorKind = if (anyError) ErrorKind.Unknown else null,
                )
        }
    }

    private companion object {
        fun emptySuccess(): Resource<List<String>> = Resource.Success(emptyList(), 0L, false)

        fun emptyPinnedSuccess(): Resource<List<PinnedItem>> = Resource.Success(emptyList(), 0L, false)
    }

    /** A [ViewModelProvider.Factory] the host uses to construct this surface's ViewModel through `viewModel(…)`. */
    object Factory {
        fun create(
            telemetryRepository: TelemetryRepository,
            pinnedStore: PinnedStore,
            selectedVehicleStore: SelectedVehicleStore,
            vehiclesStore: VehiclesStore,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    SignalsWorkspacePageViewModel(
                        telemetryRepository = telemetryRepository,
                        pinnedStore = pinnedStore,
                        selectedVehicleStore = selectedVehicleStore,
                        vehiclesStore = vehiclesStore,
                        logger = logger,
                    )
                }
            }
    }
}
