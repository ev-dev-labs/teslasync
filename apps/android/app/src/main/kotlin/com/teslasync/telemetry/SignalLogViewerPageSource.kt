// The data seam the SignalLogViewerPage surface binds to, plus its production binding over the shared-core Telemetry
// repository + the app-scoped active-vehicle selection. The view (composable) performs NO HTTP — it only collects
// state from the view-model, which drives this seam, reproducing the web page's reads: `useSignals(vehicleId)`
// (`GET /signals/{id}/available`, the selector catalog) and the deferred per-signal history query
// (`GET /signals/{id}/{sig}/history?from=&to=`, the web `request()` fan-out), scoped to the global `useSelectedVehicle`
// selection.
//
// Both reads are shared-core cache-then-network `Resource` streams the S7 [TelemetryRepository] already exposes
// (`signals` ▸ the available-signal names, `signalDiff` ▸ the `from`/`to`-windowed history the web `useSignalDiff`
// declares — the same endpoint + query the web page's raw `request()` hits). The Android DI graph
// ([io.teslasync.android.data.DataContainer]) wires no TelemetryStore yet, so the host constructs the shared
// [io.teslasync.shared.core.data.repo.HttpTelemetryRepository] over the SAME resilient client + offline cache the other
// repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical) and hands it in here —
// exactly as the sibling telemetry/SignalGapDetectorPage surface does. A narrow seam so the view-model depends on an
// abstraction (real adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signallogviewer

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [SignalLogViewerPageViewModel] depends on so it binds to an abstraction (the shared telemetry
 * repository + the app-scoped selection in production, fakes in tests), never to a concrete repository or the network.
 * The available-signals catalog is a cache-then-network `Resource` feed (the web `useSignals` read); the per-signal
 * history is the deferred `from`/`to`-windowed read the page fans out on Query (web `useSignalDiff` endpoint); the
 * selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface SignalLogViewerPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** The cache-then-network `GET /signals/{vehicleId}/available` catalog feed (web `useSignals`). */
    fun signals(vehicleId: Long): Flow<Resource<List<String>>>

    /**
     * The cache-then-network `GET /signals/{vehicleId}/{signal}/history?from=&to=` feed for one selected signal over
     * the `[from, to]` ISO window (web `useSignalDiff` endpoint — the page's deferred per-signal `request()` fan-out).
     */
    fun signalHistory(
        vehicleId: Long,
        signal: String,
        from: String,
        to: String,
    ): Flow<Resource<SignalHistoryResponse>>
}

/**
 * Binds the surface to the shared **S7** [TelemetryRepository] + the app-scoped [SelectedVehicleStore] — the memoized
 * cache-then-network feeds the signal-inspector surfaces share, scoped to the active vehicle. The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale /
 * offline). No HTTP touches the view.
 */
fun signalLogViewerPageSourceOf(
    telemetryRepository: TelemetryRepository,
    selectedVehicleStore: SelectedVehicleStore,
): SignalLogViewerPageSource =
    object : SignalLogViewerPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun signals(vehicleId: Long): Flow<Resource<List<String>>> = telemetryRepository.signals(vehicleId)

        override fun signalHistory(
            vehicleId: Long,
            signal: String,
            from: String,
            to: String,
        ): Flow<Resource<SignalHistoryResponse>> = telemetryRepository.signalDiff(vehicleId, signal, from, to)
    }
