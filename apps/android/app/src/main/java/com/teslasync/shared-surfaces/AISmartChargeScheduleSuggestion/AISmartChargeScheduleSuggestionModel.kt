// Pure, framework-free model for the AISmartChargeScheduleSuggestion shared surface — the native analogue of
// every value the web component derives before returning JSX (web/src/components/ai/
// AISmartChargeScheduleSuggestion.tsx, rendered through its AIFeatureCard scaffold + the useAiStream SSE hook +
// the withAiFeature off-mode gate). No Compose, no Android UI, no HTTP: every declaration here is exercised
// off-device by the :android:testReleaseUnitTest gate, keeping the composable a thin render layer and the stream
// holder a thin lifecycle layer over these pure functions.
//
// AISmartChargeScheduleSuggestion is the "Draft a schedule with Helix" card on the smart-charge page. The web
// component builds a deterministic charge-plan request (`useMemo`) and POSTs it to `/ai/charging/schedule/draft`
// via `useAiStream`, accumulating the streamed `delta.text` into a single proposed schedule and surfacing the
// idle → streaming → done / error lifecycle through AIFeatureCard + AiOutputPanel. This file owns the parts the
// web render + hook derive from that contract:
//   • the draft endpoint path — web `useAiStream({ url: '/ai/charging/schedule/draft' })` ([SCHEDULE_DRAFT_PATH]);
//   • the request body — web `useMemo(() => ({ vehicle_id, target_soc, depart_by, … }))` then
//     `JSON.stringify(body)`, including the same per-field defaults and the depart_by ISO normalization
//     (web `new Date(departBy).toISOString()` with a now fallback), in [draftRequestBody] + [normalizeDepartBy];
//   • the action-readiness predicate — web `canStart={!!vehicleId && !!ratePlanId}` ([isScheduleReady], with the
//     honest offline gate the P3 action-surface contract adds);
//   • the SSE wire parser — web `parseSSEFrame` + `toTypedEvent` (event:/data: lines, blank-line-delimited
//     frames, JSON `data` payloads narrowed into the typed [AiStreamEvent] union, unknown/malformed frames
//     dropped) over the chunk re-assembly the web reader loop does ([SseFrameAccumulator]);
//   • the stream reducer — web `handleEvent` (`delta` appends text + flips to streaming, `done` settles,
//     `error` carries the message; tool/confirm frames update no surface state for this propose-only card),
//     in [reduceSchedule] over [ScheduleDraftUiState];
//   • the withAiFeature('smart-charge-schedule-suggestion') off-mode gate — web `useAiEnabled` (a registered
//     feature id, a non-off `ai_mode`, and a per-feature `ai_features[id] === true` opt-in), in
//     [isSmartChargeScheduleEnabled].
//
// Binding (P1/S8): this surface performs NO HTTP from the view. The streamed bytes arrive over an injected
// [io.teslasync.android.sharedsurfaces.aismartchargeschedulesuggestion.ScheduleDraftTransport] seam the host
// wires to the shared resilient client; the lifecycle is owned by the co-located
// SmartChargeScheduleDraftController state holder. This file is the pure adapter both are unit-tested over.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AISmartChargeScheduleSuggestion — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aismartchargeschedulesuggestion

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** The web AI feature id this surface is gated by (`withAiFeature('smart-charge-schedule-suggestion', …)`). */
const val SMART_CHARGE_SCHEDULE_FEATURE_ID: String = "smart-charge-schedule-suggestion"

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no PII. */
const val SMART_CHARGE_SCHEDULE_SLUG: String = "AISmartChargeScheduleSuggestion"

/** The draft endpoint the web hook streams against (`useAiStream({ url: '/ai/charging/schedule/draft' })`). */
const val SCHEDULE_DRAFT_PATH: String = "/ai/charging/schedule/draft"

/** The `ai_mode` value that fully disables every AI surface (ADR-015 §I1). */
internal const val AI_MODE_OFF: String = "off"

/** Settings document key for the global AI mode (web `settings.ai_mode`). */
internal const val AI_MODE_KEY: String = "ai_mode"

/** Settings document key for the per-feature opt-in map (web `settings.ai_features`). */
internal const val AI_FEATURES_KEY: String = "ai_features"

/** Default `finish_reason` when a `done` frame omits one (web `toTypedEvent` default `'stop'`). */
internal const val DEFAULT_FINISH_REASON: String = "stop"

/** Default error message when an `error` frame omits one (web `toTypedEvent` default `'unknown'`). */
internal const val UNKNOWN_ERROR: String = "unknown"

// ── Request body field names (web `useMemo` body keys) ──────────────────────────────────────────────
internal const val VEHICLE_ID_FIELD: String = "vehicle_id"
internal const val TARGET_SOC_FIELD: String = "target_soc"
internal const val DEPART_BY_FIELD: String = "depart_by"
internal const val RATE_PLAN_ID_FIELD: String = "rate_plan_id"
internal const val MAX_AMPS_FIELD: String = "max_amps"
internal const val BATTERY_CAPACITY_KWH_FIELD: String = "battery_capacity_kwh"
internal const val CHARGER_VOLTAGE_FIELD: String = "charger_voltage"
internal const val PREFER_OFF_PEAK_FIELD: String = "prefer_off_peak"
internal const val CURRENT_SOC_FIELD: String = "current_soc"

// ── Request body defaults (web `?? <default>` fallbacks) ────────────────────────────────────────────
internal const val DEFAULT_TARGET_SOC: Int = 80
internal const val DEFAULT_CURRENT_SOC: Int = 20
internal const val DEFAULT_MAX_AMPS: Int = 32
internal const val DEFAULT_BATTERY_CAPACITY_KWH: Int = 75
internal const val DEFAULT_CHARGER_VOLTAGE: Int = 240
internal const val DEFAULT_PREFER_OFF_PEAK: Boolean = true

/** Fallback vehicle id when the prop is absent / non-numeric (web `numericVehicleId || 0`). */
internal const val DEFAULT_VEHICLE_ID: Long = 0L

/** Lenient JSON reader for SSE `data:` payloads — unknown keys are ignored, matching the web parser. */
private val scheduleJson: Json = Json { ignoreUnknownKeys = true }

/**
 * The charge-plan inputs the smart-charge page feeds the card — the native mirror of the web `InnerSection`
 * props (`vehicleId`, `targetSoc`, `currentSoc`, `departBy`, `ratePlanId`, `maxAmps`, `batteryCapacityKwh`,
 * `chargerVoltage`, `preferOffPeak`). All fields are optional; the web `useMemo` supplies the same per-field
 * defaults when a value is absent. `vehicleId` is a string (the web type is `string | number`; the page feeds a
 * route id), coerced to the numeric `vehicle_id` the body carries by [parseVehicleId].
 *
 * @property vehicleId the selected vehicle id; absent / blank leaves [isScheduleReady] false.
 * @property targetSoc the target state-of-charge percent (web default 80).
 * @property currentSoc the current state-of-charge percent (web default 20).
 * @property departBy the desired departure as a `datetime-local` or ISO string; normalized by [normalizeDepartBy].
 * @property ratePlanId the selected time-of-use rate plan; absent / blank leaves [isScheduleReady] false.
 * @property maxAmps the charger current limit in amps (web default 32).
 * @property batteryCapacityKwh the pack capacity in kWh (web default 75).
 * @property chargerVoltage the charger voltage (web default 240).
 * @property preferOffPeak whether to bias the schedule to off-peak windows (web default true).
 */
data class SmartChargeInputs(
    val vehicleId: String? = null,
    val targetSoc: Int? = null,
    val currentSoc: Int? = null,
    val departBy: String? = null,
    val ratePlanId: String? = null,
    val maxAmps: Int? = null,
    val batteryCapacityKwh: Int? = null,
    val chargerVoltage: Int? = null,
    val preferOffPeak: Boolean? = null,
)

/** The lifecycle the draft stream moves through — the native analogue of the web `AiStreamState`. */
enum class SchedulePhase {
    /** No stream started yet (web `'idle'`). */
    Idle,

    /** A stream is open; text accumulates as `delta` frames arrive (web `'streaming'`). */
    Streaming,

    /** The stream settled successfully (web `'done'`); the schedule is the final proposed plan. */
    Done,

    /** The stream ended in error (web `'error'`); [ScheduleDraftUiState.error] carries the message. */
    Failed,
}

/**
 * The render-ready stream state — the native mirror of the slice of `useAiStream`'s result the AIFeatureCard +
 * AiOutputPanel read (`state` / `text` / `error`). Pure (no Compose types) so it is fully unit-tested
 * off-device; the composable only resolves localized labels and draws this.
 *
 * @property phase the lifecycle phase (web `stream.state`).
 * @property schedule the accumulated `delta.text` proposed schedule (web `stream.text`); empty until a delta.
 * @property error the terminal error message when [phase] is [SchedulePhase.Failed] (web `stream.error`).
 */
data class ScheduleDraftUiState(
    val phase: SchedulePhase = SchedulePhase.Idle,
    val schedule: String = "",
    val error: String? = null,
) {
    /** A stream is in flight (web `state === 'streaming'`); the action is disabled and shows progress. */
    val isStreaming: Boolean get() = phase == SchedulePhase.Streaming

    /** The stream settled successfully (web `state === 'done'`). */
    val isDone: Boolean get() = phase == SchedulePhase.Done

    /** The stream ended in error (web `state === 'error'`). */
    val isFailed: Boolean get() = phase == SchedulePhase.Failed

    /** No stream has run yet (web `state === 'idle'`); the card shows its ready presentation. */
    val isIdle: Boolean get() = phase == SchedulePhase.Idle

    /** At least one `delta` has accumulated schedule text (web `text.length > 0`). */
    val hasSchedule: Boolean get() = schedule.isNotEmpty()

    /**
     * Whether the output panel renders anything — the web `hasAnything = text.length > 0 || state ===
     * 'streaming' || state === 'error' || state === 'done'` rule. Idle with no text renders no panel (the card
     * itself is the non-blank ready surface).
     */
    val hasOutput: Boolean get() = hasSchedule || isStreaming || isDone || isFailed

    companion object {
        /** The pre-stream resting state shown before the user asks Helix for a schedule. */
        val IDLE: ScheduleDraftUiState = ScheduleDraftUiState()
    }
}

/**
 * Whether the action can fire — a present vehicle, a present rate plan, and connectivity. A port of the web
 * `canStart={!!vehicleId && !!ratePlanId}` plus the honest offline gate the P3 action-surface contract requires
 * (offline never opens a doomed stream). Pure so the button-enable rule is asserted off-device and shared by
 * both the controller guard and the composable.
 */
fun isScheduleReady(
    inputs: SmartChargeInputs,
    online: Boolean,
): Boolean = online && !inputs.vehicleId.isNullOrBlank() && !inputs.ratePlanId.isNullOrBlank()

/**
 * Coerces the [vehicleId] prop to the numeric `vehicle_id` the body carries — a port of the web
 * `numericVehicleId || 0` (`Number(vehicleId)` then `|| 0`). A blank / non-numeric id yields [DEFAULT_VEHICLE_ID]
 * (0), exactly as the web falls back when `Number(vehicleId)` is `NaN`.
 */
internal fun parseVehicleId(vehicleId: String?): Long = vehicleId?.trim()?.toLongOrNull() ?: DEFAULT_VEHICLE_ID

/**
 * Serializes the request body the draft stream POSTs — a port of the web `useMemo(() => ({ vehicle_id, … }))`
 * then `JSON.stringify(body)`. Produces the compact JSON with the same key order and the same per-field
 * defaults the web body uses, so the transport hands the shared client exactly the bytes the backend
 * `/ai/charging/schedule/draft` reads. [normalizeDepartBy] applies the web `depart_by` ISO normalization with
 * [now] as the same `new Date()` fallback and [zone] as the local zone a `datetime-local` value is read in.
 */
fun draftRequestBody(
    inputs: SmartChargeInputs,
    now: Instant,
    zone: ZoneId,
): String =
    buildJsonObject {
        put(VEHICLE_ID_FIELD, parseVehicleId(inputs.vehicleId))
        put(TARGET_SOC_FIELD, inputs.targetSoc ?: DEFAULT_TARGET_SOC)
        put(DEPART_BY_FIELD, normalizeDepartBy(inputs.departBy, now, zone))
        put(RATE_PLAN_ID_FIELD, inputs.ratePlanId ?: "")
        put(MAX_AMPS_FIELD, inputs.maxAmps ?: DEFAULT_MAX_AMPS)
        put(BATTERY_CAPACITY_KWH_FIELD, inputs.batteryCapacityKwh ?: DEFAULT_BATTERY_CAPACITY_KWH)
        put(CHARGER_VOLTAGE_FIELD, inputs.chargerVoltage ?: DEFAULT_CHARGER_VOLTAGE)
        put(PREFER_OFF_PEAK_FIELD, inputs.preferOffPeak ?: DEFAULT_PREFER_OFF_PEAK)
        put(CURRENT_SOC_FIELD, inputs.currentSoc ?: DEFAULT_CURRENT_SOC)
    }.toString()

/**
 * Normalizes the [departBy] input to an ISO-8601 UTC instant string — a port of the web
 * `departBy ? (Number.isNaN(new Date(departBy).getTime()) ? new Date() : new Date(departBy)) : new Date()` then
 * `.toISOString()`. A blank / null or unparseable value falls back to [now] (the web `new Date()` default); a
 * parseable value is read as an offset/instant when it carries one, otherwise as a local `datetime-local` in
 * [zone]. The result is always rendered in UTC with millisecond precision and a trailing `Z`, matching
 * `Date.prototype.toISOString`.
 */
fun normalizeDepartBy(
    departBy: String?,
    now: Instant,
    zone: ZoneId,
): String {
    val resolved = if (departBy.isNullOrBlank()) now else parseDepartInstant(departBy, zone) ?: now
    return ISO_INSTANT_MILLIS.format(resolved)
}

/**
 * Tolerantly parses a `depart_by` value into an [Instant] — an offset/zoned form first (web `new Date('…Z')`),
 * then a bare instant, then a local `datetime-local` form interpreted in [zone] (web `new Date('YYYY-MM-DDTHH:mm')`
 * read as local time). Returns `null` when nothing parses, so [normalizeDepartBy] applies the now fallback.
 */
private fun parseDepartInstant(
    raw: String,
    zone: ZoneId,
): Instant? =
    runCatching { OffsetDateTime.parse(raw).toInstant() }
        .recoverCatching { Instant.parse(raw) }
        .recoverCatching { LocalDateTime.parse(raw).atZone(zone).toInstant() }
        .getOrNull()

/** UTC, millisecond-precision ISO-8601 formatter matching `Date.prototype.toISOString` (`…T…:…:….SSSZ`). */
private val ISO_INSTANT_MILLIS: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

/**
 * The typed Server-Sent-Events union the draft stream can carry — a 1:1 port of the web `AiStreamEvent`
 * discriminated union (web/src/hooks/useAiStream.ts). The draft endpoint emits `delta` schedule fragments plus a
 * terminal `done`/`error` in practice, but the full union is reproduced so the parser is a faithful, reusable
 * port and so a future server frame can never crash an older client (unknown frames are dropped, not thrown).
 */
sealed interface AiStreamEvent {
    /** A streamed text fragment (web `{ type: 'delta', text }`); accumulated into the proposed schedule. */
    data class Delta(
        val text: String,
    ) : AiStreamEvent

    /** A tool invocation frame (web `{ type: 'tool_call', id, name }`); transcript-only, no surface state. */
    data class ToolCall(
        val id: String,
        val name: String,
    ) : AiStreamEvent

    /** A tool result frame (web `{ type: 'tool_result', id, name, ok }`); transcript-only, no surface state. */
    data class ToolResult(
        val id: String,
        val name: String,
        val ok: Boolean,
    ) : AiStreamEvent

    /** A human-in-the-loop confirm frame (web `{ type: 'confirm_request', … }`); unused by this card. */
    data class ConfirmRequest(
        val continuationId: String,
        val tool: String,
        val summary: String,
    ) : AiStreamEvent

    /** The terminal success frame (web `{ type: 'done', finish_reason }`). */
    data class Done(
        val finishReason: String,
    ) : AiStreamEvent

    /** The terminal error frame (web `{ type: 'error', message }`). */
    data class Failure(
        val message: String,
    ) : AiStreamEvent
}

/**
 * Reassembles the raw UTF-8 chunks an SSE transport emits into whole frames — the native analogue of the web
 * reader loop's blank-line buffering (`buffer.split(SSE_DELIM_RE)`, keeping the trailing partial fragment for
 * the next read). Stateful across [feed] calls; [drain] yields any final fragment that arrived without a
 * trailing blank line (web's post-loop `if (buffer.trim()) …`).
 */
class SseFrameAccumulator {
    private val buffer = StringBuilder()

    /**
     * Appends [chunk] and returns every complete frame now available, retaining the trailing partial frame.
     * Blank frames are skipped (web `if (!raw.trim()) continue`).
     */
    fun feed(chunk: String): List<String> {
        buffer.append(chunk)
        val parts = FRAME_DELIM.split(buffer.toString())
        val remainder = parts.last()
        buffer.setLength(0)
        buffer.append(remainder)
        return parts.dropLast(1).filter { it.isNotBlank() }
    }

    /** Returns the buffered trailing fragment (if non-blank) and clears it — the final-frame drain. */
    fun drain(): String? {
        val rest = buffer.toString()
        buffer.setLength(0)
        return rest.takeIf { it.isNotBlank() }
    }

    private companion object {
        /** SSE event terminator: a blank line, tolerating `\n\n` and `\r\n\r\n` (web `SSE_DELIM_RE`). */
        val FRAME_DELIM = Regex("\\r?\\n\\r?\\n")
    }
}

/**
 * Parses one SSE frame (its lines, without the trailing blank line) into a typed [AiStreamEvent] — a port of
 * the web `parseSSEFrame`. Reads the `event:` discriminator and the joined `data:` payload (tolerating the
 * one-space and no-space `event:`/`data:` forms), JSON-decodes the payload, and narrows it via [toTypedEvent].
 * Returns `null` for a frame with no event, a malformed JSON payload, or an unknown event type so the stream
 * loop skips it instead of corrupting the stream.
 */
fun parseSseFrame(raw: String): AiStreamEvent? {
    val frame = splitFrame(raw)
    if (frame.event.isEmpty()) return null
    return toTypedEvent(frame.event, parseData(frame.data))
}

/** The discriminator + raw `data` payload extracted from a frame's lines. */
private data class SseFrame(
    val event: String,
    val data: String,
)

private fun splitFrame(raw: String): SseFrame {
    var event = ""
    val dataParts = mutableListOf<String>()
    for (line in LINE_DELIM.split(raw)) {
        when {
            line.startsWith(":") -> Unit
            line.startsWith("event: ") -> event = line.substring("event: ".length)
            line.startsWith("data: ") -> dataParts.add(line.substring("data: ".length))
            line.startsWith("event:") -> event = line.substring("event:".length).trimStart()
            line.startsWith("data:") -> dataParts.add(line.substring("data:".length).trimStart())
        }
    }
    return SseFrame(event, dataParts.joinToString("\n"))
}

/** JSON-decodes a frame's `data` payload; an empty payload or malformed JSON yields `null` (web parity). */
private fun parseData(data: String): JsonElement? {
    if (data.isEmpty()) return null
    return runCatching { scheduleJson.parseToJsonElement(data) }.getOrNull()
}

/**
 * Narrows an `(event, data)` pair into the [AiStreamEvent] union — a port of the web `toTypedEvent`. A
 * non-object payload or a frame missing a required typed field yields `null` (the frame is dropped), exactly
 * as the web narrowing returns `null` for a malformed frame.
 */
private fun toTypedEvent(
    event: String,
    data: JsonElement?,
): AiStreamEvent? {
    val obj = data as? JsonObject ?: return null
    return when (event) {
        "delta" -> stringField(obj, "text")?.let { AiStreamEvent.Delta(it) }
        "tool_call" -> toolCall(obj)
        "tool_result" -> toolResult(obj)
        "confirm_request" -> confirmRequest(obj)
        "done" -> AiStreamEvent.Done(stringField(obj, "finish_reason") ?: DEFAULT_FINISH_REASON)
        "error" -> AiStreamEvent.Failure(stringField(obj, "message") ?: UNKNOWN_ERROR)
        else -> null
    }
}

private fun toolCall(obj: JsonObject): AiStreamEvent? {
    val id = stringField(obj, "id")
    val name = stringField(obj, "name")
    return if (id != null && name != null) AiStreamEvent.ToolCall(id, name) else null
}

private fun toolResult(obj: JsonObject): AiStreamEvent? {
    val id = stringField(obj, "id")
    val name = stringField(obj, "name")
    val ok = (obj["ok"] as? JsonPrimitive)?.booleanOrNull
    return if (id != null && name != null && ok != null) AiStreamEvent.ToolResult(id, name, ok) else null
}

private fun confirmRequest(obj: JsonObject): AiStreamEvent? {
    val continuationId = stringField(obj, "continuation_id")
    val tool = stringField(obj, "tool")
    val summary = stringField(obj, "summary")
    return if (continuationId != null && tool != null && summary != null) {
        AiStreamEvent.ConfirmRequest(continuationId, tool, summary)
    } else {
        null
    }
}

/** Reads [key] from [obj] only when it is a JSON string primitive (web `typeof d.x === 'string'`). */
private fun stringField(
    obj: JsonObject,
    key: String,
): String? = (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

/**
 * Applies an [event] to the current [state] — a port of the web `useAiStream` `handleEvent` plus its built-in
 * `delta.text` accumulator. A `delta` appends text and holds the stream open; `done`/`error` settle the
 * lifecycle. Tool and confirm frames update no surface state for this propose-only card (the web card neither
 * shows a transcript nor pauses), so they are folded through unchanged. Pure so every transition is asserted
 * off-device.
 */
fun reduceSchedule(
    state: ScheduleDraftUiState,
    event: AiStreamEvent,
): ScheduleDraftUiState =
    when (event) {
        is AiStreamEvent.Delta ->
            state.copy(phase = SchedulePhase.Streaming, schedule = state.schedule + event.text, error = null)

        is AiStreamEvent.Done -> state.copy(phase = SchedulePhase.Done)
        is AiStreamEvent.Failure -> state.copy(phase = SchedulePhase.Failed, error = event.message)
        is AiStreamEvent.ToolCall -> state
        is AiStreamEvent.ToolResult -> state
        is AiStreamEvent.ConfirmRequest -> state
    }

/**
 * The withAiFeature('smart-charge-schedule-suggestion') off-mode gate — a port of the web `useAiEnabled`. The
 * surface renders only when the settings document is present, `ai_mode` is something other than `'off'`, and the
 * per-feature `ai_features['smart-charge-schedule-suggestion']` opt-in is exactly the boolean `true` (no AI
 * feature defaults to enabled, ADR-015 §I7). Any other shape — a not-yet-loaded document, an absent mode, a
 * missing or non-true flag — yields `false`, the same fail-closed verdict the backend `guard.Wrap` 404 reaches.
 * `smart-charge-schedule-suggestion` is a registered feature id (see AiFeatureRegistry); the registry membership
 * check the web performs against typos is statically satisfied for this constant id.
 */
fun isSmartChargeScheduleEnabled(settings: JsonElement?): Boolean {
    val obj = settings as? JsonObject ?: return false
    val mode = stringField(obj, AI_MODE_KEY)
    val flag = (obj[AI_FEATURES_KEY] as? JsonObject)?.get(SMART_CHARGE_SCHEDULE_FEATURE_ID) as? JsonPrimitive
    val optedIn = flag != null && !flag.isString && flag.booleanOrNull == true
    return mode != null && mode != AI_MODE_OFF && optedIn
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a vehicle
 * id, a rate plan, or the proposed schedule — so a diagnostics line can never leak which vehicle the user is
 * planning for or what Helix proposed. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * state holder calls it from the composable's first-composition effect.
 */
object SmartChargeScheduleDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = SMART_CHARGE_SCHEDULE_SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Splits a single SSE frame into its lines, tolerating `\n` and `\r\n` (web `LINE_DELIM_RE`). */
private val LINE_DELIM = Regex("\\r?\\n")
