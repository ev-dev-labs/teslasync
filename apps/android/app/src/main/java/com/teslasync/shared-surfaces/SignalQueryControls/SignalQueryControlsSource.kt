// The data seam the SignalQueryControls surface binds to for the available-signals list its multi-select reads
// — the native analogue of the web `SignalMultiSelect`'s only `useQuery`
// (web/src/components/SignalQueryControls.tsx: `request<string[]>('/signals/available?vehicle_id={id}')`). The
// view (composable) performs NO HTTP — it only collects state from the [SignalQueryControlsViewModel], which
// drives this seam (ADR-002), satisfying the "no direct HTTP from the view" contract. A concrete adapter over
// the shared Telemetry layer — the S8 [TelemetryStore] for the shared, multi-observer feed every telemetry
// screen already shares, or the S7 [TelemetryRepository] for the cold cache-then-network flow a manual retry
// re-collects — backs it in production; a test fake backs it in unit tests. Mirrors the dual-adapter shape of
// the sibling VehicleMultiSelect / SignalCatalogWidget surfaces.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SignalQueryControls) cannot form a valid Kotlin package.
// `MatchingDeclarationName` and the ktlint filename rule are suppressed: the mandated `SignalQueryControls*`
// filename hosts the seam interface plus its co-located extension adapters.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.signalquerycontrols

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [SignalQueryControlsViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never a concrete client — the Android counterpart of the web `useSignals` read behind the
 * surface's multi-select. The `GET /signals/{vehicleId}/available` list is carried as the normalized signal
 * names the backend serves. No HTTP touches the view.
 */
fun interface SignalQueryControlsSource {
    /** Cache-then-network `GET /signals/{vehicleId}/available` signal-name feed (web `useSignals`). */
    fun availableSignals(vehicleId: Long): Flow<Resource<List<String>>>
}

/**
 * Binds the surface to the shared **S8** [TelemetryStore] — the memoized, multi-observer available-signals
 * feed every telemetry screen shares, so the same list (and its background refreshes) drives this picker too.
 * No HTTP touches the view.
 */
fun TelemetryStore.asSignalQueryControlsSource(): SignalQueryControlsSource {
    val store = this
    return SignalQueryControlsSource { vehicleId -> store.signals(vehicleId) }
}

/**
 * Binds the surface to the shared **S7** [TelemetryRepository] — the cold cache-then-network `Flow`.
 * Re-collecting it performs a genuine cache-then-network re-fetch, which backs the surface's manual refresh /
 * error-retry affordance when no shared [TelemetryStore] is in scope. No HTTP touches the view.
 */
fun TelemetryRepository.asSignalQueryControlsSource(): SignalQueryControlsSource {
    val repo = this
    return SignalQueryControlsSource { vehicleId -> repo.signals(vehicleId) }
}
