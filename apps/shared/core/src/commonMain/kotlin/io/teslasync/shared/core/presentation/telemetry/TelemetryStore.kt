package io.teslasync.shared.core.presentation.telemetry

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalObservationsParams
import io.teslasync.shared.core.data.repo.TELEMETRY_ERRORS_FAMILY
import io.teslasync.shared.core.data.repo.TELEMETRY_ERROR_VINS_FAMILY
import io.teslasync.shared.core.data.repo.TELEMETRY_KEY_SEP
import io.teslasync.shared.core.data.repo.TELEMETRY_MQTT_STATUS_KEY
import io.teslasync.shared.core.data.repo.TELEMETRY_SIGNAL_CATALOG_KEY
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.data.repo.telemetryErrorsKey
import io.teslasync.shared.core.data.repo.telemetryLiveSignalsKey
import io.teslasync.shared.core.data.repo.telemetrySignalDiffKey
import io.teslasync.shared.core.data.repo.telemetrySignalDiffServerKey
import io.teslasync.shared.core.data.repo.telemetrySignalGapsKey
import io.teslasync.shared.core.data.repo.telemetrySignalHistoryKey
import io.teslasync.shared.core.data.repo.telemetrySignalLogKey
import io.teslasync.shared.core.data.repo.telemetrySignalObservationsKey
import io.teslasync.shared.core.data.repo.telemetrySignalSnapshotKey
import io.teslasync.shared.core.data.repo.telemetrySignalStatsKey
import io.teslasync.shared.core.data.repo.telemetrySignalsKey
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
 * UI-free shared state holder for the raw signal-inspector / fleet-telemetry-diagnostics surface —
 * the cross-platform port of the web `useTelemetry` hook domain (web/src/api/hooks/useTelemetry.ts).
 * Every native Telemetry screen (Android/Apple via KMP, Windows via the C# port) binds to this single
 * holder rather than re-implementing the fourteen endpoints, their query keys, their
 * `staleTime`/normalizations, or the two error-refresh invalidations.
 *
 * The fourteen reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013):
 * each `(feed, params)` is lazily created on first access, shared so every observer of the same params
 * folds into one upstream collection, and refreshable via the matching `refresh*` call. The web hooks'
 * `refetchInterval` cadences and their `enabled` lazy gates (`vehicleId > 0`, non-empty signal/at) are
 * render-layer concerns and are intentionally NOT reproduced here: a platform live-poll /
 * pull-to-refresh drives re-collection, and the caller simply does not open a feed until it has valid
 * params. The holder makes no network calls and performs no normalization itself — it delegates
 * entirely to the injected [TelemetryRepository] (S7), which carries the golden-locked derivations.
 * Values stay SI (Phase-42 stores everything as SI); any display formatting is the render boundary's
 * job (S5).
 *
 * The two mutations are non-throwing suspend [Result]s; on success each refreshes ONLY the affected
 * family of observed feeds — [refreshFleetTelemetryErrorVINs] re-collects the error-VINs feed and
 * [refreshFleetTelemetryErrors] re-collects every errors feed (all `vin` variants) — mirroring the
 * web hooks invalidating `['fleet-telemetry-error-vins']` / `['fleet-telemetry-errors']` respectively
 * (and never each other, since the two query-key families are disjoint).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised; create
 * and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class TelemetryStore(
    private val repo: TelemetryRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<*>>>()

    // ---- Reads (14) ---------------------------------------------------------------

    /** Shared, refreshable `GET /signals/{id}/available` signal-name feed (web `useSignals`). */
    public fun signals(vehicleId: Long): StateFlow<Resource<List<String>>> =
        feed(telemetrySignalsKey(vehicleId)) { repo.signals(vehicleId) }

    /** Shared, refreshable `GET /signals/{id}/live` raw feed (web `useVehicleLiveSignals`). */
    public fun vehicleLiveSignals(vehicleId: Long): StateFlow<Resource<VehicleLiveSignalsResponse>> =
        feed(telemetryLiveSignalsKey(vehicleId)) { repo.vehicleLiveSignals(vehicleId) }

    /** Shared, refreshable `GET /signals/{id}/stats` feed (web `useSignalStats`). */
    public fun signalStats(vehicleId: Long): StateFlow<Resource<SignalStats>> =
        feed(telemetrySignalStatsKey(vehicleId)) { repo.signalStats(vehicleId) }

    /** Shared, refreshable `GET /signals/{id}/{signal}/history?hours=` feed (web `useSignalHistory`). */
    public fun signalHistory(
        vehicleId: Long,
        signal: String,
        hours: Int,
    ): StateFlow<Resource<SignalHistoryResponse>> =
        feed(telemetrySignalHistoryKey(vehicleId, signal, hours)) { repo.signalHistory(vehicleId, signal, hours) }

    /** Shared, refreshable paginated history feed (web `useSignalLog`). */
    public fun signalLog(
        vehicleId: Long,
        signal: String,
        hours: Int,
        page: Int,
        pageSize: Int,
    ): StateFlow<Resource<SignalHistoryResponse>> =
        feed(telemetrySignalLogKey(vehicleId, signal, hours, page)) {
            repo.signalLog(vehicleId, signal, hours, page, pageSize)
        }

    /** Shared, refreshable `?from=&to=` history feed (web `useSignalDiff`). */
    public fun signalDiff(
        vehicleId: Long,
        signal: String,
        from: String,
        to: String,
    ): StateFlow<Resource<SignalHistoryResponse>> =
        feed(telemetrySignalDiffKey(vehicleId, signal, from, to)) { repo.signalDiff(vehicleId, signal, from, to) }

    /** Shared, refreshable point-in-time snapshot feed (web `useSignalSnapshot`). */
    public fun signalSnapshot(
        vehicleId: Long,
        at: String,
        signalsCsv: String = "",
    ): StateFlow<Resource<SignalSnapshotResponse>> =
        feed(telemetrySignalSnapshotKey(vehicleId, at, signalsCsv)) { repo.signalSnapshot(vehicleId, at, signalsCsv) }

    /** Shared, refreshable server-side diff feed (web `useSignalDiffServer`). */
    public fun signalDiffServer(
        vehicleId: Long,
        atA: String,
        atB: String,
        signalsCsv: String = "",
    ): StateFlow<Resource<SignalDiffServerResponse>> =
        feed(telemetrySignalDiffServerKey(vehicleId, atA, atB, signalsCsv)) {
            repo.signalDiffServer(vehicleId, atA, atB, signalsCsv)
        }

    /** Shared, refreshable live-gaps map feed (web `useSignalGaps`). */
    public fun signalGaps(vehicleId: Long): StateFlow<Resource<Map<String, JsonElement>>> =
        feed(telemetrySignalGapsKey(vehicleId)) { repo.signalGaps(vehicleId) }

    /** Shared, refreshable normalized MQTT status feed (web `useMQTTStatus`). */
    public fun mqttStatus(): StateFlow<Resource<TelemetryStatus>> = feed(TELEMETRY_MQTT_STATUS_KEY) { repo.mqttStatus() }

    /** Shared, refreshable signal-catalog feed (web `useSignalCatalog`; deprecated upstream). */
    public fun signalCatalog(): StateFlow<Resource<List<SignalCatalogEntry>>> = feed(TELEMETRY_SIGNAL_CATALOG_KEY) { repo.signalCatalog() }

    /** Shared, refreshable adapted observations feed (web `useSignalObservations`). */
    public fun signalObservations(params: SignalObservationsParams): StateFlow<Resource<List<SignalObservation>>> =
        feed(telemetrySignalObservationsKey(params)) { repo.signalObservations(params) }

    /** Shared, refreshable error-VINs feed (web `useFleetTelemetryErrorVINs`). */
    public fun fleetTelemetryErrorVINs(): StateFlow<Resource<List<FleetTelemetryErrorVIN>>> =
        feed(TELEMETRY_ERROR_VINS_FAMILY) { repo.fleetTelemetryErrorVINs() }

    /** Shared, refreshable errors feed for an optional [vin] (web `useFleetTelemetryErrors`). */
    public fun fleetTelemetryErrors(vin: String? = null): StateFlow<Resource<List<FleetTelemetryError>>> =
        feed(telemetryErrorsKey(vin)) { repo.fleetTelemetryErrors(vin) }

    // ---- Per-feed refreshes (the web `refetchInterval`/`refetch()` seam) -----------

    /** Re-fetches the [signals] feed for [vehicleId] if observed. */
    public fun refreshSignals(vehicleId: Long): Unit = refresh(telemetrySignalsKey(vehicleId))

    /** Re-fetches the [vehicleLiveSignals] feed for [vehicleId] if observed. */
    public fun refreshVehicleLiveSignals(vehicleId: Long): Unit = refresh(telemetryLiveSignalsKey(vehicleId))

    /** Re-fetches the [signalStats] feed for [vehicleId] if observed. */
    public fun refreshSignalStats(vehicleId: Long): Unit = refresh(telemetrySignalStatsKey(vehicleId))

    /** Re-fetches the [signalHistory] feed for `(vehicleId, signal, hours)` if observed. */
    public fun refreshSignalHistory(
        vehicleId: Long,
        signal: String,
        hours: Int,
    ): Unit = refresh(telemetrySignalHistoryKey(vehicleId, signal, hours))

    /** Re-fetches the [signalLog] feed for `(vehicleId, signal, hours, page)` if observed. */
    public fun refreshSignalLog(
        vehicleId: Long,
        signal: String,
        hours: Int,
        page: Int,
    ): Unit = refresh(telemetrySignalLogKey(vehicleId, signal, hours, page))

    /** Re-fetches the [signalDiff] feed for `(vehicleId, signal, from, to)` if observed. */
    public fun refreshSignalDiff(
        vehicleId: Long,
        signal: String,
        from: String,
        to: String,
    ): Unit = refresh(telemetrySignalDiffKey(vehicleId, signal, from, to))

    /** Re-fetches the [signalSnapshot] feed for `(vehicleId, at, signalsCsv)` if observed. */
    public fun refreshSignalSnapshot(
        vehicleId: Long,
        at: String,
        signalsCsv: String = "",
    ): Unit = refresh(telemetrySignalSnapshotKey(vehicleId, at, signalsCsv))

    /** Re-fetches the [signalDiffServer] feed for `(vehicleId, atA, atB, signalsCsv)` if observed. */
    public fun refreshSignalDiffServer(
        vehicleId: Long,
        atA: String,
        atB: String,
        signalsCsv: String = "",
    ): Unit = refresh(telemetrySignalDiffServerKey(vehicleId, atA, atB, signalsCsv))

    /** Re-fetches the [signalGaps] feed for [vehicleId] if observed. */
    public fun refreshSignalGaps(vehicleId: Long): Unit = refresh(telemetrySignalGapsKey(vehicleId))

    /** Re-fetches the [mqttStatus] feed if observed. */
    public fun refreshMqttStatus(): Unit = refresh(TELEMETRY_MQTT_STATUS_KEY)

    /** Re-fetches the [signalCatalog] feed if observed. */
    public fun refreshSignalCatalog(): Unit = refresh(TELEMETRY_SIGNAL_CATALOG_KEY)

    /** Re-fetches the [signalObservations] feed for [params] if observed. */
    public fun refreshSignalObservations(params: SignalObservationsParams): Unit = refresh(telemetrySignalObservationsKey(params))

    // ---- Mutations ----------------------------------------------------------------

    /**
     * `POST /tesla/fleet-telemetry/error-vins/refresh`, then re-collects the error-VINs feed
     * (web `useRefreshFleetTelemetryErrorVINs`, which invalidates `['fleet-telemetry-error-vins']`).
     */
    public suspend fun refreshFleetTelemetryErrorVINs(): Result<Unit> =
        repo.refreshFleetTelemetryErrorVINs().onSuccess { refreshFamily(TELEMETRY_ERROR_VINS_FAMILY) }

    /**
     * `POST /tesla/fleet-telemetry/errors/refresh`, then re-collects every errors feed (all `vin`
     * variants) — web `useRefreshFleetTelemetryErrors`, which invalidates `['fleet-telemetry-errors']`.
     */
    public suspend fun refreshFleetTelemetryErrors(): Result<Unit> =
        repo.refreshFleetTelemetryErrors().onSuccess { refreshFamily(TELEMETRY_ERRORS_FAMILY) }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed] keeps
     * a single upstream shared across observers while at least one is active. The heterogeneous [feeds]
     * map is keyed by the same stable per-feed string as the cache, so the cast back to the caller's
     * `T` is always sound (one key ⇒ one source type).
     */
    @Suppress("UNCHECKED_CAST")
    private fun <T> feed(
        key: String,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        } as StateFlow<Resource<T>>

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    /**
     * Re-fetches every observed feed whose key belongs to [family] — the holder-side analogue of the
     * web `invalidateQueries({ queryKey: [family] })` prefix match. The family head is the first
     * key segment, so `fleet-telemetry-errors` matches `fleet-telemetry-errors` AND
     * `fleet-telemetry-errors|{vin}` but never the disjoint `fleet-telemetry-error-vins`.
     */
    private fun refreshFamily(family: String) {
        triggers.forEach { (key, trigger) ->
            if (key.substringBefore(TELEMETRY_KEY_SEP) == family) trigger.update { it + 1 }
        }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<Nothing> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
