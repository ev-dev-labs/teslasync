// File hosts the LiveSignalSparklines data seam, its shared-store binding and the cache-then-network
// adapter that composes the fleet list with the active vehicle's available-signal catalog, live values and
// per-signal trailing-hour history; named after the surface bundle (LiveSignalSparklinesWidget*) rather
// than the single interface it declares.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.livesignalsparklines

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.signals.AvailableSignalsResponse
import io.teslasync.shared.core.presentation.signals.LiveSignalsResponse
import io.teslasync.shared.core.presentation.signals.SignalHistoryRange
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * The data port the [LiveSignalSparklinesWidgetViewModel] binds to — the Android analogue of the web
 * `LiveSignalSparklinesWidget`'s hook composition (`useVehicles` + `useSignals` + `useSignalGaps` +
 * per-row `useSignalHistory`) and the P1/S8 state-holder boundary. The view never performs HTTP itself; a
 * test fake stands in for the whole domain.
 *
 * [vehicles] resolves the default active vehicle (web `vehicles?.[0]?.id`); [availableSignals] is the
 * catalog the configured-signal set is intersected against (web `useSignals`); [liveSignals] is the
 * realtime current-value feed driving the freshness header + each row's value (web `useSignalGaps`); and
 * [signalHistory] is one signal's trailing-hour series backing its sparkline + trend (web
 * `useSignalHistory(id, signal, 1)`). [refresh] re-fetches the realtime + catalog feeds (web `refetch()`).
 */
interface LiveSignalSparklinesSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream a vehicle's available-signal catalog (web `useSignals` → `/signals/{id}/available`). */
    fun availableSignals(vehicleId: Long): Flow<Resource<AvailableSignalsResponse>>

    /** Stream a vehicle's realtime current-value feed (web `useSignalGaps` → `/signals/{id}/live`). */
    fun liveSignals(vehicleId: Long): Flow<Resource<LiveSignalsResponse>>

    /** Stream one signal's trailing-hour history (web `useSignalHistory(id, signal, 1)`). */
    fun signalHistory(
        vehicleId: Long,
        signalName: String,
    ): Flow<Resource<SignalHistoryResponse>>

    /** Re-fetch the realtime + catalog feeds for [vehicleId] (web `refetchLive()` affordance). */
    suspend fun refresh(vehicleId: Long)
}

/**
 * Binds the surface to the shared S8 [VehiclesStore] + [SignalsStore] — the holders these feeds already
 * share app-wide. Each signal read uses the [SignalsStore]'s shared feeds (so every observer of the same
 * params folds into one upstream collection); the history feed pins the [HISTORY_RANGE] trailing window
 * (web's `hours = 1`), and [refresh] bumps the realtime + catalog feeds (the web button's `refetchLive`).
 */
fun liveSignalSparklinesSource(
    vehicles: VehiclesStore,
    signals: SignalsStore,
): LiveSignalSparklinesSource =
    object : LiveSignalSparklinesSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun availableSignals(vehicleId: Long): Flow<Resource<AvailableSignalsResponse>> = signals.availableSignals(vehicleId)

        override fun liveSignals(vehicleId: Long): Flow<Resource<LiveSignalsResponse>> = signals.liveSignals(vehicleId)

        override fun signalHistory(
            vehicleId: Long,
            signalName: String,
        ): Flow<Resource<SignalHistoryResponse>> = signals.signalHistory(vehicleId, signalName, HISTORY_RANGE)

        override suspend fun refresh(vehicleId: Long) {
            signals.refreshLiveSignals(vehicleId)
            signals.refreshAvailableSignals(vehicleId)
        }
    }

/** The trailing-hour history window every row pulls (web `useSignalHistory(id, signal, 1)`). */
private val HISTORY_RANGE = SignalHistoryRange(hours = LiveSignalSparklinesRegistration.HISTORY_HOURS)

/**
 * Composes the fleet list with the active vehicle's catalog, live values and per-signal history into one
 * cache-then-network [Resource] stream — the native port of the web `id = vehicleId ?? vehicles?.[0]?.id`
 * resolution feeding `useSignals` / `useSignalGaps` / `useSignalHistory`. A positive [preferredVehicleId]
 * short-circuits straight to its feeds (the vehicle list is not consulted when a prop id is supplied);
 * otherwise the first enrolled vehicle drives them, and when neither resolves the fleet resource is folded
 * onto a no-signal projection so the surface renders its loading / empty / error state honestly.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun liveSparklinesResource(
    source: LiveSignalSparklinesSource,
    preferredVehicleId: Long?,
    configSignals: List<String>?,
): Flow<Resource<LiveSignalSparklinesData>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        signalsFor(source, preferred, configSignals)
    } else {
        source.vehicles().flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoSignalsData())
                else -> signalsFor(source, id, configSignals)
            }
        }
    }
}

/**
 * Streams one vehicle's projected sparkline data: the configured-signal set is re-derived from the catalog
 * (restarting the history fan-out only when the SET changes, not on every realtime tick), and the catalog +
 * live + per-signal history feeds are combined and folded into a single [Resource] by [foldEnvelope].
 */
@OptIn(ExperimentalCoroutinesApi::class)
private fun signalsFor(
    source: LiveSignalSparklinesSource,
    vehicleId: Long,
    configSignals: List<String>?,
): Flow<Resource<LiveSignalSparklinesData>> {
    val available = source.availableSignals(vehicleId)
    val live = source.liveSignals(vehicleId)
    val configuredFlow =
        available
            .map { resolveConfiguredSignals(configSignals, it.cached?.signals?.map { descriptor -> descriptor.name }) }
            .distinctUntilChanged()
    return configuredFlow.flatMapLatest { configured ->
        val historiesFlow: Flow<Map<String, Resource<SignalHistoryResponse>>> =
            if (configured.isEmpty()) {
                flowOf(emptyMap())
            } else {
                combine(configured.map { signal -> source.signalHistory(vehicleId, signal).map { signal to it } }) { it.toMap() }
            }
        combine(available, live, historiesFlow) { availableRes, liveRes, histories ->
            foldEnvelope(availableRes, liveRes, configured, histories)
        }
    }
}

/**
 * Folds the catalog + live + history resources into a single cache-then-network [Resource] of the projected
 * rows. The freshness/error envelope follows the realtime [live] feed (web wires `isStale`/`isError`/
 * `dataUpdatedAt` from `useSignalGaps`), gated to a first-load skeleton while either the catalog or the live
 * feed is still loading with nothing cached. A hard live failure keeps the cached/partial rows visible
 * (offline / last-known) whenever any signal data is present, and only blanks to an error surface when
 * there is nothing at all to show.
 */
private fun foldEnvelope(
    available: Resource<AvailableSignalsResponse>,
    live: Resource<LiveSignalsResponse>,
    configured: List<String>,
    histories: Map<String, Resource<SignalHistoryResponse>>,
): Resource<LiveSignalSparklinesData> {
    val data =
        LiveSignalSparklinesProjection.buildData(
            configured = configured,
            live = live.cached,
            histories = histories.mapValues { it.value.cached },
        )
    val firstLoad =
        (live is Resource.Loading && live.cached == null) ||
            (available is Resource.Loading && available.cached == null)
    if (firstLoad) return Resource.Loading(cached = null, fetchedAt = null, stale = false)
    return when (live) {
        is Resource.Loading -> Resource.Loading(cached = data, fetchedAt = live.fetchedAt, stale = live.stale)
        is Resource.Success -> Resource.Success(data, fetchedAt = live.fetchedAt, stale = live.stale)
        is Resource.Error ->
            if (data.hasAnySignalData || live.cached != null) {
                Resource.Error(cached = data, fetchedAt = live.fetchedAt, stale = true, error = live.error)
            } else {
                Resource.Error(cached = null, fetchedAt = live.fetchedAt, stale = live.stale, error = live.error)
            }
    }
}

/** Folds a fleet-list [Resource] onto a no-signal projection, preserving loading / empty / error. */
private fun Resource<List<Vehicle>>.toNoSignalsData(): Resource<LiveSignalSparklinesData> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(LiveSignalSparklinesData.EMPTY, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }
