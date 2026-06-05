package io.teslasync.shared.core.presentation.vehiclesystems

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleSystemsRepository
import io.teslasync.shared.core.data.repo.climateHistoryKey
import io.teslasync.shared.core.data.repo.climateKey
import io.teslasync.shared.core.data.repo.maintenanceKey
import io.teslasync.shared.core.data.repo.mediaHistoryKey
import io.teslasync.shared.core.data.repo.mediaKey
import io.teslasync.shared.core.data.repo.safetyHistoryKey
import io.teslasync.shared.core.data.repo.safetyKey
import io.teslasync.shared.core.data.repo.serviceRecordsKey
import io.teslasync.shared.core.data.repo.softwareUpdatesKey
import io.teslasync.shared.core.data.repo.tirePressureHistoryKey
import io.teslasync.shared.core.data.repo.tirePressureKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * UI-free shared state holder for the VehicleSystems domain — the cross-platform port of the web
 * `useVehicleSystems` hook domain (web/src/api/hooks/useVehicleSystems.ts). Every native
 * VehicleSystems screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder
 * rather than re-implementing endpoints, query keys, or the `safeArray` guards.
 *
 * The eleven reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013):
 * each is lazily created on first access, shared so every observer of the same `(feed, params)`
 * folds into one upstream collection, and refreshable:
 *  - [climate] / [climateHistory] mirror `useClimate` / `useClimateHistory`;
 *  - [tirePressure] / [tirePressureHistory] mirror `useTirePressure` / `useTirePressureHistory`;
 *  - [maintenance] / [serviceRecords] mirror the global `useMaintenance` / `useServiceRecords`;
 *  - [softwareUpdates] mirrors `useSoftwareUpdates` (keyed per-vehicle, unparameterised request);
 *  - [safety] / [safetyHistory] mirror `useSafety` / `useSafetyHistory`;
 *  - [media] / [mediaHistory] mirror `useMedia` / `useMediaHistory`.
 *
 * The web hook file declares NO mutations, so there is no `invalidateQueries` analogue here. The
 * single [refresh] is the platform pull-to-refresh / live-poll analogue (the web `refetchInterval`
 * on the four "latest" reads is a render-layer cadence): it re-collects every currently observed
 * feed, which always re-fetches via cache-then-network while replaying the last cached value first.
 * A feed nobody is observing is a no-op to refresh. The holder makes no network calls itself — it
 * delegates entirely to the injected [VehicleSystemsRepository] (S7).
 *
 * Values stay SI; conversion is display-only (S5). This holder mirrors the web hook's single-threaded
 * usage and is not internally synchronised; create and drive it from one confinement (the platform
 * main scope).
 *
 * @property repo the S7 data port every feed is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class VehicleSystemsStore(
    private val repo: VehicleSystemsRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    // ---- Climate ------------------------------------------------------------------

    /** Shared, refreshable `GET /climate/latest` feed (web `useClimate`). */
    public fun climate(vehicleId: String): StateFlow<Resource<JsonElement>> = feed(climateKey(vehicleId)) { repo.climate(vehicleId) }

    /** Shared, refreshable `GET /climate` history feed (web `useClimateHistory`). */
    public fun climateHistory(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(climateHistoryKey(vehicleId)) { repo.climateHistory(vehicleId) }

    // ---- Tire pressure ------------------------------------------------------------

    /** Shared, refreshable `GET /tire-pressure/latest` feed (web `useTirePressure`). */
    public fun tirePressure(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(tirePressureKey(vehicleId)) { repo.tirePressure(vehicleId) }

    /** Shared, refreshable `GET /tire-pressure` history feed (web `useTirePressureHistory`). */
    public fun tirePressureHistory(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(tirePressureHistoryKey(vehicleId)) { repo.tirePressureHistory(vehicleId) }

    // ---- Maintenance (global) -----------------------------------------------------

    /** Shared, refreshable `GET /maintenance` catalog feed (web `useMaintenance`). */
    public fun maintenance(): StateFlow<Resource<JsonElement>> = feed(maintenanceKey()) { repo.maintenance() }

    /** Shared, refreshable `GET /maintenance/records` feed (web `useServiceRecords`). */
    public fun serviceRecords(): StateFlow<Resource<JsonElement>> = feed(serviceRecordsKey()) { repo.serviceRecords() }

    // ---- Software updates ---------------------------------------------------------

    /** Shared, refreshable `GET /software-updates` feed (web `useSoftwareUpdates`). */
    public fun softwareUpdates(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(softwareUpdatesKey(vehicleId)) { repo.softwareUpdates(vehicleId) }

    // ---- Safety -------------------------------------------------------------------

    /** Shared, refreshable `GET /safety/latest` feed (web `useSafety`). */
    public fun safety(vehicleId: String): StateFlow<Resource<JsonElement>> = feed(safetyKey(vehicleId)) { repo.safety(vehicleId) }

    /** Shared, refreshable `GET /safety` history feed (web `useSafetyHistory`). */
    public fun safetyHistory(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(safetyHistoryKey(vehicleId)) { repo.safetyHistory(vehicleId) }

    // ---- Media --------------------------------------------------------------------

    /** Shared, refreshable `GET /media/latest` feed (web `useMedia`). */
    public fun media(vehicleId: String): StateFlow<Resource<JsonElement>> = feed(mediaKey(vehicleId)) { repo.media(vehicleId) }

    /** Shared, refreshable `GET /media` history feed (web `useMediaHistory`). */
    public fun mediaHistory(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(mediaHistoryKey(vehicleId)) { repo.mediaHistory(vehicleId) }

    // ---- Refresh (platform pull-to-refresh / live-poll analogue) ------------------

    /**
     * Re-fetches every currently observed feed by bumping its trigger, restarting the underlying
     * cache-then-network collection. This is the platform pull-to-refresh / live-poll analogue of the
     * web `refetchInterval`; the VehicleSystems hook domain has no mutations and thus no
     * `invalidateQueries` analogue. A feed nobody is observing is a no-op.
     */
    public fun refresh() {
        triggers.keys.toList().forEach { key -> triggers[key]?.update { n -> n + 1 } }
    }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger (via [refresh])
     * restarts the underlying cache-then-network collection, and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active.
     */
    private fun feed(
        key: String,
        source: () -> Flow<Resource<JsonElement>>,
    ): StateFlow<Resource<JsonElement>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                )
        }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
