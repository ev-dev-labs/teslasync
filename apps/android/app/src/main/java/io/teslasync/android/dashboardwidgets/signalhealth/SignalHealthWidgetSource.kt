// File hosts the SignalHealth data seam, its shared-store binding and the cache-then-network adapter
// that composes the fleet list with the active vehicle's available-signal catalog, live-gap map and
// signal stats; named after the surface bundle (SignalHealthWidget*) rather than the single interface
// it declares.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.signalhealth

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.telemetry.SignalStats
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement

/**
 * The data port the [SignalHealthWidgetViewModel] binds to — the Android analogue of the web
 * `SignalHealthWidget`'s hook composition (`useVehicles` + `useSignals` + `useSignalGaps` +
 * `useSignalStats`) and the P1/S8 state-holder boundary. The view never performs HTTP itself; a test
 * fake stands in for the whole domain.
 *
 * [vehicles] resolves the default active vehicle (web `vehicles?.[0]?.id`); [signals] is the
 * available-signal catalog whose size is the headline Total Signals (web `useSignals`); [liveGaps] is
 * the realtime current-value map each entry's `{value, timestamp}` drives the active/stale split + the
 * freshness age (web `useSignalGaps`); and [stats] is the aggregate signal stats that drives the
 * loading / freshness / error envelope of the panel header (web `useSignalStats`). [refresh] re-fetches
 * all three per-vehicle feeds (web `refetchStats()` + the realtime cadence).
 */
interface SignalHealthSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream a vehicle's available-signal names (web `useSignals` → `/signals/{id}/available`). */
    fun signals(vehicleId: Long): Flow<Resource<List<String>>>

    /** Stream a vehicle's realtime live-gap map (web `useSignalGaps` → `/signals/{id}/live`). */
    fun liveGaps(vehicleId: Long): Flow<Resource<Map<String, JsonElement>>>

    /** Stream a vehicle's aggregate signal stats (web `useSignalStats` → `/signals/{id}/stats`). */
    fun stats(vehicleId: Long): Flow<Resource<SignalStats>>

    /** Re-fetch the stats + catalog + live-gap feeds for [vehicleId] (web `refetchStats()`). */
    suspend fun refresh(vehicleId: Long)
}

/**
 * Binds the surface to the shared S8 [VehiclesStore] + [TelemetryStore] — the holders these feeds
 * already share app-wide. Each read uses the stores' shared feeds (so every observer of the same
 * params folds into one upstream collection), and [SignalHealthSource.refresh] bumps the three
 * per-vehicle feeds the web button's `refetchStats` (plus the realtime cadence) re-collects.
 */
fun signalHealthSource(
    vehicles: VehiclesStore,
    telemetry: TelemetryStore,
): SignalHealthSource =
    object : SignalHealthSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun signals(vehicleId: Long): Flow<Resource<List<String>>> = telemetry.signals(vehicleId)

        override fun liveGaps(vehicleId: Long): Flow<Resource<Map<String, JsonElement>>> = telemetry.signalGaps(vehicleId)

        override fun stats(vehicleId: Long): Flow<Resource<SignalStats>> = telemetry.signalStats(vehicleId)

        override suspend fun refresh(vehicleId: Long) {
            telemetry.refreshSignalStats(vehicleId)
            telemetry.refreshSignals(vehicleId)
            telemetry.refreshSignalGaps(vehicleId)
        }
    }

/**
 * Composes the fleet list with the active vehicle's catalog, live-gap map and stats into one
 * cache-then-network [Resource] stream — the native port of the web `id = vehicleId ?? vehicles?.[0]?.id`
 * resolution feeding `useSignals` / `useSignalGaps` / `useSignalStats`. A positive [preferredVehicleId]
 * short-circuits straight to its feeds; otherwise the first enrolled vehicle drives them, and when
 * neither resolves the fleet resource is folded onto a no-data projection so the surface renders its
 * loading / empty / error state honestly. [now] is the clock the stale/freshness math reads (injectable
 * for deterministic tests).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun signalHealthResource(
    source: SignalHealthSource,
    preferredVehicleId: Long?,
    now: () -> Long = System::currentTimeMillis,
): Flow<Resource<SignalHealthData>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        feedsFor(source, preferred, now)
    } else {
        source.vehicles().flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoData())
                else -> feedsFor(source, id, now)
            }
        }
    }
}

/** Combines one vehicle's catalog + live-gap + stats feeds and folds them into one [Resource]. */
private fun feedsFor(
    source: SignalHealthSource,
    vehicleId: Long,
    now: () -> Long,
): Flow<Resource<SignalHealthData>> =
    combine(
        source.signals(vehicleId),
        source.liveGaps(vehicleId),
        source.stats(vehicleId),
    ) { signals, gaps, stats ->
        foldEnvelope(signals, gaps, stats, now())
    }

/**
 * Folds the catalog + live-gap + stats resources into a single cache-then-network [Resource] of the
 * projected analysis. The loading/freshness/error envelope follows the STATS feed (web wires
 * `loading`/`isStale`/`isError`/`dataUpdatedAt` of the shell from `useSignalStats`), gated to a
 * first-load skeleton only while stats is still loading with nothing cached. A hard stats failure keeps
 * the cached/partial analysis visible (offline / last-known) whenever ANY feed has resolved — the web
 * `hasData = stats || signals || gapData` truthiness — and only blanks to an error surface when nothing
 * at all has resolved.
 */
private fun foldEnvelope(
    signals: Resource<List<String>>,
    gaps: Resource<Map<String, JsonElement>>,
    stats: Resource<SignalStats>,
    nowMillis: Long,
): Resource<SignalHealthData> {
    if (stats is Resource.Loading && stats.cached == null) {
        return Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
    val data =
        SignalHealthProjection.build(
            signalNames = signals.cached,
            gaps = gaps.cached,
            statsResolved = stats.cached != null,
            nowMillis = nowMillis,
        )
    return when (stats) {
        is Resource.Loading -> Resource.Loading(cached = data, fetchedAt = stats.fetchedAt, stale = stats.stale)
        is Resource.Success -> Resource.Success(data, fetchedAt = stats.fetchedAt, stale = stats.stale)
        is Resource.Error ->
            if (data.hasData) {
                Resource.Error(cached = data, fetchedAt = stats.fetchedAt, stale = true, error = stats.error)
            } else {
                Resource.Error(cached = null, fetchedAt = stats.fetchedAt, stale = stats.stale, error = stats.error)
            }
    }
}

/** Folds a fleet-list [Resource] onto a no-data projection, preserving loading / empty / error. */
private fun Resource<List<Vehicle>>.toNoData(): Resource<SignalHealthData> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(SignalHealthData.EMPTY, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }

/** The active vehicle id the widget reads signals for — the native port of `vehicles?.[0]?.id ?? 0`. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
