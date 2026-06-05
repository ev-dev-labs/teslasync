package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.signals.AvailableSignalsResponse
import io.teslasync.shared.core.presentation.signals.LiveSignalsResponse
import io.teslasync.shared.core.presentation.signals.SignalDescriptor
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalHistoryRange
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalUnitKind
import io.teslasync.shared.core.presentation.signals.SignalValue
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/**
 * The S7 data port for the typed signal-inspector surface — the cross-platform analogue of the web
 * `useSignals` hook domain (web/src/api/hooks/useSignals.ts). Every native Signals screen
 * (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through this
 * interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The three reads stream a cache-then-network [Resource] (ADR-013): the cached value first for an
 * instant cold start, then the refreshed value. Each is cached under a stable per-feed key (see
 * [signalsAvailableKey] etc.) mirroring the web TanStack `signalKeys` tuples, with a per-read TTL
 * matching the web `staleTime` (available ⇒ SLOW/5m, live ⇒ REALTIME/5s, history ⇒ STANDARD/60s).
 *
 * Each read carries the SAME ValueKind/UnitKind normalization the web hooks perform in their
 * `queryFn`: the long-form `protomodel.ValueKind`/`UnitKind` strings (and the SSE integer enum) are
 * collapsed into the compact [SignalKind]/[SignalUnitKind] unions, and each `{kind, value, ts}`
 * envelope's typed primitive is surfaced directly via [coerceSignalValue]. These pure derivations
 * ([normalizeSignalKind], [normalizeUnitKind], [normalizeSignalEnvelope], [normalizeSignalDescriptor]
 * and the three response normalizers) are locked by golden vectors shared with the C# port so the
 * two ports cannot drift (ADR-004). Values stay SI (Phase-42 stores everything as SI on disk);
 * display formatting is the render boundary's job (S5), never this layer's.
 *
 * The domain is READ-ONLY — the web hook file declares zero mutations — so the port exposes no
 * mutation/invalidation API. The web `useLiveSignals` `refetchInterval` (poll every 5s) and the
 * `enabled` gates (`vehicleId > 0`, `signalName` non-empty) are render-layer concerns and are
 * intentionally NOT reproduced at this layer.
 */
public interface SignalsRepository {
    /**
     * `GET /signals/{vehicleId}/available` — the typed catalog of every Tesla telemetry field the
     * backend exposes (web `useAvailableSignals`). Each entry's `value_kind`/`unit_kind` is
     * normalized into the compact [SignalKind]/[SignalUnitKind] discriminators. Cached under
     * [signalsAvailableKey].
     */
    public fun availableSignals(vehicleId: Long): Flow<Resource<AvailableSignalsResponse>>

    /**
     * `GET /signals/{vehicleId}/live` — the current per-field typed envelope keyed by the canonical
     * proto field name (web `useLiveSignals`). Each value is normalized into a [SignalEnvelope].
     * Cached under [signalsLiveKey]. The web `refetchInterval` is a render-layer concern.
     */
    public fun liveSignals(vehicleId: Long): Flow<Resource<LiveSignalsResponse>>

    /**
     * `GET /signals/{vehicleId}/{signalName}/history` — the typed time-series for a single signal
     * (web `useSignalHistory`). [range] controls the window via [signalHistoryQuery]: `from`/`to`
     * win when both are present, otherwise `hours`; `limit` is sent only when > 0. Cached under
     * [signalsHistoryKey].
     */
    public fun signalHistory(
        vehicleId: Long,
        signalName: String,
        range: SignalHistoryRange = SignalHistoryRange(),
    ): Flow<Resource<SignalHistoryResponse>>
}

// ---- Per-read staleness thresholds (web `staleTime`, ms) --------------------------

/** [SignalsRepository.availableSignals] TTL — the web `STALE_TIMES.SLOW` (5 minutes). */
public const val SIGNALS_AVAILABLE_TTL_MILLIS: Long = 5 * 60_000L

/** [SignalsRepository.liveSignals] TTL — the web `STALE_TIMES.REALTIME` (5 seconds). */
public const val SIGNALS_LIVE_TTL_MILLIS: Long = 5_000L

/** [SignalsRepository.signalHistory] TTL — the web `STALE_TIMES.STANDARD` (60 seconds). */
public const val SIGNALS_HISTORY_TTL_MILLIS: Long = 60_000L

// ---- Cache/feed keys (mirror the web `signalKeys` tuples) --------------------------

/** The tuple separator used by every Signals cache key. */
internal const val SIGNALS_KEY_SEP: String = "|"

/** The `signalKeys` family head (`['typed-signals', …]`). */
public const val SIGNALS_FAMILY: String = "typed-signals"

/** Cache/feed key for [SignalsRepository.availableSignals] — the web `signalKeys.available(id)` (`['typed-signals','available',id]`). */
public fun signalsAvailableKey(vehicleId: Long): String =
    listOf(SIGNALS_FAMILY, "available", vehicleId.toString()).joinToString(SIGNALS_KEY_SEP)

/** Cache/feed key for [SignalsRepository.liveSignals] — the web `signalKeys.live(id)` (`['typed-signals','live',id]`). */
public fun signalsLiveKey(vehicleId: Long): String = listOf(SIGNALS_FAMILY, "live", vehicleId.toString()).joinToString(SIGNALS_KEY_SEP)

/**
 * Cache/feed key for [SignalsRepository.signalHistory] — the web
 * `signalKeys.history(id, name, hours, from ?? '', to ?? '', limit ?? 0)` tuple
 * (`['typed-signals','history',id,name,hours,from,to,limit]`). The resolved [SignalHistoryRange.hours]
 * is always part of the key (even when `from`/`to` are present), exactly as the web key builder does.
 */
public fun signalsHistoryKey(
    vehicleId: Long,
    signalName: String,
    range: SignalHistoryRange,
): String =
    listOf(
        SIGNALS_FAMILY,
        "history",
        vehicleId.toString(),
        signalName,
        range.hours.toString(),
        range.from ?: "",
        range.to ?: "",
        (range.limit ?: 0).toString(),
    ).joinToString(SIGNALS_KEY_SEP)

// ---- Query builder (web param semantics, snake_case) ------------------------------

/**
 * The `/signals/{id}/{name}/history` query — the port of the `URLSearchParams` built by the web
 * `useSignalHistory`: when BOTH `from` and `to` are present AND non-blank they are sent and `hours`
 * is omitted (the web `if (range.from && range.to)` truthy guard); otherwise `hours` is sent.
 * `limit` is appended only when present AND > 0. Locked by golden vectors shared with the C# port.
 */
public fun signalHistoryQuery(range: SignalHistoryRange): Map<String, String> {
    val query = linkedMapOf<String, String>()
    val from = range.from
    val to = range.to
    if (!from.isNullOrEmpty() && !to.isNullOrEmpty()) {
        query["from"] = from
        query["to"] = to
    } else {
        query["hours"] = range.hours.toString()
    }
    val limit = range.limit
    if (limit != null && limit > 0) query["limit"] = limit.toString()
    return query
}

// ---- ValueKind / UnitKind normalization (web `useSignals` derivations) ------------

/**
 * Maps the backend's `protomodel.ValueKind` — sent as the long-form string ("ValueKindFloat") by
 * `/live` and `/history`, or as the proto enum integer by SSE `signal_change` — into the compact
 * [SignalKind]. Total: every input collapses to exactly one bucket and unrecognised inputs become
 * [SignalKind.Unknown]. Mirrors the web `normalizeSignalKind`, including its numeric branch order
 * (`internal/tesla/protomodel/types.go`'s iota). Locked by golden vectors shared with the C# port.
 */
public fun normalizeSignalKind(raw: JsonElement?): SignalKind {
    val prim = raw as? JsonPrimitive ?: return SignalKind.Unknown
    if (!prim.isString) {
        prim.doubleOrNull?.let { n ->
            // JS `===` numeric equality: a float-encoded integer kind (e.g. 5.0) still matches.
            return when (n) {
                1.0 -> SignalKind.String
                2.0 -> SignalKind.Bool
                3.0, 4.0, 7.0 -> SignalKind.Int
                5.0, 6.0 -> SignalKind.Float
                9.0 -> SignalKind.Time
                else -> SignalKind.Unknown
            }
        }
    }
    return when (prim.content) {
        "ValueKindString", "string" -> SignalKind.String
        "ValueKindBool", "bool" -> SignalKind.Bool
        "ValueKindInt32", "ValueKindInt64", "ValueKindEnum", "int" -> SignalKind.Int
        "ValueKindFloat", "ValueKindDouble", "float" -> SignalKind.Float
        "ValueKindTime", "time" -> SignalKind.Time
        else -> SignalKind.Unknown
    }
}

/**
 * Maps the backend's `protomodel.UnitKind` (long-form "UnitKindDistance" or the compact form) into
 * the compact [SignalUnitKind], defaulting to [SignalUnitKind.None] for anything unrecognised — the
 * port of the web `normalizeUnitKind`/`UNIT_KIND_MAP`. Locked by golden vectors shared with the C#
 * port.
 */
public fun normalizeUnitKind(raw: JsonElement?): SignalUnitKind {
    val prim = raw as? JsonPrimitive ?: return SignalUnitKind.None
    if (!prim.isString) return SignalUnitKind.None
    return when (prim.content) {
        "UnitKindDistance", "distance" -> SignalUnitKind.Distance
        "UnitKindTemperature", "temperature" -> SignalUnitKind.Temperature
        "UnitKindPressure", "pressure" -> SignalUnitKind.Pressure
        "UnitKindCharge", "charge" -> SignalUnitKind.Charge
        "UnitKindNone", "none" -> SignalUnitKind.None
        "speed" -> SignalUnitKind.Speed
        else -> SignalUnitKind.None
    }
}

/**
 * Coerces a JSON-decoded raw value into the typed [SignalValue] for the resolved [kind] — the port
 * of the web `coerceValue`. The backend serialises each typed primitive as its native JSON type, so
 * the work is selecting the matching arm and falling back to [SignalValue.Null] when the typed
 * column was empty or the value cannot be coerced. Locked by golden vectors shared with the C# port.
 */
public fun coerceSignalValue(
    value: JsonElement?,
    kind: SignalKind,
): SignalValue {
    if (value == null || value is JsonNull) return SignalValue.Null
    val prim = value as? JsonPrimitive
    return when (kind) {
        SignalKind.String, SignalKind.Time ->
            SignalValue.Text(prim?.content ?: value.toString())
        SignalKind.Bool ->
            when {
                prim != null && !prim.isString && prim.booleanOrNull != null -> SignalValue.Bool(prim.booleanOrNull == true)
                else -> SignalValue.Bool(jsTruthy(value))
            }
        SignalKind.Int, SignalKind.Float -> {
            val n =
                when {
                    prim == null -> null
                    !prim.isString -> prim.doubleOrNull
                    else -> prim.content.toDoubleOrNull() // parity:allow stdlib numeric coercion
                }
            if (n != null && n.isFinite()) SignalValue.Num(n) else SignalValue.Null
        }
        SignalKind.Unknown ->
            when {
                prim == null -> SignalValue.Null
                prim.isString -> SignalValue.Text(prim.content)
                prim.booleanOrNull != null -> SignalValue.Bool(prim.booleanOrNull == true)
                prim.doubleOrNull != null -> SignalValue.Num(prim.doubleOrNull!!)
                else -> SignalValue.Null
            }
    }
}

/**
 * Coerces a raw `{kind, value, ts}` object into a typed [SignalEnvelope] — the port of the web
 * `normalizeEnvelope`. A missing/`null` envelope collapses to an unknown-kind, null-value envelope.
 * Locked by golden vectors shared with the C# port.
 */
public fun normalizeSignalEnvelope(raw: JsonElement?): SignalEnvelope {
    val obj = raw as? JsonObject ?: return SignalEnvelope(SignalKind.Unknown, SignalValue.Null, "")
    val kind = normalizeSignalKind(obj["kind"])
    return SignalEnvelope(
        kind = kind,
        value = coerceSignalValue(obj["value"], kind),
        ts = obj.stringOrEmpty("ts"),
    )
}

/**
 * Coerces a raw available-catalog entry into a typed [SignalDescriptor] — the port of the web
 * `normalizeDescriptor`. Locked by golden vectors shared with the C# port.
 */
public fun normalizeSignalDescriptor(raw: JsonObject): SignalDescriptor =
    SignalDescriptor(
        name = raw.stringOrEmpty("name"),
        category = raw.stringOrEmpty("category"),
        valueKind = normalizeSignalKind(raw["value_kind"]),
        unitKind = normalizeUnitKind(raw["unit_kind"]),
        isCompound = raw.booleanOrFalse("is_compound"),
        isSettingUnit = raw.booleanOrFalse("is_setting_unit"),
    )

/**
 * Normalizes the raw `GET /signals/{id}/available` body into [AvailableSignalsResponse] — the port
 * of the web `useAvailableSignals` `queryFn` mapping. Locked by golden vectors shared with the C#
 * port.
 */
public fun normalizeAvailableResponse(raw: JsonElement): AvailableSignalsResponse {
    val obj = raw as? JsonObject ?: JsonObject(emptyMap())
    val signals =
        (obj["signals"] as? JsonArray)
            ?.mapNotNull { it as? JsonObject }
            ?.map(::normalizeSignalDescriptor)
            ?: emptyList()
    return AvailableSignalsResponse(
        vehicleId = obj.longOrZero("vehicle_id"),
        count = obj.intOrZero("count"),
        source = obj.stringOrEmpty("source"),
        signals = signals,
    )
}

/**
 * Normalizes the raw `GET /signals/{id}/live` body into [LiveSignalsResponse] — the port of the web
 * `useLiveSignals` `queryFn` mapping (each field's envelope normalized; a `null` slot becomes an
 * unknown-kind envelope). Locked by golden vectors shared with the C# port.
 */
public fun normalizeLiveResponse(raw: JsonElement): LiveSignalsResponse {
    val obj = raw as? JsonObject ?: JsonObject(emptyMap())
    val signalsObj = obj["signals"] as? JsonObject
    val signals =
        buildMap {
            signalsObj?.forEach { (field, env) -> put(field, normalizeSignalEnvelope(env)) }
        }
    return LiveSignalsResponse(
        vehicleId = obj.longOrZero("vehicle_id"),
        count = obj.intOrZero("count"),
        at = obj.stringOrEmpty("at"),
        signals = signals,
    )
}

/**
 * Normalizes the raw `GET /signals/{id}/{name}/history` body into [SignalHistoryResponse] — the port
 * of the web `useSignalHistory` `queryFn` mapping. Locked by golden vectors shared with the C# port.
 */
public fun normalizeHistoryResponse(raw: JsonElement): SignalHistoryResponse {
    val obj = raw as? JsonObject ?: JsonObject(emptyMap())
    val data = (obj["data"] as? JsonArray)?.map(::normalizeSignalEnvelope) ?: emptyList()
    return SignalHistoryResponse(
        vehicleId = obj.longOrZero("vehicle_id"),
        signal = obj.stringOrEmpty("signal"),
        expectedKind = obj.stringOrEmpty("expected_kind"),
        from = obj.stringOrEmpty("from"),
        to = obj.stringOrEmpty("to"),
        count = obj.intOrZero("count"),
        data = data,
    )
}

// ---- Internal JSON accessors ------------------------------------------------------

private fun JsonObject.stringOrEmpty(key: String): String {
    val prim = this[key] as? JsonPrimitive ?: return ""
    if (prim is JsonNull) return ""
    return prim.content
}

private fun JsonObject.longOrZero(key: String): Long = (this[key] as? JsonPrimitive)?.longOrNull ?: 0L

private fun JsonObject.intOrZero(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0

private fun JsonObject.booleanOrFalse(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

/** JS `Boolean(value)` truthiness, used only for the rare non-boolean value behind a `bool` kind. */
private fun jsTruthy(element: JsonElement): Boolean {
    val prim = element as? JsonPrimitive ?: return true
    if (prim.isString) return prim.content.isNotEmpty()
    prim.booleanOrNull?.let { return it }
    prim.doubleOrNull?.let { return it != 0.0 && !it.isNaN() }
    return prim.content.isNotEmpty()
}
