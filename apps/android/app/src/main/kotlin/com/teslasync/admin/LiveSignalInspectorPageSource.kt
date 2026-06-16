// The data seam the LiveSignalInspectorPage admin surface binds to, plus its production binding over the two
// shared S8 holders the page reads. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web page's two TanStack-Query reads (`useVehicles`,
// `useVehicleLiveSignals`).
//
// Both reads are the typed, cache-then-network [Resource] streams the shared S8 holders already expose: the
// vehicle list (`GET /vehicles` ▸ VehiclesStore.vehicles()) backing the picker, and the per-vehicle live
// snapshot (`GET /signals/{id}/live` ▸ TelemetryStore.vehicleLiveSignals(id)) backing the table. [refreshLive]
// is the store's own per-feed re-fetch — the web page's 1 s `refetchInterval` is a render-layer cadence the
// screen drives (a poll while a vehicle is selected + the tab is foreground), so it lives at the call site, not
// here. A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
// concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.livesignals

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [LiveSignalInspectorPageViewModel] depends on so it binds to abstractions (the shared
 * Vehicles + Telemetry holders in production, fakes in tests), never to a concrete store or the network. Both
 * reads are cache-then-network typed `Resource` flows (the web read hooks); [refreshLive] is the store's
 * per-vehicle re-fetch the screen polls. No HTTP touches the view.
 */
interface LiveSignalInspectorSource {
    /** The typed `GET /vehicles` list feed backing the picker (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The typed `GET /signals/{id}/live` snapshot feed for [vehicleId] (web `useVehicleLiveSignals`). */
    fun vehicleLiveSignals(vehicleId: Long): Flow<Resource<VehicleLiveSignalsResponse>>

    /** Re-fetches the live feed for [vehicleId] if observed (web `refetchInterval` poll / error retry). */
    fun refreshLive(vehicleId: Long)
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [TelemetryStore] — the memoized, multi-observer
 * feeds the app shares app-wide. The live values flow through unchanged so the view-model renders the full
 * state matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun liveSignalInspectorSource(
    vehiclesStore: VehiclesStore,
    telemetryStore: TelemetryStore,
): LiveSignalInspectorSource =
    object : LiveSignalInspectorSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun vehicleLiveSignals(vehicleId: Long): Flow<Resource<VehicleLiveSignalsResponse>> =
            telemetryStore.vehicleLiveSignals(vehicleId)

        override fun refreshLive(vehicleId: Long) = telemetryStore.refreshVehicleLiveSignals(vehicleId)
    }
