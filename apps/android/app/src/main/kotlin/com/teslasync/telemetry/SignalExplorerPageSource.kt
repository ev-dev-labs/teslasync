// The data seam the SignalExplorerPage telemetry surface binds to, plus its production binding over the shared S7
// signals data port + the app-scoped active-vehicle selection. The view (composable) performs NO HTTP — it only
// collects state from the view-model, which drives this seam, reproducing the web page's one TanStack-Query read
// (`useSignals` for the per-vehicle catalog) plus its `useSelectedVehicle` active-vehicle binding.
//
// Unlike the sibling admin surfaces (which bind to S8 holders already wired into the app DI graph), the Android
// DataContainer wires no signals store and this artifact may not edit it (allowed-files constraint), so the
// view-model OWNS a page-local S8 `SignalsStore` built over the shared `SignalsRepository` this seam exposes — the
// same page-local-store pattern the sibling Diagnostic / Commands / SqlPlayground surfaces document. Exposing the S7
// repository (not a concrete store or the network) keeps the view-model bound to an abstraction: production passes
// the real `HttpSignalsRepository`, tests pass a fake, and the holder's lifecycle stays owned by the view-model
// scope (so it survives configuration changes). The selected vehicle flows from the app-scoped `SelectedVehicleStore`
// the shell's vehicle picker drives (web `useSelectedVehicle`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located production-binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signalexplorer

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.SignalsRepository
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [SignalExplorerPageViewModel] depends on so it binds to an abstraction (the shared signals
 * port + the app-scoped vehicle selection in production, fakes in tests), never to a concrete store or the network.
 *
 * @property signals the S7 data port the view-model builds its page-local S8 `SignalsStore` over (web `useSignals` ⇒
 *   `GET /signals/{vehicleId}/available`). Read-only — the web hook file declares no mutations.
 * @property selectedVehicleId the app-scoped active-vehicle id the shell's picker drives (web `useSelectedVehicle`).
 */
interface SignalExplorerPageSource {
    /** The S7 signals data port (web `useSignals` ⇒ `GET /signals/{vehicleId}/available`). */
    val signals: SignalsRepository

    /** The currently-selected vehicle id, or `null`/0 when none is chosen (web `useSelectedVehicle`). */
    val selectedVehicleId: StateFlow<Long?>

    /** Explicitly selects a vehicle (web `VehicleSelect` onChange ⇒ `setVehicleId`). */
    fun selectVehicle(id: Long)
}

/**
 * Binds the surface to the shared S7 [SignalsRepository] + the app-scoped [SelectedVehicleStore]. The repository is
 * stateless and cache-backed (no scope of its own), so the view-model can build its lifecycle-scoped page-local
 * `SignalsStore` over it and have the holder follow the view-model scope. The selection flows through unchanged so
 * the page renders the no-vehicle empty state until the shell's picker chooses one. No HTTP touches the view.
 */
fun signalExplorerPageSourceOf(
    signalsRepository: SignalsRepository,
    selectedVehicleStore: SelectedVehicleStore,
): SignalExplorerPageSource =
    object : SignalExplorerPageSource {
        override val signals: SignalsRepository = signalsRepository
        override val selectedVehicleId: StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun selectVehicle(id: Long) = selectedVehicleStore.select(id)
    }
