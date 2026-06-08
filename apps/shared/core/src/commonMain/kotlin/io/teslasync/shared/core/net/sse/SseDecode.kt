package io.teslasync.shared.core.net.sse

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/** Lenient JSON used to decode SSE `data:` payloads (ignores unknown server fields). */
internal val sseJson: Json =
    Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

/**
 * Decodes one [SseFrame] into a typed [LiveEvent]. Never returns `null`: an unnamed,
 * unrecognised, or malformed-but-named frame degrades to [LiveEvent.Unknown] carrying
 * the raw payload, so a single bad frame never silently disappears or aborts the
 * stream (the web client surfaces parse errors out-of-band for the same reason).
 */
internal fun decodeEvent(frame: SseFrame): LiveEvent {
    val type = frame.event ?: "message"
    val raw = frame.data
    return when (type) {
        "connected" ->
            LiveEvent.Connected(
                clientId = stringField(raw, "client_id") ?: "",
                id = frame.id,
            )

        "heartbeat" -> LiveEvent.Heartbeat(time = stringField(raw, "time"), id = frame.id)
        "vehicle_update" -> objectEvent(type, raw, frame.id) { LiveEvent.VehicleUpdate(it, frame.id) }
        "alert" -> objectEvent(type, raw, frame.id) { LiveEvent.Alert(it, frame.id) }
        "export_status" -> objectEvent(type, raw, frame.id) { LiveEvent.ExportStatus(it, frame.id) }
        "achievement_unlocked" ->
            objectEvent(type, raw, frame.id) { LiveEvent.AchievementUnlocked(it, frame.id) }

        "signal_change" -> {
            val obj = parseObject(raw)
            val envelope = obj?.let { decodeEnvelope(it) }
            if (envelope != null) {
                LiveEvent.Signal(envelope, frame.id)
            } else {
                LiveEvent.Unknown(type, raw, frame.id)
            }
        }

        else -> LiveEvent.Unknown(type, raw, frame.id)
    }
}

private inline fun objectEvent(
    type: String,
    raw: String,
    id: String?,
    build: (JsonObject) -> LiveEvent,
): LiveEvent {
    val obj = parseObject(raw)
    return if (obj != null) build(obj) else LiveEvent.Unknown(type, raw, id)
}

private fun parseObject(raw: String): JsonObject? =
    try {
        val element = sseJson.parseToJsonElement(raw)
        element as? JsonObject
    } catch (e: Exception) {
        null
    }

private fun stringField(
    raw: String,
    key: String,
): String? {
    val obj = parseObject(raw) ?: return null
    return (obj[key] as? JsonPrimitive)?.contentOrNull
}

/**
 * Decodes the flat `(kind, value)` pair into a typed [SignalEnvelope], mirroring the
 * web `parseEnvelope` validation: a missing/empty `field`, a missing/non-numeric
 * `vehicle_id`, or an unresolvable `kind` all yield `null` (the event degrades to
 * [LiveEvent.Unknown]).
 */
internal fun decodeEnvelope(obj: JsonObject): SignalEnvelope? {
    val kind = normalizeKind(obj["kind"]) ?: return null
    val field = (obj["field"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    if (field.isNullOrEmpty()) return null
    val vehicleId = (obj["vehicle_id"] as? JsonPrimitive)?.longOrNull ?: return null
    val ts = (obj["ts"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
    return SignalEnvelope(
        vehicleId = vehicleId,
        field = field,
        kind = kind,
        value = coerceValue(obj["value"], kind),
        ts = ts,
    )
}

// Long-form protomodel.ValueKind name -> compact kind (mirrors VALUE_KIND_LONG_TO_COMPACT).
private val valueKindLongToCompact: Map<String, SignalKind> =
    mapOf(
        "ValueKindString" to SignalKind.String,
        "ValueKindBool" to SignalKind.Bool,
        "ValueKindInt32" to SignalKind.Int,
        "ValueKindInt64" to SignalKind.Int,
        "ValueKindEnum" to SignalKind.Int,
        "ValueKindFloat" to SignalKind.Float,
        "ValueKindDouble" to SignalKind.Float,
        "ValueKindTime" to SignalKind.Time,
        "ValueKindUnknown" to SignalKind.Unknown,
        "ValueKindCompound" to SignalKind.Unknown,
        "ValueKindInvalid" to SignalKind.Unknown,
    )

// Integer ValueKind (iota order in internal/tesla/protomodel/types.go) -> compact kind.
private val valueKindIntToCompact: Map<Int, SignalKind> =
    mapOf(
        0 to SignalKind.Unknown,
        1 to SignalKind.String,
        2 to SignalKind.Bool,
        3 to SignalKind.Int,
        4 to SignalKind.Int,
        5 to SignalKind.Float,
        6 to SignalKind.Float,
        7 to SignalKind.Int,
        8 to SignalKind.Unknown,
        9 to SignalKind.Time,
    )

private val compactKindByName: Map<String, SignalKind> =
    SignalKind.entries.associateBy { it.name.lowercase() }

private fun normalizeKind(element: JsonElement?): SignalKind? {
    val primitive = element as? JsonPrimitive ?: return null
    if (!primitive.isString) {
        val asInt = primitive.longOrNull?.toInt()
        return if (asInt != null) valueKindIntToCompact[asInt] else null
    }
    val text = primitive.content
    compactKindByName[text.lowercase()]?.let { return it }
    return valueKindLongToCompact[text]
}

private fun coerceValue(
    element: JsonElement?,
    kind: SignalKind,
): SignalValue {
    if (element == null || element is JsonNull) return SignalValue.NullValue
    val primitive = element as? JsonPrimitive ?: return SignalValue.NullValue
    return when (kind) {
        SignalKind.Int, SignalKind.Float -> {
            val number = primitive.doubleOrNull ?: primitive.content.toDoubleOrNull() // parity:allow stdlib numeric coercion
            if (number != null) SignalValue.NumberValue(number) else SignalValue.NullValue
        }

        SignalKind.Bool ->
            SignalValue.BoolValue(primitive.booleanOrNull ?: primitive.content.equals("true", ignoreCase = true))

        SignalKind.String -> SignalValue.StringValue(primitive.content)
        SignalKind.Time -> SignalValue.TimeValue(primitive.content)
        SignalKind.Unknown -> coerceUnknown(primitive)
    }
}

private fun coerceUnknown(primitive: JsonPrimitive): SignalValue {
    if (!primitive.isString) {
        primitive.doubleOrNull?.let { return SignalValue.NumberValue(it) }
        primitive.booleanOrNull?.let { return SignalValue.BoolValue(it) }
    }
    return SignalValue.StringValue(primitive.content)
}
