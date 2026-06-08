package io.teslasync.shared.core.presentation.telemetry

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/*
 * Cross-platform port of the read models + client-side derivations the web `useTelemetry` hook
 * domain surfaces (web/src/api/hooks/useTelemetry.ts, plus the `@/types/telemetry` and
 * `@/types/signals` interfaces it imports). Every native Telemetry screen (Android/Apple via KMP,
 * Windows via the C# port) binds to the [io.teslasync.shared.core.presentation.telemetry.TelemetryStore]
 * that emits these shapes; the non-trivial transforms ([TelemetryDerivations]) are pulled out as pure,
 * side-effect-free functions so the KMP core, its golden vectors, and the Windows C# port coalesce
 * identically and can never drift (ADR-004).
 *
 * Keys arrive snake_case from the Go backend, matched verbatim via @SerialName so the cached payload
 * round-trips unchanged. None of these fields is display-converted at this layer — Phase-42 stores
 * everything as SI on disk, so values round-trip verbatim and any unit formatting is the render
 * boundary's job (S5), never this layer's.
 */

// ─── Plain decode models (no derivation — `request<T>` passthroughs) ────────────────

/** `GET /signals/{vehicleID}/stats` — the port of the web `SignalStats` (`@/types/telemetry`). */
@Serializable
public data class SignalStats(
    @SerialName("vehicle_id") val vehicleId: Long = 0,
    val count: Long = 0,
    val oldest: String? = null,
    val newest: String? = null,
)

/**
 * One point in a `/signals/{id}/{signal}/history` series — the typed `{ts, kind, value}` envelope the
 * Go `signalinspect.Handler` emits (the web `useSignalHistory`/`useSignalLog`/`useSignalDiff` declare
 * the stale `SignalPoint` alias, but the live endpoint returns this typed shape). [value] is carried
 * as the raw [JsonElement] so the typed primitive round-trips unchanged.
 */
@Serializable
public data class SignalHistoryPoint(
    val ts: String = "",
    val kind: String = "",
    val value: JsonElement? = null,
)

/**
 * `GET /signals/{id}/{signal}/history` — the port of the web `SignalHistoryResponse` shape returned
 * by `useSignalHistory`/`useSignalLog`/`useSignalDiff`. The three hooks differ only in the query
 * window they request (`hours`, `hours`+pagination, or `from`/`to`); the body shape is identical.
 */
@Serializable
public data class SignalHistoryResponse(
    @SerialName("vehicle_id") val vehicleId: Long = 0,
    val signal: String = "",
    val from: String = "",
    val to: String = "",
    val count: Long = 0,
    val data: List<SignalHistoryPoint> = emptyList(),
)

/** One entry in a point-in-time snapshot — the port of the web `SignalSnapshotEntry`. */
@Serializable
public data class SignalSnapshotEntry(
    val value: JsonElement? = null,
    val timestamp: String? = null,
    val source: String? = null,
    @SerialName("age_ms") val ageMs: Long? = null,
)

/** `GET /signals/{id}/snapshot` — the port of the web `SignalSnapshotResponse` (`useSignalSnapshot`). */
@Serializable
public data class SignalSnapshotResponse(
    @SerialName("vehicle_id") val vehicleId: Long = 0,
    val at: String? = null,
    val count: Long = 0,
    val signals: Map<String, SignalSnapshotEntry> = emptyMap(),
)

/** One changed/unchanged row in a server-side diff — the port of the web `SignalDiffRow`. */
@Serializable
public data class SignalDiffRow(
    val name: String = "",
    @SerialName("value_a") val valueA: JsonElement? = null,
    @SerialName("value_b") val valueB: JsonElement? = null,
    @SerialName("source_a") val sourceA: String? = null,
    @SerialName("source_b") val sourceB: String? = null,
    @SerialName("age_ms_a") val ageMsA: Long? = null,
    @SerialName("age_ms_b") val ageMsB: Long? = null,
    val changed: Boolean = false,
)

/** `GET /signals/{id}/diff` — the port of the web `SignalDiffServerResponse` (`useSignalDiffServer`). */
@Serializable
public data class SignalDiffServerResponse(
    @SerialName("vehicle_id") val vehicleId: Long = 0,
    @SerialName("at_a") val atA: String = "",
    @SerialName("at_b") val atB: String = "",
    val count: Long = 0,
    val data: List<SignalDiffRow> = emptyList(),
)

/** `GET /tesla/fleet-telemetry/error-vins` — the port of the web `FleetTelemetryErrorVIN`. */
@Serializable
public data class FleetTelemetryErrorVIN(
    val id: Long = 0,
    val vin: String = "",
    val active: Boolean = false,
    @SerialName("first_seen_at") val firstSeenAt: String = "",
    @SerialName("last_seen_at") val lastSeenAt: String = "",
    @SerialName("resolved_at") val resolvedAt: String? = null,
)

/** `GET /tesla/fleet-telemetry/errors` — the port of the web `FleetTelemetryError`. */
@Serializable
public data class FleetTelemetryError(
    val id: Long = 0,
    val vin: String = "",
    @SerialName("error_code") val errorCode: String? = null,
    @SerialName("error_message") val errorMessage: String? = null,
    @SerialName("reported_at") val reportedAt: String? = null,
    @SerialName("tesla_updated_at") val teslaUpdatedAt: String? = null,
    @SerialName("fetched_at") val fetchedAt: String = "",
)

/**
 * `GET /signals/catalog` — the port of the web `SignalCatalogEntry` (`@/types/signals`) that
 * `useSignalCatalog` declares. DEPRECATED upstream: the backend `/signals/catalog` route was deleted,
 * so this read reliably 404s in production; it is ported verbatim (not dropped) because the web hook
 * file still declares it and its consumers surface the resulting error gracefully.
 */
@Serializable
public data class SignalCatalogEntry(
    val name: String = "",
    @SerialName("value_type") val valueType: String = "",
    @SerialName("source_module") val sourceModule: String = "",
    val unit: String? = null,
    val description: String? = null,
    @SerialName("first_seen_at") val firstSeenAt: String = "",
    @SerialName("last_seen_at") val lastSeenAt: String = "",
)

/**
 * `GET /signals/{vehicleID}/live` — the port of the web `VehicleLiveSignalsResponse`
 * (`useVehicleLiveSignals`). Each value in [signals] is carried as the raw per-field [JsonElement]
 * the web hook surfaces untouched (`{ value, timestamp }` or a bare scalar).
 */
@Serializable
public data class VehicleLiveSignalsResponse(
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    val signals: Map<String, JsonElement> = emptyMap(),
)

// ─── Derived models ─────────────────────────────────────────────────────────────────

/**
 * One adapted row of `GET /signals/observations` — the port of the web `SignalObservation`
 * (`@/types/signals`). Produced by [TelemetryDerivations.adaptObservations], which bridges the modern
 * enveloped `{value, value_kind}` contract back onto the legacy `value_numeric`/`value_text`/
 * `value_bool` trio every web consumer (`latestNumeric`/`latestText`/`latestBool`) still reads.
 */
public data class SignalObservation(
    val vehicleId: Long,
    val ts: String,
    val signalName: String,
    val valueNumeric: Double?,
    val valueText: String?,
    val valueBool: Boolean?,
    val source: String,
)

/**
 * One streaming vehicle in the MQTT telemetry status — the port of the web `VehicleTelemetry`
 * (`@/types/telemetry`) AFTER the `useMQTTStatus` normalization (`signalCount ?? signal_count ?? 0`,
 * etc., with [vin] injected from the record key when the backend ships the camelCase/snake_case
 * `Record<vin, VehicleStreamState>` shape).
 */
public data class VehicleTelemetry(
    val vin: String,
    val vehicleId: Long?,
    val state: String?,
    val signalCount: Long,
    val batchCount: Long,
    val signalsPerSecond: Double?,
    val lastReceived: String?,
    val isStreaming: Boolean?,
    val dataSource: String?,
    val latencyMs: Double?,
)

/**
 * `GET /telemetry` — the port of the web `TelemetryStatus` AFTER the `useMQTTStatus` normalization:
 * [vehicles] is always the array form (the backend's `Record<vin, …>` map is flattened with the key
 * injected as `vin`), and [uptimeSeconds] coalesces the camelCase/snake_case variants.
 */
public data class TelemetryStatus(
    val connected: Boolean,
    val broker: String?,
    val uptimeSeconds: Double?,
    val vehicles: List<VehicleTelemetry>,
    val topics: List<String>,
)

/**
 * The pure client-side derivations ported from `useTelemetry.ts`, extracted as side-effect-free
 * functions so the KMP state holder, its golden vectors, and the Windows C# port all transform
 * identically and can never drift (ADR-004). Each takes the raw server [JsonElement] (exactly what
 * the cache stores) and returns the same shape the web hook's `queryFn`/`select` yields.
 */
public object TelemetryDerivations {
    // ValueKind buckets emitted by `protomodel.ValueKind.String()` — the web `NUMERIC/TEXT/BOOL`
    // sets in useTelemetry.ts, grouped by how the legacy `SignalObservation` shape stores them.
    private val NUMERIC_VALUE_KINDS =
        setOf(
            "ValueKindFloat",
            "ValueKindDouble",
            "ValueKindInt32",
            "ValueKindInt64",
            "ValueKindUnixTime",
        )
    private val TEXT_VALUE_KINDS = setOf("ValueKindString", "ValueKindEnum")
    private val BOOL_VALUE_KINDS = setOf("ValueKindBool", "ValueKindBoolean")

    /** The source every adapted observation defaults to — the web `adaptObservations` constant. */
    public const val OBSERVATION_SOURCE: String = "fleet_telemetry"

    /**
     * `useSignals` `queryFn` + `select: safeArray` — normalizes the rich `/available` catalog (or the
     * legacy bare-array / `{signals}` shapes) down to a flat `string[]` of signal names. A string entry
     * is taken verbatim; an object entry contributes its non-empty `name`; everything else is dropped.
     */
    public fun signalNames(raw: JsonElement?): List<String> {
        val arr: List<JsonElement> =
            when (raw) {
                is JsonArray -> raw
                is JsonObject -> (raw["signals"] as? JsonArray) ?: emptyList()
                else -> emptyList()
            }
        return arr.mapNotNull { entry ->
            when (entry) {
                is JsonPrimitive -> if (entry.isString && entry.content.isNotEmpty()) entry.content else null
                is JsonObject -> {
                    val name = entry["name"] as? JsonPrimitive
                    if (name != null && name.isString && name.content.isNotEmpty()) name.content else null
                }
                else -> null
            }
        }
    }

    /**
     * `useSignalGaps` `queryFn` — `res.signals ?? {}`. Returns the per-field live map verbatim (each
     * entry the raw `{value, timestamp}` element), defaulting an absent/`null` `signals` to empty.
     */
    public fun signalGaps(raw: JsonElement?): Map<String, JsonElement> {
        val signals = (raw as? JsonObject)?.get("signals") as? JsonObject ?: return emptyMap()
        return buildMap { signals.forEach { (field, value) -> put(field, value) } }
    }

    /**
     * `adaptObservations` — unwraps the modern `{count, total, observations: [{vehicle_id, ts, field,
     * value_kind, value}]}` envelope onto the legacy `SignalObservation` rows. Each row's single
     * `value` is steered into `value_numeric`/`value_text`/`value_bool` by its `value_kind`
     * discriminator; compound/unknown kinds fall through to all-null. Locked by golden vectors.
     */
    public fun adaptObservations(raw: JsonElement?): List<SignalObservation> {
        val rows = (raw as? JsonObject)?.get("observations") as? JsonArray ?: return emptyList()
        return rows.mapNotNull { it as? JsonObject }.map { row ->
            val kind = row.stringOf("value_kind", "valueKind") ?: ""
            val field = row.stringOf("field") ?: ""
            val vehicleId = row.longOf("vehicle_id", "vehicleId") ?: 0L
            val value = row["value"]

            var valueNumeric: Double? = null
            var valueText: String? = null
            var valueBool: Boolean? = null

            when {
                kind in NUMERIC_VALUE_KINDS -> valueNumeric = jsNumber(value)
                kind in TEXT_VALUE_KINDS -> valueText = jsString(value)
                kind in BOOL_VALUE_KINDS -> valueBool = jsBool(value)
            }

            SignalObservation(
                vehicleId = vehicleId,
                ts = row.stringOf("ts") ?: "",
                signalName = field,
                valueNumeric = valueNumeric,
                valueText = valueText,
                valueBool = valueBool,
                source = OBSERVATION_SOURCE,
            )
        }
    }

    /**
     * `useMQTTStatus` `queryFn` — normalizes `GET /telemetry` so [TelemetryStatus.vehicles] is always
     * the array form (the backend `Record<vin, VehicleStreamState>` is flattened with the key injected
     * as `vin`) and the camelCase/snake_case counterparts of each field are coalesced. Locked by golden
     * vectors.
     */
    public fun normalizeMqttStatus(raw: JsonElement?): TelemetryStatus {
        val obj = raw as? JsonObject ?: JsonObject(emptyMap())
        val vehiclesRaw = obj["vehicles"] ?: obj["streaming_vehicles"]
        val vehicles: List<VehicleTelemetry> =
            when (vehiclesRaw) {
                is JsonArray ->
                    vehiclesRaw.mapNotNull { it as? JsonObject }.map { parseVehicle(it, vinOverride = null) }
                is JsonObject ->
                    vehiclesRaw.mapNotNull { (vin, v) -> (v as? JsonObject)?.let { parseVehicle(it, vinOverride = vin) } }
                else -> emptyList()
            }
        return TelemetryStatus(
            connected = obj.boolOf("connected") ?: false,
            broker = obj.stringOf("broker"),
            uptimeSeconds = obj.numberOf("uptimeSeconds", "uptime_seconds"),
            vehicles = vehicles,
            topics =
                (obj["topics"] as? JsonArray)
                    ?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
                    ?: emptyList(),
        )
    }

    private fun parseVehicle(
        v: JsonObject,
        vinOverride: String?,
    ): VehicleTelemetry =
        VehicleTelemetry(
            vin = vinOverride ?: v.stringOf("vin") ?: "",
            vehicleId = v.longOf("vehicleId", "vehicle_id"),
            state = v.stringOf("state"),
            signalCount = v.longOf("signalCount", "signal_count") ?: 0L,
            batchCount = v.longOf("batchCount", "batch_count") ?: 0L,
            signalsPerSecond = v.numberOf("signalsPerSecond", "signals_per_second"),
            lastReceived = v.stringOf("lastReceived", "last_received"),
            isStreaming = v.boolOf("is_streaming"),
            dataSource = v.stringOf("data_source"),
            latencyMs = v.numberOf("latency_ms"),
        )

    // ---- JS-coercion helpers (the web `adaptObservations` value steering) ----------

    /** JS `row.value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null`. */
    private fun jsNumber(value: JsonElement?): Double? {
        if (value == null || value is JsonNull) return null
        val prim = value as? JsonPrimitive ?: return null
        val n =
            when {
                !prim.isString -> prim.doubleOrNull ?: prim.booleanOrNull?.let { if (it) 1.0 else 0.0 }
                prim.content.isEmpty() -> 0.0 // JS Number('') === 0
                else -> prim.content.trim().toDoubleOrNull() // parity:allow stdlib numeric coercion
            }
        return if (n != null && n.isFinite()) n else null
    }

    /** JS `row.value == null ? null : String(value)`. */
    private fun jsString(value: JsonElement?): String? {
        if (value == null || value is JsonNull) return null
        val prim = value as? JsonPrimitive ?: return value.toString()
        return prim.content
    }

    /** JS `typeof value === 'boolean' ? value : null`. */
    private fun jsBool(value: JsonElement?): Boolean? {
        val prim = value as? JsonPrimitive ?: return null
        if (prim.isString) return null
        return prim.booleanOrNull
    }

    // ---- Raw JSON accessors --------------------------------------------------------

    private fun JsonObject.stringOf(vararg keys: String): String? {
        for (key in keys) {
            val prim = this[key] as? JsonPrimitive ?: continue
            if (prim is JsonNull) continue
            return prim.content
        }
        return null
    }

    private fun JsonObject.longOf(vararg keys: String): Long? {
        for (key in keys) {
            (this[key] as? JsonPrimitive)?.longOrNull?.let { return it }
        }
        return null
    }

    private fun JsonObject.numberOf(vararg keys: String): Double? {
        for (key in keys) {
            (this[key] as? JsonPrimitive)?.doubleOrNull?.let { return it }
        }
        return null
    }

    private fun JsonObject.boolOf(vararg keys: String): Boolean? {
        for (key in keys) {
            (this[key] as? JsonPrimitive)?.booleanOrNull?.let { return it }
        }
        return null
    }
}
