package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import io.teslasync.shared.core.presentation.telemetry.SignalCatalogEntry
import io.teslasync.shared.core.presentation.telemetry.SignalDiffServerResponse
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryResponse
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.telemetry.SignalSnapshotResponse
import io.teslasync.shared.core.presentation.telemetry.SignalStats
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The S7 data port for the raw signal-inspector / fleet-telemetry-diagnostics surface — the
 * cross-platform analogue of the web `useTelemetry` hook domain (web/src/api/hooks/useTelemetry.ts).
 * Every native Telemetry screen (Android/Apple via KMP, Windows via the C# port) reaches the backend
 * exclusively through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * The fourteen reads each stream a cache-then-network [Resource] (ADR-013): the cached value first
 * for an instant cold start, then the refreshed value. Each is cached under a stable per-feed key
 * (see the `telemetry*Key` builders) mirroring the web `telemetryKeys` tuples, with a per-read TTL
 * matching the web `staleTime` (live/observations ⇒ REALTIME/5s, catalog ⇒ SLOW/5m, everything else
 * ⇒ STANDARD/60s, the TanStack default). The four non-trivial transforms (signal-name flattening,
 * the live-gaps map, the observation adapter, the MQTT-status normalization) are applied per emission
 * by [io.teslasync.shared.core.presentation.telemetry.TelemetryDerivations] so the typed read model
 * is produced from the cached raw element on every emission and the C#/KMP ports share the
 * golden-locked transform. Values stay SI (Phase-42 stores everything as SI on disk); display
 * formatting is the render boundary's job (S5), never this layer's.
 *
 * The two mutations are non-throwing suspend [Result]s; they POST a refresh request and the S8 store
 * mirrors the web `invalidateQueries` by re-fetching only the affected family of feeds
 * (`fleet-telemetry-error-vins` or `fleet-telemetry-errors`).
 */
public interface TelemetryRepository {
    /** `GET /signals/{vehicleId}/available` normalized to signal names (web `useSignals`). */
    public fun signals(vehicleId: Long): Flow<Resource<List<String>>>

    /** `GET /signals/{vehicleId}/live` raw per-field map (web `useVehicleLiveSignals`). */
    public fun vehicleLiveSignals(vehicleId: Long): Flow<Resource<VehicleLiveSignalsResponse>>

    /** `GET /signals/{vehicleId}/stats` (web `useSignalStats`). */
    public fun signalStats(vehicleId: Long): Flow<Resource<SignalStats>>

    /** `GET /signals/{vehicleId}/{signal}/history?hours=` (web `useSignalHistory`). */
    public fun signalHistory(
        vehicleId: Long,
        signal: String,
        hours: Int,
    ): Flow<Resource<SignalHistoryResponse>>

    /** `GET /signals/{vehicleId}/{signal}/history?hours=&page=&page_size=` (web `useSignalLog`). */
    public fun signalLog(
        vehicleId: Long,
        signal: String,
        hours: Int,
        page: Int,
        pageSize: Int,
    ): Flow<Resource<SignalHistoryResponse>>

    /** `GET /signals/{vehicleId}/{signal}/history?from=&to=` (web `useSignalDiff`). */
    public fun signalDiff(
        vehicleId: Long,
        signal: String,
        from: String,
        to: String,
    ): Flow<Resource<SignalHistoryResponse>>

    /** `GET /signals/{vehicleId}/snapshot[?at=&signals=]` (web `useSignalSnapshot`). */
    public fun signalSnapshot(
        vehicleId: Long,
        at: String,
        signalsCsv: String,
    ): Flow<Resource<SignalSnapshotResponse>>

    /** `GET /signals/{vehicleId}/diff?at_a=&at_b=[&signals=]` (web `useSignalDiffServer`). */
    public fun signalDiffServer(
        vehicleId: Long,
        atA: String,
        atB: String,
        signalsCsv: String,
    ): Flow<Resource<SignalDiffServerResponse>>

    /** `GET /signals/{vehicleId}/live` reduced to its `signals` map (web `useSignalGaps`). */
    public fun signalGaps(vehicleId: Long): Flow<Resource<Map<String, JsonElement>>>

    /** `GET /telemetry` normalized MQTT status (web `useMQTTStatus`). */
    public fun mqttStatus(): Flow<Resource<TelemetryStatus>>

    /** `GET /signals/catalog` (web `useSignalCatalog`; deprecated/404 upstream). */
    public fun signalCatalog(): Flow<Resource<List<SignalCatalogEntry>>>

    /** `GET /signals/observations?…` adapted to the legacy observation rows (web `useSignalObservations`). */
    public fun signalObservations(params: SignalObservationsParams): Flow<Resource<List<SignalObservation>>>

    /** `GET /tesla/fleet-telemetry/error-vins` (web `useFleetTelemetryErrorVINs`). */
    public fun fleetTelemetryErrorVINs(): Flow<Resource<List<FleetTelemetryErrorVIN>>>

    /** `GET /tesla/fleet-telemetry/errors[?vin=]` (web `useFleetTelemetryErrors`). */
    public fun fleetTelemetryErrors(vin: String?): Flow<Resource<List<FleetTelemetryError>>>

    /** `POST /tesla/fleet-telemetry/error-vins/refresh` (web `useRefreshFleetTelemetryErrorVINs`). */
    public suspend fun refreshFleetTelemetryErrorVINs(): Result<Unit>

    /** `POST /tesla/fleet-telemetry/errors/refresh` (web `useRefreshFleetTelemetryErrors`). */
    public suspend fun refreshFleetTelemetryErrors(): Result<Unit>
}

/**
 * The optional filter for [TelemetryRepository.signalObservations] — the port of the web
 * `useSignalObservations` `opts`. The web caller still passes `signal_name`; it is translated to the
 * backend's `field=` query param at the wire boundary (see [telemetryObservationsQuery]).
 */
public data class SignalObservationsParams(
    val vehicleId: Long,
    val signalName: String? = null,
    val since: String? = null,
    val until: String? = null,
    val limit: Int? = null,
)

// ---- Per-read staleness thresholds (web `staleTime`, ms) --------------------------

/** TTL for the live-ish reads — the web `STALE_TIMES.REALTIME` (5 seconds). */
public const val TELEMETRY_REALTIME_TTL_MILLIS: Long = 5_000L

/** TTL for the catalog read — the web `STALE_TIMES.SLOW` (5 minutes). */
public const val TELEMETRY_SLOW_TTL_MILLIS: Long = 5 * 60_000L

/** TTL for the standard reads — the web `STALE_TIMES.STANDARD` / TanStack default (60 seconds). */
public const val TELEMETRY_STANDARD_TTL_MILLIS: Long = 60_000L

// ---- Cache/feed keys (mirror the web `telemetryKeys` tuples) -----------------------

/** The tuple separator used by every Telemetry cache key. */
internal const val TELEMETRY_KEY_SEP: String = "|"

/** Key family head for the error-VINs feed (web `['fleet-telemetry-error-vins']`). */
public const val TELEMETRY_ERROR_VINS_FAMILY: String = "fleet-telemetry-error-vins"

/** Key family head for the errors feed (web `['fleet-telemetry-errors', vin]`). */
public const val TELEMETRY_ERRORS_FAMILY: String = "fleet-telemetry-errors"

private fun key(vararg parts: String): String = parts.joinToString(TELEMETRY_KEY_SEP)

/** Cache/feed key for [TelemetryRepository.signals] — web `telemetryKeys.signals(id)`. */
public fun telemetrySignalsKey(vehicleId: Long): String = key("signals", vehicleId.toString())

/** Cache/feed key for [TelemetryRepository.vehicleLiveSignals] — web `telemetryKeys.liveSignals(id)`. */
public fun telemetryLiveSignalsKey(vehicleId: Long): String = key("live-signals", vehicleId.toString())

/** Cache/feed key for [TelemetryRepository.signalStats] — web `telemetryKeys.signalStats(id)`. */
public fun telemetrySignalStatsKey(vehicleId: Long): String = key("signal-stats", vehicleId.toString())

/** Cache/feed key for [TelemetryRepository.signalHistory] — web `telemetryKeys.signalHistory(id, sig, hours)`. */
public fun telemetrySignalHistoryKey(
    vehicleId: Long,
    signal: String,
    hours: Int,
): String = key("signal-history", vehicleId.toString(), signal, hours.toString())

/** Cache/feed key for [TelemetryRepository.signalLog] — web `telemetryKeys.signalLog(id, sig, hours, page)`. */
public fun telemetrySignalLogKey(
    vehicleId: Long,
    signal: String,
    hours: Int,
    page: Int,
): String = key("signal-log", vehicleId.toString(), signal, hours.toString(), page.toString())

/** Cache/feed key for [TelemetryRepository.signalDiff] — web `telemetryKeys.signalDiff(id, sig, from, to)`. */
public fun telemetrySignalDiffKey(
    vehicleId: Long,
    signal: String,
    from: String,
    to: String,
): String = key("signal-diff", vehicleId.toString(), signal, from, to)

/** Cache/feed key for [TelemetryRepository.signalSnapshot] — web `telemetryKeys.signalSnapshot(id, at, csv)`. */
public fun telemetrySignalSnapshotKey(
    vehicleId: Long,
    at: String,
    signalsCsv: String,
): String = key("signal-snapshot", vehicleId.toString(), at, signalsCsv)

/** Cache/feed key for [TelemetryRepository.signalDiffServer] — web `telemetryKeys.signalDiffServer(id, a, b, csv)`. */
public fun telemetrySignalDiffServerKey(
    vehicleId: Long,
    atA: String,
    atB: String,
    signalsCsv: String,
): String = key("signal-diff-server", vehicleId.toString(), atA, atB, signalsCsv)

/** Cache/feed key for [TelemetryRepository.signalGaps] — web `telemetryKeys.signalGaps(id)`. */
public fun telemetrySignalGapsKey(vehicleId: Long): String = key("signal-gaps", vehicleId.toString())

/** Cache/feed key for [TelemetryRepository.mqttStatus] — web `telemetryKeys.mqttStatus`. */
public const val TELEMETRY_MQTT_STATUS_KEY: String = "mqtt-status"

/** Cache/feed key for [TelemetryRepository.signalCatalog] — web `['signal-catalog']`. */
public const val TELEMETRY_SIGNAL_CATALOG_KEY: String = "signal-catalog"

/** Cache/feed key for [TelemetryRepository.signalObservations] — web `['signal-observations', id, opts]`. */
public fun telemetrySignalObservationsKey(params: SignalObservationsParams): String =
    key(
        "signal-observations",
        params.vehicleId.toString(),
        params.signalName ?: "",
        params.since ?: "",
        params.until ?: "",
        (params.limit ?: 0).toString(),
    )

/** Cache/feed key for [TelemetryRepository.fleetTelemetryErrorVINs] — web `['fleet-telemetry-error-vins']`. */
public const val TELEMETRY_ERROR_VINS_KEY: String = TELEMETRY_ERROR_VINS_FAMILY

/** Cache/feed key for [TelemetryRepository.fleetTelemetryErrors] — web `['fleet-telemetry-errors', vin]`. */
public fun telemetryErrorsKey(vin: String?): String =
    if (vin.isNullOrEmpty()) TELEMETRY_ERRORS_FAMILY else key(TELEMETRY_ERRORS_FAMILY, vin)

// ---- Query builders (web param semantics, snake_case) ------------------------------

/** `?hours=` — web `useSignalHistory`. */
public fun telemetrySignalHistoryQuery(hours: Int): Map<String, String> = mapOf("hours" to hours.toString())

/** `?hours=&page=&page_size=` — web `useSignalLog`. */
public fun telemetrySignalLogQuery(
    hours: Int,
    page: Int,
    pageSize: Int,
): Map<String, String> =
    linkedMapOf(
        "hours" to hours.toString(),
        "page" to page.toString(),
        "page_size" to pageSize.toString(),
    )

/** `?from=&to=` — web `useSignalDiff`. */
public fun telemetrySignalDiffQuery(
    from: String,
    to: String,
): Map<String, String> = linkedMapOf("from" to from, "to" to to)

/**
 * `?[at=][&signals=]` — web `useSignalSnapshot`: `at` and `signals` are appended only when non-empty
 * (the web `if (at)` / `if (signalsCsv)` truthy guards). Locked by golden vectors shared with C#.
 */
public fun telemetrySnapshotQuery(
    at: String,
    signalsCsv: String,
): Map<String, String> {
    val query = linkedMapOf<String, String>()
    if (at.isNotEmpty()) query["at"] = at
    if (signalsCsv.isNotEmpty()) query["signals"] = signalsCsv
    return query
}

/**
 * `?at_a=&at_b=[&signals=]` — web `useSignalDiffServer`: `at_a`/`at_b` are appended only when
 * non-empty, `signals` only when non-empty. Locked by golden vectors shared with C#.
 */
public fun telemetryDiffServerQuery(
    atA: String,
    atB: String,
    signalsCsv: String,
): Map<String, String> {
    val query = linkedMapOf<String, String>()
    if (atA.isNotEmpty()) query["at_a"] = atA
    if (atB.isNotEmpty()) query["at_b"] = atB
    if (signalsCsv.isNotEmpty()) query["signals"] = signalsCsv
    return query
}

/**
 * The `/signals/observations` query — web `useSignalObservations`: `vehicle_id` is always sent; the
 * web caller's `signal_name` is translated to the backend `field=` param; `since`/`until` are sent
 * when present; `limit` only when present AND > 0. Locked by golden vectors shared with C#.
 */
public fun telemetryObservationsQuery(params: SignalObservationsParams): Map<String, String> {
    val query = linkedMapOf<String, String>()
    query["vehicle_id"] = params.vehicleId.toString()
    params.signalName?.takeIf { it.isNotEmpty() }?.let { query["field"] = it }
    params.since?.takeIf { it.isNotEmpty() }?.let { query["since"] = it }
    params.until?.takeIf { it.isNotEmpty() }?.let { query["until"] = it }
    params.limit?.takeIf { it > 0 }?.let { query["limit"] = it.toString() }
    return query
}

/** `?[vin=]` — web `useFleetTelemetryErrors`: `vin` is appended only when present. */
public fun telemetryErrorsQuery(vin: String?): Map<String, String> = if (vin.isNullOrEmpty()) emptyMap() else mapOf("vin" to vin)
