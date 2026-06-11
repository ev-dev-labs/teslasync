// The data port the Signal Log widget binds to — the native analogue of the four web hooks the component
// composes: `useVehicles` (to resolve the default vehicle — web `vehicles?.[0]?.id`), `useSignalObservations`
// (the rendered observation feed), and `useMQTTStatus` (the signals/sec rate the compact hero shows). See
// web/src/features/dashboard/widgets/SignalLogWidget.tsx + web/src/api/hooks/useTelemetry.ts +
// web/src/api/hooks/useVehicles.ts. The view never performs HTTP; a concrete adapter over the shared
// Vehicles + Telemetry data layers (or a test fake) drives this seam. Cache-then-network freshness is
// preserved end to end (ADR-013): the view-model projects each emission's cached / stale / error flags onto
// the render surface, and the observations arrive already adapted + SI from the shared layer.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SignalLogWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.signallog

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalObservationsParams
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * Streams the three cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`), the
 * per-vehicle [signalObservations] feed the grid renders, and the fleet-wide [mqttStatus] whose summed
 * `signalsPerSecond` drives the compact hero. A narrow seam so the view-model depends on an abstraction
 * (real adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface SignalLogSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /signals/observations?…` adapted feed (web `useSignalObservations`). */
    fun signalObservations(params: SignalObservationsParams): Flow<Resource<List<SignalObservation>>>

    /** The cache-then-network normalized MQTT status feed (`GET /telemetry`, web `useMQTTStatus`). */
    fun mqttStatus(): Flow<Resource<TelemetryStatus>>
}

/**
 * Binds the widget to the shared **S7** [VehiclesRepository] + [TelemetryRepository] — the cold
 * cache-then-network `Flow`s the S8 stores also wrap. Re-collecting any feed performs a genuine
 * cache-then-network re-fetch, which is what backs the widget's manual refresh / error-retry affordance
 * (the web `refetch()`). No HTTP touches the view.
 */
fun signalLogSource(
    vehicles: VehiclesRepository,
    telemetry: TelemetryRepository,
): SignalLogSource =
    object : SignalLogSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun signalObservations(params: SignalObservationsParams): Flow<Resource<List<SignalObservation>>> =
            telemetry.signalObservations(params)

        override fun mqttStatus(): Flow<Resource<TelemetryStatus>> = telemetry.mqttStatus()
    }

/**
 * Binds the widget to the shared **S8** [VehiclesStore] + [TelemetryStore] — the memoized, multi-observer
 * feeds every Vehicles / Telemetry surface shares (incl. the telemetry store's REALTIME-cadence background
 * refresh). Use this when a host wants the widget to fold into the same shared collections as the rest of
 * the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun signalLogSource(
    vehicles: VehiclesStore,
    telemetry: TelemetryStore,
): SignalLogSource =
    object : SignalLogSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun signalObservations(params: SignalObservationsParams): Flow<Resource<List<SignalObservation>>> =
            telemetry.signalObservations(params)

        override fun mqttStatus(): Flow<Resource<TelemetryStatus>> = telemetry.mqttStatus()
    }
