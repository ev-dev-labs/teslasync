// The data seam the PowersharePage surface binds to, plus its production binding over the shared-core telemetry
// repository and the app-scoped active-vehicle selection. The view (composable) performs NO HTTP — it only
// collects state from the view-model, which drives this seam, reproducing the web page's five reads
// (`useSignalObservations(vehicleId, { signal_name, limit: 1 })` for PowershareStatus / PowershareType /
// PowershareStopReason / PowershareHoursLeft / PowershareInstantaneousPowerKW) and the global `useSelectedVehicle`
// scope.
//
// Each observation feed is the shared-core cache-then-network `Resource` stream the S7 [TelemetryRepository]
// already exposes (`GET /signals/observations?vehicle_id&field&limit` ▸ `signalObservations`). The Android DI
// graph ([io.teslasync.android.data.DataContainer]) wires no TelemetryStore yet, so the host constructs the
// shared [io.teslasync.shared.core.data.repo.HttpTelemetryRepository] over the SAME resilient client + offline
// cache the other repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical) and
// hands it in here. A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never
// on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located binding + fold helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.charging.powershare

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalObservationsParams
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine

/**
 * The single seam the [PowersharePageViewModel] depends on so it binds to an abstraction (the shared telemetry
 * repository + the app-scoped selection in production, a fake in tests), never to a concrete repository or the
 * network. Each observation feed is a cache-then-network `Resource` flow (the web read hook); the selection is
 * the global active-vehicle scope. No HTTP touches the view.
 */
interface PowersharePageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /**
     * The cache-then-network latest-1 `GET /signals/observations` feed for [vehicleId] filtered to [signalName]
     * (web `useSignalObservations(vehicleId, { signal_name, limit: 1 })`).
     */
    fun observation(
        vehicleId: Long,
        signalName: String,
    ): Flow<Resource<List<SignalObservation>>>
}

/**
 * Binds the surface to the shared **S7** [TelemetryRepository] + the app-scoped [SelectedVehicleStore] — the
 * memoized cache-then-network observation feed every telemetry surface shares, scoped to the active vehicle. The
 * live values flow through unchanged so the view-model renders the full state matrix (loading / content / empty /
 * error / stale / offline). No HTTP touches the view.
 */
fun powersharePageSourceOf(
    telemetryRepository: TelemetryRepository,
    selectedVehicleStore: SelectedVehicleStore,
): PowersharePageSource =
    object : PowersharePageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun observation(
            vehicleId: Long,
            signalName: String,
        ): Flow<Resource<List<SignalObservation>>> =
            telemetryRepository.signalObservations(
                SignalObservationsParams(
                    vehicleId = vehicleId,
                    signalName = signalName,
                    limit = PowershareSignals.OBSERVATION_LIMIT,
                ),
            )
    }

/**
 * Combines the five per-signal observation feeds for [vehicleId] into one cache-then-network
 * [Resource]<[PowershareReadings]> stream — the native port of the web component's five concurrent
 * `useSignalObservations` queries folded into its single `hasData` snapshot. The framework-free
 * [combinePowershareReadings] owns the fold (best-available values + aggregate phase), so this seam only wires
 * the five flows together; [observationFor] is [PowersharePageSource.observation] in production, a fake in tests.
 */
internal fun powershareReadingsResource(
    vehicleId: Long,
    observationFor: (Long, String) -> Flow<Resource<List<SignalObservation>>>,
): Flow<Resource<PowershareReadings>> =
    combine(
        observationFor(vehicleId, PowershareSignals.STATUS),
        observationFor(vehicleId, PowershareSignals.TYPE),
        observationFor(vehicleId, PowershareSignals.STOP_REASON),
        observationFor(vehicleId, PowershareSignals.HOURS_LEFT),
        observationFor(vehicleId, PowershareSignals.INSTANTANEOUS_POWER_KW),
    ) { status, type, stop, hours, power ->
        combinePowershareReadings(status, type, stop, hours, power)
    }
